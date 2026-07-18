/**
 * GET `auth/me` — return the authenticated user's record. Ported 1:1 from the
 * quick-start template. Faithful-port quirks: the output list excludes
 * `password`; there is deliberately NO null-user precondition, so a valid
 * token whose user row was deleted returns a null body with HTTP 200; and
 * even this read endpoint writes an `event_log` row.
 *
 * `auth: true` resolves at the consumer's `export()` to the single registered
 * auth table — the consumer must register exactly one (the ported `user`).
 */
import { query, s, ref, auth, c } from "@xanots/core";
import { userTable } from "../tables/user.js";
import { createEventLogFn } from "../functions/create-event-log.js";
import { authenticationGroup } from "./authentication-group.js";

export const meQuery = query({
  name: "auth/me",
  verb: "GET",
  apiGroup: authenticationGroup,
  auth: true,
  description: "Get the user record belonging to the authentication token",
  tags: ["xano:quick-start"],
  input: {},
  stack: [
    // Get the user record based on the auth ID
    s.db.get({
      table: userTable,
      fieldName: "id",
      fieldValue: auth("id"),
      output: ["id", "created_at", "name", "email", "account_id", "role"],
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
});
