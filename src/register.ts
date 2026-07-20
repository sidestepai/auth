/**
 * One-call install: registers the full auth set (tables, function, api group,
 * queries) onto a consumer's `Xano` instance.
 *
 * Constraints (enforced/documented):
 * - Call it once per instance — a second call would register duplicate defs.
 *   Guarded by a WeakSet.
 * - The consumer may register their own `auth: true` table alongside this one:
 *   `auth/me` names the ported `user` table, so it is unaffected.
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
   * Must be a url-safe segment (`[A-Za-z0-9_-]+`); `registerAuth` rejects
   * anything else. It must *also* be unique per Xano instance across all
   * workspaces, which `registerAuth` cannot check — it sees only this group, so
   * a collision with an unrelated group surfaces at import, not here.
   *
   * The group def is a process-wide singleton, so once any `registerAuth` pins
   * it, every later call in the same process must pass the same value; both a
   * conflicting value and an omitted one throw rather than silently retarget or
   * inherit.
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
        "a second registration duplicates every def in the exported bundle.",
    );
  }

  // Validate before mutating anything, so a bad call leaves no partial state.
  const { canonical } = opts;
  // `authenticationGroup` is a module singleton shared by every instance in the
  // process, so whatever an earlier `registerAuth` pinned is still on the def.
  const prior = authenticationGroup.canonical;

  if (canonical === undefined) {
    // Omitting the option does NOT unpin: this workspace would silently inherit
    // the earlier one's segment and ship it in its own bundle, producing exactly
    // the per-instance collision the explicit-conflict guard below prevents.
    if (prior !== undefined) {
      throw new Error(
        `registerAuth: the Authentication group's canonical is already pinned to ${JSON.stringify(prior)} ` +
          "by an earlier registerAuth() in this process, and the group def is shared process-wide — this " +
          "workspace would inherit that segment rather than its own lock-derived one, colliding at import. " +
          `Pass { canonical: ${JSON.stringify(prior)} } to accept it deliberately, or build the workspaces ` +
          "in separate processes.",
      );
    }
  } else {
    // `RegExp.test` stringifies its argument, so a non-string (a JS consumer, or
    // a canonical read out of untyped JSON/env config) would pass the pattern and
    // then be stored unconverted. Check the type first.
    if (typeof canonical !== "string" || !CANONICAL_PATTERN.test(canonical)) {
      throw new Error(
        `registerAuth: canonical ${JSON.stringify(canonical)} is not a valid URL segment — ` +
          "it must be a non-empty string matching [A-Za-z0-9_-]+ (the alphabet Xano mints). " +
          'It becomes the "<canonical>" in /api:<canonical>/auth/login.',
      );
    }
    // A second, differing canonical would silently retarget the group already
    // registered elsewhere. Surface that instead.
    if (prior !== undefined && prior !== canonical) {
      throw new Error(
        `registerAuth: the Authentication group's canonical is already pinned to ${JSON.stringify(prior)}; ` +
          `refusing to change it to ${JSON.stringify(canonical)}. The group def is shared across every Xano ` +
          "instance in this process, so re-pinning it would also retarget the workspace that set it first. " +
          "Use one canonical per process, or build the workspaces in separate processes.",
      );
    }
  }

  // The pin has to be in place *before* `registerApiGroups`, which snapshots the
  // group's canonical. So mutate first, then roll back if the chain throws (a
  // consumer's conflicting table, say) — otherwise a failed call would leave the
  // process-wide singleton pinned and the corrective retry would report
  // "already called" instead of the real cause.
  if (canonical !== undefined) authenticationGroup.canonical = canonical;
  try {
    xano
      .registerTables([userTable, accountTable, eventLogTable])
      .registerFunctions([createEventLogFn])
      .registerApiGroups([authenticationGroup])
      .registerQueries([signupQuery, loginQuery, meQuery]);
  } catch (err) {
    if (canonical !== undefined) {
      if (prior === undefined) delete authenticationGroup.canonical;
      else authenticationGroup.canonical = prior;
    }
    throw err;
  }

  installed.add(xano);
  return xano;
}
