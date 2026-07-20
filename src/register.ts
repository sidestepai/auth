/**
 * One-call install: registers the full auth set (tables, function, api group,
 * queries) onto a consumer's `Xano` instance.
 *
 * Constraints (enforced/documented):
 * - Call it once per instance — a second call would register duplicate defs,
 *   and duplicate auth tables make `export()` throw. Guarded by a WeakSet.
 * - The consumer must not register another `auth: true` table: `auth/me`'s
 *   `auth: true` resolves at export() to the single registered auth table.
 * - Do not additionally pass this package's defs to your own register* calls.
 */
import type { Xano } from "@sidestep/core";
import { userTable } from "./tables/user.js";
import { accountTable } from "./tables/account.js";
import { eventLogTable } from "./tables/event-log.js";
import { createEventLogFn } from "./functions/create-event-log.js";
import { authenticationGroup } from "./api/authentication-group.js";
import { signupQuery } from "./api/signup.js";
import { loginQuery } from "./api/login.js";
import { meQuery } from "./api/me.js";

const installed = new WeakSet<Xano>();

/**
 * The alphabet `mintCanonical()` emits (url-safe base64). Anything outside it
 * would land in the URL path unescaped and produce a broken endpoint — core
 * does not validate a hand-supplied canonical, so this package does.
 */
const CANONICAL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Options for {@link registerAuth}. */
export interface RegisterAuthOptions {
  /**
   * Pin the Authentication group's canonical — the `<canonical>` in
   * `/api:<canonical>/auth/login`.
   *
   * By default this package pins none, so identity comes from the consumer's
   * `xano.lock` and `getPath()` throws until that lock is seeded (unavailable
   * in a browser bundle). Passing one here sets it as an explicit in-code
   * value, which takes precedence over the lock, so the deployed path is
   * stable *and* a bare `getPath()` resolves client-side with no lock:
   *
   * ```ts
   * export default registerAuth(workspace("my-app"), { canonical: "authn" });
   * loginQuery.getPath();   // → /api:authn/auth/login
   * ```
   *
   * Must be a url-safe segment (`[A-Za-z0-9_-]+`) and must be unique per Xano
   * instance across all workspaces — reusing another group's canonical collides
   * at import.
   */
  canonical?: string;
}

/**
 * Register every @sidestep/auth def on the given instance; returns it for
 * chaining. Pass `{ canonical }` to pin the Authentication group's URL segment
 * so `getPath()` resolves without a lock (see {@link RegisterAuthOptions}).
 */
export function registerAuth<X extends Xano>(xano: X, opts: RegisterAuthOptions = {}): X {
  if (installed.has(xano)) {
    throw new Error(
      "registerAuth: already called on this Xano instance. Register the auth set once — " +
        "a second registration duplicates defs and makes export() fail on multiple auth tables.",
    );
  }

  // Validate before mutating anything, so a bad call leaves no partial state.
  const { canonical } = opts;
  if (canonical !== undefined) {
    if (!CANONICAL_PATTERN.test(canonical)) {
      throw new Error(
        `registerAuth: canonical ${JSON.stringify(canonical)} is not a valid URL segment — ` +
          "it must be non-empty and match [A-Za-z0-9_-]+ (the alphabet Xano mints). " +
          'It becomes the "<canonical>" in /api:<canonical>/auth/login.',
      );
    }
    // `authenticationGroup` is a module singleton shared by every instance in
    // the process, so a second, differing canonical would silently retarget the
    // group already registered elsewhere. Surface that instead.
    const prior = authenticationGroup.canonical;
    if (prior !== undefined && prior !== canonical) {
      throw new Error(
        `registerAuth: the Authentication group's canonical is already pinned to ${JSON.stringify(prior)}; ` +
          `refusing to change it to ${JSON.stringify(canonical)}. The group def is shared across every Xano ` +
          "instance in this process, so re-pinning it would also retarget the workspace that set it first. " +
          "Use one canonical per process, or build the workspaces in separate processes.",
      );
    }
    authenticationGroup.canonical = canonical;
  }

  installed.add(xano);
  xano
    .registerTables([userTable, accountTable, eventLogTable])
    .registerFunctions([createEventLogFn])
    .registerApiGroups([authenticationGroup])
    .registerQueries([signupQuery, loginQuery, meQuery]);
  return xano;
}
