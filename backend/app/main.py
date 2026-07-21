from pathlib import Path

import sentry_sdk
from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.middleware.csrf import CSRFMiddleware
from app.ratelimit import limiter
from app.routers import (
    admin,
    auth,
    conflicts,
    events,
    search,
    social,
    tags,
    users,
    webhooks,
)
from app.services import archive_jobs
from app.services.storage import (
    DEV_STAGING_UPLOAD_PATH,
    LOCAL_STORAGE_MOUNT_PATH,
)
from app.services.tweet_ingest import archive_zip

# Error tracking. Boots only when SENTRY_DSN is set; safe to leave unset.
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
    )

app = FastAPI(
    title="Vidit API",
    description="OSINT/GEOINT geolocation platform",
    version="0.1.0",
)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Try again later."},
    )


app.add_middleware(GZipMiddleware, minimum_size=1000)


# Body-size cap (HTTP layer). Without this, Starlette buffers the whole
# multipart body to a SpooledTemporaryFile BEFORE the route runs, and only
# then does ``services.storage.validate_file`` check size — so a multi-GB
# body pins worker memory / tmp-disk long before the per-file cap fires.
# ``Content-Length`` gives a clean, cheap 413 on the announced-too-large path;
# a chunked (or otherwise length-less) body carries no such header to reject
# up front, so it's read here chunk by chunk with a running total, aborting
# the instant the total crosses the cap. That bounds every request to ``cap``
# bytes read regardless of what it announced, closing the fall-through the
# header check alone would miss.
#
# Ceiling admits the largest legitimate request: one source file
# (``max_video_size``, 95 MiB, the bigger of the two per-file caps) plus a
# full ``max_proof_images_per_event`` proof batch at ``max_image_size``
# (10 × 10 MB), plus 10 MB for multipart envelope and form fields. All three
# caps read from ``settings`` so this module never imports a router (the old
# shape's ``from app.routers.events import …`` formed a fragile import edge).
_MAX_REQUEST_BODY_BYTES = (
    settings.max_video_size
    + settings.max_proof_images_per_event * settings.max_image_size
    + (10 * 1024 * 1024)
)


@app.middleware("http")
async def enforce_request_body_size(request: Request, call_next):
    # The dev staging upload stands in for the direct-to-S3 archive POST that
    # bypasses the API entirely in prod, so it carries the archive cap, not
    # the request cap (a real 772 MB export 413'd here in local dev). Local
    # backend only: the route isn't mounted elsewhere. The 10 MiB slack
    # covers the multipart envelope + form fields around the zip, mirroring
    # the request cap's own envelope allowance above; S3's POST policy caps
    # the file part alone, while Content-Length spans the whole body.
    cap = _MAX_REQUEST_BODY_BYTES
    if settings.storage_backend == "local" and request.url.path == DEV_STAGING_UPLOAD_PATH:
        cap = archive_zip.MAX_UPLOAD_BYTES + (10 * 1024 * 1024)
    content_length = request.headers.get("content-length")
    announced = None
    if content_length is not None:
        try:
            announced = int(content_length)
        except ValueError:
            announced = None
    if announced is not None:
        # A well-formed Content-Length frames the body to exactly that many
        # bytes (HTTP/1.1 length-delimited), so one check settles it and the
        # route streams the body as before. Reject negatives too: ``int("-1")``
        # parses cleanly but ``-1 > cap`` is False, so a negative header would
        # otherwise slip past.
        if announced < 0 or announced > cap:
            return JSONResponse(
                status_code=413,
                content={"detail": (f"Request body too large (max {cap} bytes)")},
            )
        return await call_next(request)
    # No usable Content-Length (chunked, or an unparseable header): nothing
    # frames the size up front, so read the stream with a running cap and abort
    # the instant it crosses. ``Request.stream()`` is Starlette's own
    # dispatch-middleware hook; caching the result onto ``request._body``
    # replays those bytes to the route exactly as ``call_next`` would have.
    # Only this length-less path buffers, and only up to ``cap``: normal
    # Content-Length uploads keep streaming straight through, no memory
    # regression, while the fall-through a header check alone would miss is
    # now bounded.
    total = 0
    chunks: list[bytes] = []
    async for chunk in request.stream():
        total += len(chunk)
        if total > cap:
            return JSONResponse(
                status_code=413,
                content={"detail": (f"Request body too large (max {cap} bytes)")},
            )
        chunks.append(chunk)
    request._body = b"".join(chunks)
    return await call_next(request)


# Order matters: middlewares added later run earlier on the incoming request.
# Effective chain (outer → inner): HSTS → CORS → CSRF → BodySizeLimit → GZip → app.
# CORS sits outside BodySizeLimit so the 413 short-circuit gets an
# ``Access-Control-Allow-Origin`` header on the way out — otherwise a
# cross-origin POST tripping the body cap surfaces as a CORS error in DevTools
# instead of a clean 413 (PR #100). CSRF stays outside BodySize: it reads only
# the double-submit cookie + header (not the body), so a forged-CSRF +
# oversized body gets the 403 the cheap path would give anyway. HSTS is
# outermost so it stamps every response, including CORS-preflight 200s and CSRF
# rejections that never reach the app.
app.add_middleware(CSRFMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# HSTS: "for the next 6 months, never speak HTTP to this origin."
# 15768000 s = 6 months. No `includeSubDomains`/`preload` — subdomain coverage
# is a future-coupling commitment we can't unwind for months, and preload
# submission belongs to the public-launch checklist. Pin is per-origin: this
# header on `api.vidit.app` protects API calls; Vercel sets its own on
# `vidit.app`. Registered LAST so it sits outermost and stamps responses from
# inner-middleware short-circuits (CORS preflight, CSRF rejection) too.
@app.middleware("http")
async def add_hsts_header(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Strict-Transport-Security", "max-age=15768000")
    # Global content-sniffing gate: without it, a browser served a
    # mislabeled response (an upload whose stored MIME drifted, an error
    # body a client requested as a script) may still execute it as HTML/JS.
    # ``setdefault`` so a route that already set its own value (the tweet
    # media proxy pins the same header for the one place upstream bytes
    # are echoed back) keeps it.
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
# events ships several sub-routers (one per concern); mount each under the
# shared prefix. Order is load-bearing — see ``routers/events/__init__.py``.
for _event_router in events.routers:
    app.include_router(_event_router, prefix="/api/v1/events", tags=["events"])
app.include_router(conflicts.router, prefix="/api/v1/conflicts", tags=["conflicts"])
app.include_router(search.router, prefix="/api/v1/search", tags=["search"])
app.include_router(social.router, prefix="/api/v1", tags=["social"])
app.include_router(tags.router, prefix="/api/v1/tags", tags=["tags"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["webhooks"])


if settings.storage_backend == "local":
    local_dir = Path(settings.local_storage_dir)
    local_dir.mkdir(parents=True, exist_ok=True)
    app.mount(LOCAL_STORAGE_MOUNT_PATH, StaticFiles(directory=local_dir), name="local-storage")

    # Dev/CI stand-in for the S3 POST-policy target the presign returns in
    # prod (see ``LocalStorage.presign_staging_upload``): same form contract
    # (fields + file), so the frontend has one upload code path. Never mounted
    # when STORAGE_BACKEND=s3. Enforces the strict staging-key shape (a free
    # ``key`` field could otherwise traverse out of the storage root) and the
    # same size guard the S3 policy carries; the body-size middleware above
    # exempts this path up to the archive cap for the same reason.
    @app.post(DEV_STAGING_UPLOAD_PATH, include_in_schema=False)
    async def dev_staging_upload(
        key: str = Form(...),
        file: UploadFile = File(...),
    ) -> Response:
        parsed = archive_jobs.parse_staging_key(key)
        if parsed is None:
            raise HTTPException(status_code=400, detail="Not a staging key")
        # The destination is rebuilt from the parsed UUIDs, never from the
        # raw key string: no user-provided path fragment reaches the
        # filesystem, so traversal is impossible by construction.
        owner_id, object_id = parsed
        dest = local_dir / archive_jobs.STAGING_PREFIX / str(owner_id) / f"{object_id}.zip"
        # Chunked straight to disk, mirroring the streaming discipline of the
        # real S3 target; only one chunk is ever in memory.
        dest.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        with dest.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > archive_zip.MAX_UPLOAD_BYTES:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="Upload exceeds the size guard")
                out.write(chunk)
        # 204 like S3's default POST-policy success response.
        return Response(status_code=204)


@app.get("/health")
def health():
    return {"status": "ok"}


# HEAD next to GET because most uptime monitors (UptimeRobot, BetterStack,
# Hyperping) default to HEAD — a bare @app.get would 405 every check and the
# dashboard would read "down" while GET is healthy. Out of the OpenAPI schema
# (ops-only), and its own handler rather than @app.api_route(methods=["GET",
# "HEAD"]): that shape emits a duplicate-operation-id warning at startup
# (FastAPI generates one operation id per (function, path) pair).
@app.head("/health", include_in_schema=False)
def health_head() -> Response:
    return Response(status_code=200)
