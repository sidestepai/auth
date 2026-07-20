/**
 * GET `auth/me` — return the authenticated user's record. Ported 1:1 from the
 * quick-start template. Faithful-port quirks: the output list excludes
 * `password`; there is deliberately NO null-user precondition, so a valid token
 * whose user row was deleted is left to fall through the stack; and even this
 * read endpoint writes an `event_log` row.
 *
 * UNVERIFIED — the exact deleted-user outcome has not been checked against a
 * live instance. The template implies a null body with HTTP 200, but the very
 * next statement calls `createEventLogFn`, whose `user_id`/`account_id` inputs
 * are `required: true` and would receive null on that path, so an input-
 * validation error is at least as likely. `responseShape` widens to
 * `PublicUser | null` either way: both outcomes mean a caller must not assume a
 * row came back. Confirm against a real instance before documenting a status
 * code, and do not "fix" the missing precondition without a stated reason — the
 * port's fidelity is the point.
 *
 * `auth` names the ported `user` table by def handle (core >= 3.0.0 takes the
 * auth table itself, not `true`), so it resolves to that table's guid no matter
 * how many other auth tables the consumer registers.
 */
import { query, s, ref, auth, c } from "@sidestep/core";
import { userTable, PUBLIC_USER_FIELDS, type PublicUser } from "../tables/user.js";
import { createEventLogFn } from "../functions/create-event-log.js";
import { authenticationGroup } from "./authentication-group.js";

export const meQuery = query({
  name: "auth/me",
  verb: "GET",
  apiGroup: authenticationGroup,
  auth: userTable,
  description: "Get the user record belonging to the authentication token",
  tags: ["xano:quick-start"],
  input: {},
  stack: [
    // Get the user record based on the auth ID
    s.db.get({
      table: userTable,
      fieldName: "id",
      fieldValue: auth("id"),
      output: PUBLIC_USER_FIELDS,
      as: "user",
    }),
    // Create an event log for get user record
    s.function.run({
      fn: createEventLogFn,
      as: "event_log",
      input: {
        user_id: ref("user.id"),
        account_id: ref("user.account_id"),
        action: c.text("get_auth_user"),
        metadata: ref("user"),
      },
    }),
  ],
  response: ref("user"),
  // The static walk derives the `output` projection but assumes the row exists.
  // This endpoint has no null-user precondition (see the header note), so the
  // deleted-user path is not guaranteed to produce a user — widen to match, so
  // callers are forced to handle its absence rather than trusting a bare row.
  responseShape: null as PublicUser | null,
});
