from fastapi import APIRouter, BackgroundTasks, Request, status

from app.dependencies import DB, OptionalUser
from app.models.content_report import ContentReport
from app.ratelimit import limiter
from app.schemas.report import ContentReportCreate, ContentReportRead
from app.services import reports as reports_service

router = APIRouter()


@router.post("", response_model=ContentReportRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
def report_content(
    request: Request,
    body: ContentReportCreate,
    background_tasks: BackgroundTasks,
    current_user: OptionalUser,
    db: DB,
) -> ContentReport:
    """Report an event, a collection or a site for moderation."""
    return reports_service.create_report(
        db, body=body, reporter=current_user, background_tasks=background_tasks
    )
