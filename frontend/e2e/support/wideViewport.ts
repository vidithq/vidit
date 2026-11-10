import { test } from "@playwright/test";

/** Skips the calling test on every project but the first. A test that sets its own wide viewport
 *  measures the same on each project, so one run holds it. */
export function runAtOneWidth(): void {
  const info = test.info();
  test.skip(info.project.name !== info.config.projects[0].name, "Sets its own wide viewport.");
}
