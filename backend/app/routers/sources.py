"""``POST /sources/check``: the imagery provider check the form runs while the analyst types."""

from fastapi import APIRouter, Depends, Request

from app.dependencies import get_current_user
from app.models.user import User
from app.ratelimit import limiter
from app.schemas.source import (
    ImageryProviderRead,
    SourceCheck,
    SourceCheckRead,
    SourceLinkCheckRead,
)
from app.services.events.sources import warning_reads
from app.services.imagery import LinkCheck, provider_of

router = APIRouter()


@router.post("/check", response_model=SourceCheckRead)
@limiter.limit("120/minute")
def check_source(
    request: Request,
    body: SourceCheck,
    current_user: User = Depends(get_current_user),
) -> SourceCheckRead:
    """The imagery provider each link opens, and the warnings the source would carry.

    Writes nothing. The warnings are the ones ``SourceRead.warnings`` serves once the source is
    saved, so the form shows them while the analyst types.
    """
    providers = [provider_of(link.url) for link in body.links]
    return SourceCheckRead(
        links=[
            SourceLinkCheckRead(
                url=link.url,
                provider=ImageryProviderRead.model_validate(provider) if provider else None,
            )
            for link, provider in zip(body.links, providers, strict=True)
        ],
        warnings=warning_reads(
            body.kind,
            body.captured_at,
            [LinkCheck(link.url, archived=bool(link.snapshot_url)) for link in body.links],
        ),
    )
