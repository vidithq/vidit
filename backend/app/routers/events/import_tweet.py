"""``import-from-tweet`` — the human pre-fill parse and the media proxy."""

import logging

import httpx
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
)
from fastapi.responses import Response

from app.dependencies import get_current_user
from app.models.user import User
from app.ratelimit import limiter
from app.schemas.tweet_import import (
    DetectedGeolocPreview,
    TweetImportCoord,
    TweetImportMedia,
    TweetImportQuotedTweet,
    TweetImportRequest,
    TweetImportResponse,
)
from app.services.detection import preview_detection
from app.services.storage import ALLOWED_TYPES, scrub_log
from app.services.tweet_ingest import (
    MEDIA_FETCH_MAX_BYTES,
    InvalidTweetUrl,
    TweetFetchFailed,
    TweetNotAccessible,
    is_trusted_media_url,
    parse_tweet,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post(
    "/import-from-tweet",
    response_model=TweetImportResponse,
)
@limiter.limit("30/minute")
def import_from_tweet(
    request: Request,
    body: TweetImportRequest,
    current_user: User = Depends(get_current_user),
):
    """Parse a public tweet into a submit-form pre-fill payload.

    Auth-only because (a) the result feeds a write flow only logged-in
    analysts can complete and (b) the syndication endpoint's rate budget is
    finite — an anonymous client shouldn't burn it to scrape X via our
    proxy. Per-IP 30/minute to bound the same risk per logged-in caller.
    """
    try:
        parsed = parse_tweet(body.url)
        # The machine path's view of the same tweet — zero DB writes. Reuses the
        # cached syndication body (parse_tweet just fetched it), so no second
        # network hit. Same error surface as parse_tweet.
        detections = preview_detection(body.url)
    except InvalidTweetUrl as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TweetNotAccessible as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TweetFetchFailed as exc:
        # Hide transport / schema-drift detail from the client (the frontend
        # shows a fixed "fill the form manually" banner on 502); log it so
        # the operator can spot a syndication-endpoint outage.
        logger.warning("Tweet syndication fetch failed for %s: %s", scrub_log(body.url), exc)
        raise HTTPException(
            status_code=502, detail="Couldn't read tweet, fill the form manually"
        ) from exc

    quoted = (
        TweetImportQuotedTweet(
            source_url=parsed.quoted_tweet.source_url,
            author_handle=parsed.quoted_tweet.author_handle,
            tweet_text=parsed.quoted_tweet.tweet_text,
        )
        if parsed.quoted_tweet is not None
        else None
    )
    return TweetImportResponse(
        source_url=parsed.source_url,
        original_tweet_url=parsed.original_tweet_url,
        posted_at=parsed.posted_at,
        # The resolved source's own timestamp (the quote's or the chased
        # Telegram post's), never the OP's: None when the source is undated.
        source_posted_at=(parsed.source_posted_at.isoformat() if parsed.source_posted_at else None),
        author_handle=parsed.author_handle,
        tweet_text=parsed.tweet_text,
        suggested_title=parsed.suggested_title,
        parsed_coords=[TweetImportCoord(lat=c.lat, lng=c.lng) for c in parsed.parsed_coords],
        media=[
            TweetImportMedia(
                kind=m.kind,
                remote_url=m.remote_url,
                content_type=m.content_type,
                origin=m.origin,
            )
            for m in parsed.media
        ],
        quoted_tweet=quoted,
        detected=[
            DetectedGeolocPreview(
                lat=d.coordinate.lat,
                lng=d.coordinate.lng,
                title=d.title,
                proof_text=d.proof_text,
                detected_from_url=d.detected_from_url,
                event_date=d.event_date,
                media=[
                    TweetImportMedia(
                        kind=m.kind,
                        remote_url=m.remote_url,
                        content_type=m.content_type,
                        origin=m.origin,
                    )
                    for m in [*d.source_media, *d.proof_media]
                ],
            )
            for d in detections
        ],
    )


# Per-stream byte cap on the media-proxy response: the shared
# MEDIA_FETCH_MAX_BYTES (one ceiling for this proxy and the archive
# chase fetcher). Anything bigger is an unexpected upstream response or
# a hostile content-length lie; cap and bail so we don't buffer an
# unbounded stream in memory.
_MEDIA_PROXY_MAX_BYTES = MEDIA_FETCH_MAX_BYTES


@router.get("/import-from-tweet/media")
@limiter.limit("60/minute")
def import_from_tweet_media(
    request: Request,
    u: str = Query(..., max_length=2048),
    current_user: User = Depends(get_current_user),
):
    """Stream an X-CDN media URL back to the browser.

    The submit form needs ``File`` objects in ``files[]`` (the contract
    ``services/evidence_processing.py`` keys off), but the X CDN sets no
    CORS headers for a direct browser ``fetch``, so this thin proxy is the
    only path. Strict host whitelist on ``u`` (the X CDN hosts plus the
    Telegram CDN hosts ``is_trusted_media_url`` allows, see
    ``tweet_ingest``) keeps it from becoming an SSRF / open-redirect vector;
    auth-required so it can't be abused as a bandwidth pipe.
    """
    if not is_trusted_media_url(u):
        raise HTTPException(status_code=400, detail="URL host not allowed")

    # Stream + abort on cap so a hostile / buggy upstream that lies about
    # ``Content-Length`` (or sends chunked with no length) can't OOM us.
    # The advertised ``Content-Length`` is still pre-checked as a cheap
    # rejection — a declared 5 GB 502s immediately without opening the stream.
    try:
        with httpx.stream(
            "GET",
            u,
            timeout=15.0,
            headers={"User-Agent": "vidit-tweet-import/1.0"},
            # Don't follow redirects: ``is_trusted_media_url`` only vetted the
            # FIRST hop, so a trusted host answering 3xx → an internal target
            # would slip past the allowlist (SSRF / open redirect). A redirecting
            # media URL 502s below; the analyst falls back to the manual form.
            follow_redirects=False,
        ) as upstream:
            if upstream.status_code == 404:
                raise HTTPException(status_code=404, detail="Media not found")
            if upstream.status_code >= 300:
                # Log the actual upstream status — an X rate-limit (429)
                # and a 502 look identical client-side but are different
                # debugging stories. Kept out of the response body so a
                # frontend / scraper can't probe.
                logger.warning(
                    "Tweet media proxy got upstream %s for %s",
                    upstream.status_code,
                    scrub_log(u),
                )
                raise HTTPException(status_code=502, detail="Couldn't fetch media")

            advertised = upstream.headers.get("content-length")
            if advertised is not None:
                try:
                    if int(advertised) > _MEDIA_PROXY_MAX_BYTES:
                        raise HTTPException(status_code=502, detail="Media exceeded size cap")
                except ValueError:
                    # Non-numeric Content-Length — fall through to the
                    # streaming check; a malformed header isn't trusted anyway.
                    pass

            # Never forward the upstream content-type verbatim: the browser
            # renders whatever this proxy claims, so an upstream that lies
            # (e.g. serving HTML/SVG as its declared type) could trigger
            # content sniffing in the analyst's session. Only the same
            # image/video MIMEs this app accepts on upload get through; a
            # bare comparison against the allowlist (params like
            # ``; charset=`` stripped first) is exact, no substring match.
            raw_content_type = upstream.headers.get("content-type", "")
            content_type = raw_content_type.split(";", 1)[0].strip().lower()
            if content_type not in ALLOWED_TYPES:
                content_type = "application/octet-stream"

            buffer = bytearray()
            for chunk in upstream.iter_bytes():
                buffer.extend(chunk)
                if len(buffer) > _MEDIA_PROXY_MAX_BYTES:
                    # ``with httpx.stream(...)`` closes the connection on
                    # exit so the upstream socket isn't left dangling.
                    raise HTTPException(status_code=502, detail="Media exceeded size cap")
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        logger.warning("Tweet media fetch failed for %s: %s", scrub_log(u), exc)
        raise HTTPException(status_code=502, detail="Couldn't fetch media") from exc

    return Response(
        content=bytes(buffer),
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=300",
            # Belt-and-suspenders alongside the global nosniff middleware
            # (main.py): this response is the one place the app echoes
            # third-party bytes back to the browser.
            "X-Content-Type-Options": "nosniff",
        },
    )
