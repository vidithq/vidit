/**
 * The signed-in analyst's preferences on the server (`GET` / `PATCH /users/me/preferences`).
 *
 * Display preferences live in two places. The server row is the source of truth and follows the
 * account across devices. `localStorage` is the first-paint cache the inline script in the root
 * layout reads before React runs. `syncDisplay` reconciles the two after sign-in, and
 * `saveDisplay` writes a change to both.
 */

import { apiFetch } from "./api";
import type { components } from "./api-types";
import { getSavedHelpHidden, setHelpHidden } from "./helpPreference";
import { getSavedPalette, setPalette } from "./palette";
import { getSavedTheme, setTheme } from "./theme";

export type UserPreferences = components["schemas"]["UserPreferencesRead"];
type DisplayPreferencesUpdate = components["schemas"]["DisplayPreferencesUpdate"];
type UserPreferencesUpdate = components["schemas"]["UserPreferencesUpdate"];

export const PREFERENCES_PATH = "/users/me/preferences";

export function updatePreferences(body: UserPreferencesUpdate): Promise<UserPreferences> {
  return apiFetch<UserPreferences>(PREFERENCES_PATH, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// Bumped by every local change, so a pull that started before one cannot undo it.
let localChanges = 0;

/** Reconcile after sign-in, key by key. A value the account has saved wins and rewrites the
 *  local cache. Where the account has none, a value this browser saved is written up to the
 *  account instead, so a choice made before the account stored it is kept. */
export async function syncDisplay(signal: AbortSignal): Promise<void> {
  const started = localChanges;
  const { display_stored: stored } = await apiFetch<UserPreferences>(PREFERENCES_PATH, {
    signal,
  });
  if (signal.aborted || started !== localChanges) return;

  const upload: DisplayPreferencesUpdate = {};
  const localPalette = getSavedPalette();
  if (stored.palette) setPalette(stored.palette);
  else if (localPalette) upload.palette = localPalette;
  const localTheme = getSavedTheme();
  if (stored.theme) setTheme(stored.theme);
  else if (localTheme) upload.theme = localTheme;
  const localHidden = getSavedHelpHidden();
  if (typeof stored.help_tooltips === "boolean") setHelpHidden(!stored.help_tooltips);
  else if (localHidden !== null) upload.help_tooltips = !localHidden;

  if (Object.keys(upload).length > 0) await updatePreferences({ display: upload });
}

/** Apply a display change locally at once, then write it through to the server. */
export function saveDisplay(change: DisplayPreferencesUpdate): Promise<UserPreferences> {
  localChanges += 1;
  if (change.palette) setPalette(change.palette);
  if (change.theme) setTheme(change.theme);
  if (typeof change.help_tooltips === "boolean") setHelpHidden(!change.help_tooltips);
  return updatePreferences({ display: change });
}
