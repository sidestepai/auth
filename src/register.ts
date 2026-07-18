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
import type { Xano } from "@xanots/core";
import { userTable } from "./tables/user.js";
import { accountTable } from "./tables/account.js";
import { eventLogTable } from "./tables/event-log.js";
import { createEventLogFn } from "./functions/create-event-log.js";
import { authenticationGroup } from "./api/authentication-group.js";
import { signupQuery } from "./api/signup.js";
import { loginQuery } from "./api/login.js";
import { meQuery } from "./api/me.js";

const installed = new WeakSet<Xano>();

/** Register every xts-auth def on the given instance; returns it for chaining. */
export function registerAuth<X extends Xano>(xano: X): X {
  if (installed.has(xano)) {
    throw new Error(
      "registerAuth: already called on this Xano instance. Register the auth set once — " +
        "a second registration duplicates defs and makes export() fail on multiple auth tables.",
    );
  }
  installed.add(xano);
  xano
    .registerTables([userTable, accountTable, eventLogTable])
    .registerFunctions([createEventLogFn])
    .registerApiGroups([authenticationGroup])
    .registerQueries([signupQuery, loginQuery, meQuery]);
  return xano;
}
