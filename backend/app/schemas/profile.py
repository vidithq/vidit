import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.organization import OrganizationMembershipRead


class UserProfile(BaseModel):
    """Public profile payload for ``GET /users/{username}``.

    Excludes ``email`` and ``is_admin``. ``organizations`` lists the analyst's memberships, as
    ``GET /users/{username}/organizations`` does.
    """

    id: uuid.UUID
    username: str
    bio: str | None
    avatar_url: str | None
    external_links: dict[str, str | None]
    created_at: datetime
    followers_count: int
    following_count: int
    is_following: bool = False
    organizations: list[OrganizationMembershipRead]

    model_config = ConfigDict(from_attributes=True)
