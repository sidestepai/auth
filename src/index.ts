/**
 * xanots-auth — Xano's quick-start authentication surface (signup/login/me,
 * user/account/event_log tables, event-log function) as typed xanots defs.
 *
 * Use `registerAuth(xano)` for the turnkey install, or register individual
 * defs for granular control. All cross-object references are guid-resolved at
 * authoring time, so the defs work inside any consumer workspace.
 */
export { registerAuth } from "./register.js";

export { userTable } from "./tables/user.js";
export { accountTable } from "./tables/account.js";
export { eventLogTable } from "./tables/event-log.js";
export { createEventLogFn } from "./functions/create-event-log.js";

export { authenticationGroup } from "./api/authentication-group.js";
export { signupQuery } from "./api/signup.js";
export { loginQuery } from "./api/login.js";
export { meQuery } from "./api/me.js";
