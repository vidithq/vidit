/**
 * The signed-in analyst's preferences on the server (`GET` / `PATCH /users/me/preferences`).
 *
 * Display preferences live in two places. The server row is the source of truth and follows the
 * account across devices. `localStorage` is the first-paint cache the inline script in the root
 * layout reads before React runs. `pullDisplay` copies the server values into the cache, and
 * `saveDisplay` writes a change to both.
 */

import { apiFetch } from "./api";
import type { components } from "./api-types";
import { setHelpHidden } from "./helpPreference";
import { setPalette } from "./palette";
import { setTheme } from "./theme";

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

/** Rewrite the local cache with the server's values: after sign-in the server wins. */
export async function pullDisplay(signal: AbortSignal): Promise<void> {
  const started = localChanges;
  const { display } = await apiFetch<UserPreferences>(PREFERENCES_PATH, { signal });
  if (signal.aborted || started !== localChanges) return;
  setPalette(display.palette);
  setTheme(display.theme);
  setHelpHidden(!display.help_tooltips);
}

/** Apply a display change locally at once, then write it through to the server. */
export function saveDisplay(change: DisplayPreferencesUpdate): Promise<UserPreferences> {
  localChanges += 1;
  if (change.palette) setPalette(change.palette);
  if (change.theme) setTheme(change.theme);
  if (typeof change.help_tooltips === "boolean") setHelpHidden(!change.help_tooltips);
  return updatePreferences({ display: change });
}
