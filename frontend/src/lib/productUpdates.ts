/** Product update emails: the admin send flow (`/admin/product-updates`) and the signed-token
 *  unsubscribe (`/product-updates/unsubscribe`). */

import { apiFetch } from "./api";
import type { components } from "./api-types";

export type ProductUpdateDraft = components["schemas"]["ProductUpdateCreate"];
export type ProductUpdatePreview = components["schemas"]["ProductUpdatePreview"];
export type ProductUpdate = components["schemas"]["ProductUpdateRead"];
export type ProductUpdateList = components["schemas"]["ProductUpdateList"];

export const PRODUCT_UPDATES_PATH = "/admin/product-updates";

function post<T>(path: string, draft: ProductUpdateDraft): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(draft) });
}

export function previewProductUpdate(draft: ProductUpdateDraft): Promise<ProductUpdatePreview> {
  return post(`${PRODUCT_UPDATES_PATH}/preview`, draft);
}

export function sendTestProductUpdate(draft: ProductUpdateDraft): Promise<void> {
  return post(`${PRODUCT_UPDATES_PATH}/test`, draft);
}

export function sendProductUpdate(draft: ProductUpdateDraft): Promise<ProductUpdate> {
  return post(PRODUCT_UPDATES_PATH, draft);
}

export function unsubscribeFromProductUpdates(token: string): Promise<void> {
  return apiFetch<void>(`/product-updates/unsubscribe?token=${encodeURIComponent(token)}`, {
    method: "POST",
  });
}
