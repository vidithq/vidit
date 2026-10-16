from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_admin
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.schemas.product_update import (
    ProductUpdateCreate,
    ProductUpdateList,
    ProductUpdatePreview,
    ProductUpdateRead,
)
from app.services import product_update_consent, product_updates

router = APIRouter()


@router.post("/product-updates/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def unsubscribe(
    request: Request,
    token: str = Query(min_length=1, max_length=200),
    db: Session = Depends(get_db),
) -> Response:
    """Withdraw the consent to product update emails named by a signed token.

    Needs no session, so it answers the unsubscribe page and the one-click
    ``List-Unsubscribe-Post`` of a mail client alike. Idempotent; 400 on a
    token that does not verify.
    """
    try:
        product_update_consent.unsubscribe(db, token)
    except product_update_consent.InvalidUnsubscribeTokenError as exc:
        raise_typed_error(exc, {exc.code: 400})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/product-updates", response_model=ProductUpdateList)
@limiter.limit("120/minute")
def list_product_updates(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ProductUpdateList:
    """Every announcement sent, newest first, with its delivery progress."""
    return ProductUpdateList(items=product_updates.list_updates(db))


@router.post("/admin/product-updates/preview", response_model=ProductUpdatePreview)
@limiter.limit("60/hour")
def preview_product_update(
    request: Request,
    body: ProductUpdateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ProductUpdatePreview:
    """Render the announcement as you would receive it and count its audience."""
    return product_updates.preview(db, admin=current_user, body=body)


@router.post("/admin/product-updates/test", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/hour")
def send_test_product_update(
    request: Request,
    body: ProductUpdateCreate,
    current_user: User = Depends(require_admin),
) -> Response:
    """Email the announcement to your own verified address only."""
    try:
        product_updates.send_test(admin=current_user, body=body)
    except product_updates.ProductUpdateError as exc:
        raise_typed_error(exc, product_updates.PRODUCT_UPDATE_ERROR_STATUS)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/admin/product-updates", response_model=ProductUpdateRead, status_code=status.HTTP_201_CREATED
)
@limiter.limit("10/hour")
def send_product_update(
    request: Request,
    body: ProductUpdateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ProductUpdateRead:
    """Send the announcement: queue one email per consenting verified analyst.

    The worker sends them under the product update daily cap. 409 when the
    release label was already announced.
    """
    try:
        return product_updates.send(db, admin=current_user, body=body)
    except product_updates.ProductUpdateError as exc:
        raise_typed_error(exc, product_updates.PRODUCT_UPDATE_ERROR_STATUS)
