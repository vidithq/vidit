from pathlib import Path

import sentry_sdk
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.middleware.csrf import CSRFMiddleware
from app.routers import (
    admin,
    auth,
    bounties,
    geolocations,
    search,
    social,
    tags,
    users,
)
from app.services.audit import rate_limit_key
from app.services.storage import LOCAL_STORAGE_MOUNT_PATH

# Optional error tracking. Boots only when SENTRY_DSN is set in the env;
# safe to leave unset for local dev or owner-only self-test.
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
    )

limiter = Limiter(key_func=rate_limit_key, default_limits=["60/minute"])
limiter.enabled = settings.rate_limit_enabled

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


# Body-size cap (HTTP layer). Without this, Starlette buffers the entire
# multipart body to a SpooledTemporaryFile BEFORE the route function ever
# runs — only then does ``services.storage.validate_file`` check the size
# and raise. An attacker uploading a multi-GB body would pin worker memory
# / tmp-disk long before the per-file cap fires. We pre-check
# ``Content-Length`` for a clean 413 on the announced-too-large path; the
# absent / chunked path still falls through to ``validate_file`` per file,
# but that's bounded by the worker's stream-reader and is no worse than
# the per-file cap.
#
# Ceiling sized to admit the LARGEST legitimate request:
#   * one ``max_video_size``-sized video (100 MB), OR
#   * a full batch of ``max_files_per_geolocation`` images at
#     ``max_image_size`` each (12 × 10 MB = 120 MB today).
# Take the max + 10 MB headroom for multipart envelope and form fields.
# Reviewing PR #100 caught the previous shape (``max_video_size + 10 MB``,
# = 110 MB) silently rejecting a legitimate 12-image submission. All three
# caps now read from ``settings`` so this module never imports a router —
# the previous shape's ``from app.routers.geolocations import …`` formed
# a fragile ``main → routers`` import edge.
_MAX_REQUEST_BODY_BYTES = max(
    settings.max_video_size,
    settings.max_files_per_geolocation * settings.max_image_size,
) + (10 * 1024 * 1024)


@app.middleware("http")
async def enforce_request_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            announced = int(content_length)
        except ValueError:
            announced = None
        # Reject negatives (``int("-1")`` parses cleanly but ``-1 >
        # _MAX_REQUEST_BODY_BYTES`` is False, so a negative header would
        # otherwise slip past this gate and defer rejection to Starlette's
        # downstream parsing) and any positive value above the cap.
        if announced is not None and (announced < 0 or announced > _MAX_REQUEST_BODY_BYTES):
            return JSONResponse(
                status_code=413,
                content={
                    "detail": (f"Request body too large (max {_MAX_REQUEST_BODY_BYTES} bytes)"),
                },
            )
    return await call_next(request)


# Order matters: middlewares added later run earlier on the incoming request.
# The effective incoming chain (outer → inner) is:
#   HSTS → CORS → CSRF → BodySizeLimit → GZip → app
# CORS sits outside BodySizeLimit so the 413 short-circuit response gets the
# ``Access-Control-Allow-Origin`` header stamped on its way back out — without
# this, a cross-origin browser POST that trips the body cap shows up as a
# CORS error in DevTools instead of a clean 413 (caught in the PR #100 review
# pass). CSRF stays just outside BodySize: it doesn't read the request body
# (double-submit cookie + header only), so it's safe to run on a request
# whose body we'd otherwise reject; running it first means a forged-CSRF +
# oversized body gets the 403 the cheap path would have given anyway. HSTS
# is outermost so it stamps every response — including CORS-preflight 200s
# and CSRF rejections — which never reach the app.
app.add_middleware(CSRFMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# HSTS — tells browsers "for the next 6 months, never speak HTTP to this
# origin." 15768000 s = 6 months, the value spec'd in next.md → Tier 4
# lite. No `includeSubDomains` and no `preload`: subdomain coverage is
# a future-coupling commitment we can't unwind for months, and preload
# submission belongs to the public-launch checklist, not closed beta.
# Pin is per-origin: this header on `api.vidit.app` protects API calls;
# Vercel sets its own HSTS on `vidit.app`.
#
# Registered LAST so it sits outermost in the middleware stack — that
# way it stamps responses produced by inner middleware short-circuits
# (CORS preflight, CSRF rejection) as well as ones produced by the app.
@app.middleware("http")
async def add_hsts_header(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Strict-Transport-Security", "max-age=15768000")
    return response


app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(bounties.router, prefix="/api/v1/bounties", tags=["bounties"])
app.include_router(geolocations.router, prefix="/api/v1/geolocations", tags=["geolocations"])
app.include_router(search.router, prefix="/api/v1/search", tags=["search"])
app.include_router(social.router, prefix="/api/v1", tags=["social"])
app.include_router(tags.router, prefix="/api/v1/tags", tags=["tags"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])


if settings.storage_backend == "local":
    local_dir = Path(settings.local_storage_dir)
    local_dir.mkdir(parents=True, exist_ok=True)
    app.mount(LOCAL_STORAGE_MOUNT_PATH, StaticFiles(directory=local_dir), name="local-storage")


@app.get("/health")
def health():
    return {"status": "ok"}


# HEAD lives next to GET because most uptime monitors (UptimeRobot,
# BetterStack, Hyperping) default to HEAD for the cheap probe — a bare
# @app.get(...) would return 405 on every check and the dashboard would
# read "down" while the endpoint is actually healthy on GET. Kept out of
# the OpenAPI schema (it's an ops-only method on an ops-only endpoint)
# and registered as its own handler rather than via @app.api_route(
# methods=["GET","HEAD"]) — the latter shape emits a duplicate-
# operation-id warning at startup because FastAPI generates one operation
# id per (function, path) pair.
@app.head("/health", include_in_schema=False)
def health_head() -> Response:
    return Response(status_code=200)
