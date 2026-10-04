"""``import-from-tweet``: paste your own X post, get the detections it produced."""

import asyncio
import logging
from typing import NoReturn

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import limiter
from app.schemas.tweet_import import ImportNote, TweetImportRead, TweetImportRequest
from app.services.detection import NotYourPost, import_pasted_post
from app.services.storage import scrub_log
from app.services.tweet_ingest import (
    POST_UNREADABLE,
    REFUSAL_MESSAGES,
    WARNING_MESSAGES,
    InvalidTweetUrl,
    TweetFetchFailed,
    TweetNotAccessible,
    TweetUpstreamBusy,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Wording for a refusal the copy table lacks (unreachable while the code test
# passes); here so the page needn't keep a second table.
_UNNAMED_REFUSAL = "That post produced no detection."


def _refuse(status_code: int, code: str, message: str) -> NoReturn:
    """Answer with the shared typed ``{code, message}`` envelope."""
    raise HTTPException(status_code=status_code, detail={"code": code, "message": message})


# ``def``, so FastAPI runs the handler in its threadpool: the import is one long
# blocking stretch that would hold every other request on the event loop.
# ``asyncio.run`` gives it its own loop, as the bot's cron and the archive
# worker do. Not in the docstring (that is the OpenAPI description).
@router.post("/import-from-tweet", response_model=TweetImportRead)
@limiter.limit("30/minute")
def import_from_tweet(
    request: Request,
    body: TweetImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import the caller's own X post as detections.

    Runs the same engine and write path as the bot and the archive backfill
    (``detection.import_pasted_post``): one detection per coordinate, owned by
    the caller, and a repeat paste overwrites the open detection.

    Auth-only, own posts only (the author must be the handle linked to the
    caller). Per-IP 30/minute bounds the shared syndication budget.
    """
    try:
        outcome = asyncio.run(import_pasted_post(db, owner=current_user, url=body.url))
    except NotYourPost as exc:
        _refuse(400, exc.code, str(exc))
    except InvalidTweetUrl as exc:
        _refuse(400, "invalid_tweet_url", str(exc))
    except TweetNotAccessible:
        # Same code and sentence as the bot's verdict, from the shared table
        # (X serves the post to no unauthenticated reader).
        _refuse(404, POST_UNREADABLE, REFUSAL_MESSAGES[POST_UNREADABLE])
    except TweetUpstreamBusy as exc:
        # Ahead of ``TweetFetchFailed`` (its base class): throttling is a
        # temporary refusal, so a truthful 503 with its own detail. Still 5xx so
        # Sentry captures it, separate from schema-drift.
        logger.warning("Tweet syndication busy for %s: %s", scrub_log(body.url), exc)
        _refuse(
            503,
            "upstream_busy",
            "X is not serving posts right now, retry in a minute.",
        )
    except TweetFetchFailed as exc:
        # Log the detail; hide it from the client.
        logger.warning("Tweet syndication fetch failed for %s: %s", scrub_log(body.url), exc)
        _refuse(502, "upstream_unreadable", "Couldn't read that post, try again later.")
    # Each code travels with its sentence from the one backend table the bot
    # reply and the archive email also read. Warnings keep the table's order.
    return TweetImportRead(
        created=outcome.created,
        updated=outcome.updated,
        skipped=outcome.skipped,
        warnings=[
            ImportNote(code=code, message=message)
            for code, message in WARNING_MESSAGES.items()
            if code in outcome.warnings
        ],
        reason=(
            None
            if outcome.reason is None
            else ImportNote(
                code=outcome.reason,
                message=REFUSAL_MESSAGES.get(outcome.reason, _UNNAMED_REFUSAL),
            )
        ),
        failed=outcome.failed,
    )
