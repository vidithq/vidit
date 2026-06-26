from pathlib import Path

import sentry_sdk
from fastapi import FastAPI, Request, Response
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
    auth_x,
    bounties,
    geolocations,
    search,
    social,
    tags,
    users,
)
from app.services.storage import LOCAL_STORAGE_MOUNT_PATH

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
# Pre-checking ``Content-Length`` gives a clean 413 on the announced-too-large
# path; the absent/chunked path still falls through to ``validate_file`` per
# file (bounded by the stream-reader, no worse than the per-file cap).
#
# Ceiling admits the largest legitimate request — one ``max_video_size`` video
# (100 MB) OR a full ``max_files_per_geolocation`` batch at ``max_image_size``
# (12 × 10 MB = 120 MB) — plus 10 MB for multipart envelope and form fields.
# PR #100 caught the previous shape (``max_video_size + 10 MB`` = 110 MB)
# silently rejecting a 12-image submission. All three caps read from
# ``settings`` so this module never imports a router (the old shape's
# ``from app.routers.geolocations import …`` formed a fragile import edge).
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
        # Reject negatives too: ``int("-1")`` parses cleanly but ``-1 > cap``
        # is False, so a negative header would otherwise slip past this gate.
        if announced is not None and (announced < 0 or announced > _MAX_REQUEST_BODY_BYTES):
            return JSONResponse(
                status_code=413,
                content={
                    "detail": (f"Request body too large (max {_MAX_REQUEST_BODY_BYTES} bytes)"),
                },
            )
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
    return response


app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(auth_x.router, prefix="/api/v1/auth/x", tags=["auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(bounties.router, prefix="/api/v1/bounties", tags=["bounties"])
# geolocations ships several sub-routers (one per concern); mount each under the
# shared prefix. Order is load-bearing — see ``routers/geolocations/__init__.py``.
for _geo_router in geolocations.routers:
    app.include_router(_geo_router, prefix="/api/v1/geolocations", tags=["geolocations"])
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


# HEAD next to GET because most uptime monitors (UptimeRobot, BetterStack,
# Hyperping) default to HEAD — a bare @app.get would 405 every check and the
# dashboard would read "down" while GET is healthy. Out of the OpenAPI schema
# (ops-only), and its own handler rather than @app.api_route(methods=["GET",
# "HEAD"]): that shape emits a duplicate-operation-id warning at startup
# (FastAPI generates one operation id per (function, path) pair).
@app.head("/health", include_in_schema=False)
def health_head() -> Response:
    return Response(status_code=200)
