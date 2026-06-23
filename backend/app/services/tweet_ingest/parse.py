"""Human pre-fill orchestration — pasted tweet URL → ``ParsedTweet``.

Backs ``POST /geolocations/import-from-tweet``: paste a tweet URL, get back
structured data to pre-fill the submit form (title, source, posted-at,
media, best-effort coordinates). The analyst always reviews and submits —
nothing auto-publishes.

Sibling of the machine ``detect`` path: both walk acquire → ``extract`` over
the same normalized text, differing only in what they emit (a form pre-fill
here, a ``DetectedGeoloc`` DTO there).
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from . import syndication
from .errors import TweetFetchFailed
from .extract import ParsedCoord, derive_title, extract_coords
from .syndication import ParsedMedia, ParsedQuotedTweet


@dataclass(frozen=True)
class ParsedTweet:
    # The SOURCE — the quoted tweet's URL when the OP quote-retweets, else
    # the OP's own. The OP is rarely the real source in OSINT (messenger,
    # not footage source), so the frontend uses this as the ``source_url``
    # form field.
    source_url: str
    # The OP's URL — kept so the frontend can cite the analyst in the proof
    # body even when ``source_url`` points at the quoted source.
    original_tweet_url: str
    posted_at: str  # ISO 8601 UTC
    author_handle: str
    tweet_text: str
    suggested_title: str
    parsed_coords: list[ParsedCoord]
    # All media from the OP + the quoted tweet; each entry's ``origin`` tells
    # the frontend primary (``quote``) vs proof (``op``). See ``ParsedMedia``.
    media: list[ParsedMedia]
    quoted_tweet: ParsedQuotedTweet | None


def parse_tweet(url: str, *, client: httpx.Client | None = None) -> ParsedTweet:
    """Top-level helper used by the route.

    Walks normalise → fetch → extract into a ``ParsedTweet``. The optional
    ``client`` is for tests (an ``httpx.Client`` on a ``MockTransport``).
    """
    normalised = syndication.normalise_tweet_url(url)
    body = syndication.fetch_syndication(normalised.tweet_id, client=client)

    # Author handle — prefer the response's screen name over the URL's,
    # since `/i/web/status/<id>` has no handle. Fall back to the URL handle
    # if the field is missing (schema-drift defensive).
    user = body.get("user")
    author_handle = normalised.handle
    if isinstance(user, dict):
        screen_name = user.get("screen_name")
        if isinstance(screen_name, str) and screen_name:
            author_handle = screen_name
    if author_handle == "i":
        # Neither the ``/i/web/status/...`` URL nor the response yielded a
        # handle — emit empty; the caller can render "@unknown".
        author_handle = ""

    posted_at_raw = body.get("created_at")
    if not isinstance(posted_at_raw, str) or not posted_at_raw:
        raise TweetFetchFailed("upstream missing created_at")

    tweet_text = body.get("text")
    if not isinstance(tweet_text, str):
        tweet_text = ""

    quoted = syndication._extract_quoted_tweet(body)

    # Coords from the OP text first, falling back to the quoted tweet.
    # Analyst commentary (the OP) usually carries them, but some posts just
    # say "here ↓" and let the quoted source carry them.
    coords = extract_coords(tweet_text)
    if not coords and quoted is not None and quoted.tweet_text:
        coords = extract_coords(quoted.tweet_text)

    # Media split: OP tagged ``op``, quoted tweet tagged ``quote``; the
    # frontend uses ``origin`` for ``files[]`` (primary) vs proof body
    # (annotated screenshots).
    media = list(syndication._extract_media(body, origin="op"))
    if quoted is not None:
        qt_body = body.get("quoted_tweet")
        if isinstance(qt_body, dict):
            media.extend(syndication._extract_media(qt_body, origin="quote"))

    # ``source_url`` resolution, in priority order:
    #
    # 1. Quoted tweet's URL — OP quote-retweeted the source.
    # 2. First non-X URL in ``entities.urls`` — analyst typed it
    #    ("Source: https://t.me/...").
    # 3. OP's own URL — wrong attribution often enough (analysts post their
    #    analysis, not the footage source) that the frontend banner reminds
    #    them to override, but better than a blank form.
    if quoted is not None:
        source_url = quoted.source_url
    else:
        external = syndication._extract_external_source_url(body)
        source_url = external if external is not None else normalised.canonical

    return ParsedTweet(
        source_url=source_url,
        original_tweet_url=normalised.canonical,
        posted_at=posted_at_raw,
        author_handle=author_handle,
        tweet_text=tweet_text,
        suggested_title=derive_title(tweet_text),
        parsed_coords=coords,
        media=media,
        quoted_tweet=quoted,
    )
