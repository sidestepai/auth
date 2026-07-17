# xts-auth

Xano's quick-start authentication — `auth/signup`, `auth/login`, `auth/me`,
plus the `user`, `account`, and `event_log` tables and the event-log function —
recreated as typed [xanots](https://www.npmjs.com/package/xanots) defs you can
register into any workspace and version behind npm.

This package is also the **reference xanots extension package**: see
[docs/extending-xanots.md](docs/extending-xanots.md) for the pattern it
establishes (and which parts of it you should copy vs. re-derive).

**Positioning:** v1 assumes this package provides your workspace's **only**
auth table — the natural fit is a new project adopting it as primary auth. A
workspace that already has its own `auth: true` table cannot use `auth/me`
(export fails on multiple auth tables); the multi-auth-table path is deferred
upstream work.

## Install

```bash
npm install xts-auth xanots@0.0.2-beta.2
```

Pin the **exact** xanots version shown — it is the version this release's
golden-bundle contract was verified against. (Prerelease semver ranges and the
moving `@beta` dist-tag both break or drift across beta tuples; each
xts-auth release documents its tested peer.)

## Quickstart

Pick your situation first:

- **Fresh workspace** — proceed below; the import creates all objects.
- **Workspace that already has Xano's quick-start template** — the import
  *upgrades those same objects in place* (identities are guid-pinned). Any
  hand-edits you made to the template's auth objects **will be replaced**.
- **Workspace with its own `user` table (not from the quick-start)** — stop:
  your table has a different guid, so the import would create a *second* table
  named `user`. Don't import this package into such a workspace.

```ts
// xano/index.ts
import { workspace } from "xanots";
import { registerAuth } from "xts-auth";

export default registerAuth(workspace("my-app"));
```

```bash
npx xanots export   # → importable workspace bundle
```

Import the bundle into your Xano workspace; the endpoints are then live at
`<instanceUrl>/api:QC35j52Y/auth/signup`, `/auth/login`, and `/auth/me`.

Cherry-picking instead of the turnkey install works too — every def is a named
export (`userTable`, `accountTable`, `eventLogTable`, `createEventLogFn`,
`authenticationGroup`, `signupQuery`, `loginQuery`, `meQuery`). Register the
defs you want; keep their dependencies together (queries need `userTable`,
`createEventLogFn` needs `eventLogTable`). Never register a def twice, and
call `registerAuth` at most once per instance (it throws on a second call).

## Endpoints

### POST `auth/signup`

| Input | Type | Notes |
|---|---|---|
| `name` | text, optional | trimmed at the column |
| `email` | email, optional | `trim` + `lower` at input and column |
| `password` | text, optional | column policy: min 8 chars, ≥1 letter, ≥1 digit |

Creates the user with `role: "member"`, mints a 24-hour token, logs a
`signup` event. Response: `{ authToken, user_id }`.

Errors: duplicate email → `accessdenied` `"This account is already in use."`
(this check fires **before** password validation, so a duplicate email with a
bad password reports the duplicate). Password-policy violations surface as
table validation errors, not `accessdenied`.

### POST `auth/login`

| Input | Type | Notes |
|---|---|---|
| `email` | email, optional | `trim` + `lower` |
| `password` | text, optional | |

Verifies the password against the stored hash, mints a 24-hour token, logs a
`login` event. Response: `{ authToken, user_id }`.

Errors: unknown email and wrong password both return `accessdenied`
`"Invalid Credentials."` — deliberately indistinguishable.

### GET `auth/me` (authenticated)

Returns the token's user record: `{ id, created_at, name, email, account_id,
role }` (never `password`). Logs a `get_auth_user` event.

## Tables

- **`user`** (auth table) — `name`, `email` (unique, case-insensitively via
  the lower filter), `password` (internal visibility), `account_id` →
  `account`, `role` (`admin` | `member`), `password_reset` object (reserved
  for the quick-start's reset flow; no reset endpoints ship in v1).
- **`account`** — `name`, `description`, `location`.
- **`event_log`** — `user_id`, `account_id`, `action`, `metadata` (json).

## Behavior notes (read before production)

This is a **faithful 1:1 port** of Xano's quick-start template. Its quirks are
preserved on purpose — changing them here would fork the template's behavior:

- **`event_log.metadata` contains password hashes.** Signup and login log the
  full fetched user record — including the hash — into `event_log`. Treat
  `event_log` with the same access and retention discipline as `user` itself.
- **Request history records plaintext credentials.** Xano's request history
  defaults ON for query endpoints, so signup/login request bodies (plaintext
  passwords) and minted `authToken`s are captured in history. Disable history
  on the Authentication group, or scope who can read it, before production.
- **Every endpoint writes an event-log row** — including the `auth/me` GET.
  The table grows unbounded; there is no pruning or retention mechanism. You
  own its lifecycle.
- **Deleted user, valid token** → `auth/me` returns a `null` body with HTTP
  200 (the source has no null-user guard). Null-check downstream.
- **Tokens live 24h with no refresh or revocation.** Multiple valid tokens
  per user is normal; password changes don't invalidate existing tokens.
- **Signup reveals account existence** ("already in use") — a deliberate
  template behavior; login's failures are indistinguishable.
- **Exactly one auth table.** Registering another `auth: true` table makes
  `export()` throw.
- **Quick-start branding is visible.** Objects keep their source names and
  `xano:quick-start` tags — you'll see "Getting Started Template/
  create_event_log" in your workspace even if you never installed the
  template. This is what makes upgrade-in-place idempotent.
- **Canonical collisions self-heal.** Two workspaces on one instance importing
  canonical `QC35j52Y` — the engine assigns the second a new URL token;
  endpoint paths keep working, just under a different `api:` segment.

## Versioning

The exported bundle is covered by a byte-exact golden test. A xanots peer bump
that changes the encoded bundle fails this package's test suite before it can
reach you — which is why the peer is pinned exactly and moved in lockstep with
xts-auth releases.

## License

MIT
