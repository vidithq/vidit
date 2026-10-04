import math
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from starlette.types import ASGIApp

from app.config import settings
from app.database import bound_lock_waits
from app.middleware.csrf import CSRFMiddleware
from app.middleware.request_id import REQUEST_ID_HEADER, RequestIdMiddleware
from app.observability import configure_logging, init_sentry
from app.ratelimit import AUTHENTICATED_READ_SCOPE, limiter
from app.routers import (
    admin,
    auth,
    collections,
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

configure_logging()
init_sentry()


class _ViditAPI(FastAPI):
    def build_middleware_stack(self) -> ASGIApp:
        # Wraps Starlette's ServerErrorMiddleware (which ``add_middleware``
        # cannot), so its 500 carries the request id too.
        return RequestIdMiddleware(super().build_middleware_stack())


app = _ViditAPI(
    title="Vidit API",
    description="OSINT/GEOINT geolocation platform",
    version="0.1.0",
)
app.state.limiter = limiter


# Per-endpoint limits are a throttle of seconds; the per-user read quota is a
# fixed hour-long window. Each gets a distinct typed code so a caller can tell
# them apart, and every 429 carries `Retry-After` in seconds.
RATE_LIMITED_CODE = "rate_limited"
READ_QUOTA_EXCEEDED_CODE = "read_quota_exceeded"


def _retry_after_seconds(request: Request) -> int | None:
    """Whole seconds until the exceeded window resets, or ``None`` if unknown.

    slowapi records the rejected limit on ``request.state.view_rate_limit``
    before raising, which lets the storage report the real reset time (a caller
    that spent its quota 50 minutes ago waits 10 minutes, not 60).
    """
    current = getattr(request.state, "view_rate_limit", None)
    if not current:
        return None
    item, args = current
    reset_at, _remaining = limiter.limiter.get_window_stats(item, *args)
    return max(1, math.ceil(reset_at - time.time()))


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    quota = getattr(exc.limit, "scope", "") == AUTHENTICATED_READ_SCOPE
    code = READ_QUOTA_EXCEEDED_CODE if quota else RATE_LIMITED_CODE
    message = (
        "Hourly read quota exceeded. Try again later."
        if quota
        else "Rate limit exceeded. Try again later."
    )
    retry_after = _retry_after_seconds(request)
    return JSONResponse(
        status_code=429,
        content={"detail": {"code": code, "message": message}},
        headers={"Retry-After": str(retry_after)} if retry_after is not None else None,
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError):
    """FastAPI's 422 body without each error's ``input``, which would echo a
    rejected password back.
    """
    errors = [{k: v for k, v in error.items() if k != "input"} for error in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


app.add_middleware(GZipMiddleware, minimum_size=1000)


# Body-size cap (HTTP layer). Starlette buffers the whole multipart body
# before the route runs, so without a cap a multi-GB body pins worker memory
# long before ``services.storage.validate_file`` fires. A ``Content-Length``
# within the cap streams straight through; a length-less (chunked) body is
# buffered up to ``cap`` here, so the unauthenticated webhook pins its own
# small cap.
#
# The ceiling admits one source video (``max_video_size``), a full proof batch
# at ``max_image_size``, plus 10 MB for multipart envelope and form fields. All
# read from ``settings`` so this module never imports a router.
_MAX_REQUEST_BODY_BYTES = (
    settings.max_video_size
    + settings.max_proof_images_per_event * settings.max_image_size
    + (10 * 1024 * 1024)
)

# The X webhook path. Keep in sync with the ``include_router`` prefix below.
_WEBHOOK_ACTIVITY_PATH = "/api/v1/webhooks/x"


@app.middleware("http")
async def enforce_request_body_size(request: Request, call_next):
    # The dev staging upload stands in for the direct-to-S3 archive POST, so it
    # carries the archive cap plus 10 MiB for the multipart envelope. Local
    # backend only: the route isn't mounted elsewhere.
    cap = _MAX_REQUEST_BODY_BYTES
    if settings.storage_backend == "local" and request.url.path == DEV_STAGING_UPLOAD_PATH:
        cap = archive_zip.MAX_UPLOAD_BYTES + (10 * 1024 * 1024)
    elif request.url.path == _WEBHOOK_ACTIVITY_PATH:
        # Unauthenticated (HMAC-gated) and this runs before the signature
        # check, so pin the route's own small cap: a chunked body can't buffer
        # up to the upload ceiling pre-auth.
        cap = webhooks.MAX_BODY_BYTES
    content_length = request.headers.get("content-length")
    announced = None
    if content_length is not None:
        try:
            announced = int(content_length)
        except ValueError:
            announced = None
    if announced is not None:
        # A well-formed Content-Length frames the body exactly, so one check
        # settles it. Reject negatives too: ``-1 > cap`` is False.
        if announced < 0 or announced > cap:
            return JSONResponse(
                status_code=413,
                content={"detail": (f"Request body too large (max {cap} bytes)")},
            )
        return await call_next(request)
    # No usable Content-Length: read the stream with a running cap and abort
    # when it crosses. Caching onto ``request._body`` replays the bytes to the
    # route as ``call_next`` would have.
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


# Middlewares added later run earlier. Effective chain (outer → inner):
# RequestId (``_ViditAPI``) → Starlette's error layer → HSTS → CORS → CSRF →
# BodySizeLimit → GZip → app.
# CORS sits outside BodySizeLimit so a 413 carries
# ``Access-Control-Allow-Origin`` (else it reads as a CORS error in DevTools).
# CSRF stays outside BodySize: it reads only the cookie and header. HSTS is
# outermost so it stamps CORS-preflight 200s and CSRF rejections; Starlette's
# 500 sits outside it and carries no HSTS.
app.add_middleware(CSRFMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.effective_cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # `allow_headers` covers requests only. Browser clients need to read
    # `Retry-After` (429 backoff), `Link` (next-page cursor of capped lists)
    # and `X-Request-ID` (bug reports).
    expose_headers=["Retry-After", "Link", REQUEST_ID_HEADER],
)


# HSTS for 6 months (15768000 s). No `includeSubDomains`/`preload`: those
# commitments can't be unwound for months. Per-origin: Vercel sets its own on
# `vidit.app`. Registered last so it is outermost and also stamps CORS
# preflight and CSRF rejections.
@app.middleware("http")
async def add_hsts_header(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Strict-Transport-Security", "max-age=15768000")
    # Content-sniffing gate. ``setdefault`` so a route that sets its own value
    # (the tweet media proxy) keeps it.
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
# Order is load-bearing: see ``routers/events/__init__.py``.
for _event_router in events.routers:
    app.include_router(_event_router, prefix="/api/v1/events", tags=["events"])
app.include_router(collections.router, prefix="/api/v1/collections", tags=["collections"])
app.include_router(conflicts.router, prefix="/api/v1/conflicts", tags=["conflicts"])
app.include_router(search.router, prefix="/api/v1/search", tags=["search"])
app.include_router(social.router, prefix="/api/v1", tags=["social"])
app.include_router(tags.router, prefix="/api/v1/tags", tags=["tags"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["webhooks"])

# The API alone caps its lock waits; the scheduler services share the engine
# and wait (``engineering.md``, Request concurrency).
bound_lock_waits()


if settings.storage_backend == "local":
    local_dir = Path(settings.local_storage_dir)
    local_dir.mkdir(parents=True, exist_ok=True)
    app.mount(LOCAL_STORAGE_MOUNT_PATH, StaticFiles(directory=local_dir), name="local-storage")

    # Dev/CI stand-in for the S3 POST-policy target the presign returns in prod
    # (``LocalStorage.presign_staging_upload``), same form contract. Never
    # mounted with STORAGE_BACKEND=s3. Enforces the strict staging-key shape (a
    # free ``key`` could traverse out of the storage root) and the archive size
    # guard.
    @app.post(DEV_STAGING_UPLOAD_PATH, include_in_schema=False)
    async def dev_staging_upload(
        key: str = Form(...),
        file: UploadFile = File(...),
    ) -> Response:
        parsed = archive_jobs.parse_staging_key(key)
        if parsed is None:
            raise HTTPException(status_code=400, detail="Not a staging key")
        # Rebuilt from the parsed UUIDs, never the raw key: no user path
        # fragment reaches the filesystem.
        owner_id, object_id = parsed
        dest = local_dir / archive_jobs.STAGING_PREFIX / str(owner_id) / f"{object_id}.zip"
        # Chunked to disk; one chunk in memory at a time.
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
        return Response(status_code=204)


@app.get("/health")
def health():
    return {"status": "ok"}


# HEAD next to GET: uptime monitors default to HEAD and a bare @app.get would
# 405. Own handler rather than ``api_route``, which emits a duplicate
# operation-id warning.
@app.head("/health", include_in_schema=False)
def health_head() -> Response:
    return Response(status_code=200)
