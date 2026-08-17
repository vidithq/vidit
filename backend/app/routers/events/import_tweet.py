"""``import-from-tweet``: paste your own X post, get the drafts it produced."""

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
    REFUSAL_MESSAGES,
    WARNING_MESSAGES,
    InvalidTweetUrl,
    TweetFetchFailed,
    TweetNotAccessible,
    TweetUpstreamBusy,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# The sentence for a refusal the copy table does not word, which the code test
# makes unreachable while it passes. The page renders what it is given, so the
# fallback belongs here rather than as a second table on the page.
_UNNAMED_REFUSAL = "That post produced no draft."


def _refuse(status_code: int, code: str, message: str) -> NoReturn:
    """Answer with the typed ``{code, message}`` envelope the app shares."""
    raise HTTPException(status_code=status_code, detail={"code": code, "message": message})


@router.post("/import-from-tweet", response_model=TweetImportRead)
@limiter.limit("30/minute")
async def import_from_tweet(
    request: Request,
    body: TweetImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import the caller's own X post as ``detected`` drafts.

    The paste runs the same engine and the same write path as the bot and the
    archive backfill (``detection.import_pasted_post``), so one post yields one
    draft per coordinate it carries, owned by the caller. A second paste of the
    same post overwrites the open draft instead of duplicating it.

    Auth-only, and own posts only: the post's author must be the handle linked
    to the caller's account. Per-IP 30/minute bounds what one caller can spend
    of the shared, finite syndication budget.
    """
    try:
        outcome = await import_pasted_post(db, owner=current_user, url=body.url)
    except NotYourPost as exc:
        _refuse(400, exc.code, str(exc))
    except InvalidTweetUrl as exc:
        _refuse(400, "invalid_tweet_url", str(exc))
    except TweetNotAccessible as exc:
        _refuse(404, "post_not_accessible", str(exc))
    except TweetUpstreamBusy as exc:
        # Ahead of ``TweetFetchFailed`` (its base class): X throttling us reads
        # as a temporary refusal the analyst can wait out, so it earns a truthful
        # 503 and its own detail. Still 5xx, so Sentry keeps capturing it, in its
        # own issue instead of buried in the schema-drift bucket.
        logger.warning("Tweet syndication busy for %s: %s", scrub_log(body.url), exc)
        _refuse(
            503,
            "upstream_busy",
            "X is not serving posts right now, retry in a minute.",
        )
    except TweetFetchFailed as exc:
        # Hide transport / schema-drift detail from the client; log it so the
        # operator can spot a syndication-endpoint outage.
        logger.warning("Tweet syndication fetch failed for %s: %s", scrub_log(body.url), exc)
        _refuse(502, "upstream_unreadable", "Couldn't read that post, try again later.")
    # Each code travels with its sentence, read off the one backend table the
    # bot's reply and the archive's outcome email also read, so the page renders
    # what it is handed instead of keeping a fourth copy of the wording. The
    # warnings keep the table's order, which is the order every surface reads.
    return TweetImportRead(
        created=[event.id for event in outcome.created],
        updated=[event.id for event in outcome.updated],
        skipped=[event.id for event in outcome.skipped],
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
