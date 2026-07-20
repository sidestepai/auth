/**
 * Global test hygiene. Two pieces of state in this package are process-wide
 * rather than per-instance — the `authenticationGroup` module singleton (which
 * `registerAuth({ canonical })` mutates) and core's lock overrides. Vitest's
 * per-file isolation happens to hide leaks between files, but describe-scoped
 * cleanup left ordering inside a file load-bearing. Reset both after every test
 * so no case depends on which one ran before it.
 */
import { afterEach } from "vitest";
import { resetLockOverrides } from "@sidestep/core";
import { authenticationGroup } from "../src/api/authentication-group.js";

afterEach(() => {
  delete authenticationGroup.canonical;
  resetLockOverrides();
});
