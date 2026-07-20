/**
 * Response shapes shared by the auth endpoints.
 *
 * `signup` and `login` both return `{ authToken, user_id }` built from
 * `security.create_auth_token` plus a `user.id` reference. The static response
 * walk can see those keys but not their value types (a token is minted by a
 * statement, not read off a table), so both queries declare this via
 * `responseShape` — closing `unknown` for every consumer.
 */
import type { User } from "../tables/user.js";

/** What `auth/signup` and `auth/login` hand back on success. */
export type AuthTokenResponse = {
  /** The minted bearer token — 24h lifetime, no refresh or revocation. */
  authToken: string;
  /** The authenticated user's primary key. */
  user_id: User["id"];
};
