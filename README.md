# @sidestep/auth

A [sidestep](https://www.npmjs.com/package/@sidestep/core) package implementing
Xano's quick-start authentication — `auth/signup`, `auth/login`, `auth/me`, plus
the `user`, `account`, and `event_log` tables and the event-log function —
recreated as typed sidestep defs you can register into any workspace and version
behind npm.

This package is also the **reference sidestep extension package**: see
[docs/extending-sidestep.md](docs/extending-sidestep.md) for the pattern it
establishes (and which parts of it you should copy vs. re-derive).

**Positioning:** v1 assumes this package provides your workspace's **only**
auth table — the natural fit is a new project adopting it as primary auth. A
workspace that already has its own `auth: true` table cannot use `auth/me`
(export fails on multiple auth tables); the multi-auth-table path is deferred
upstream work.

## Install

```bash
npm install @sidestep/auth @sidestep/core
```

sidestep is a `^2.4.0` peer dependency — install the current stable release. This
package is built and tested against **2.5.1**; the golden-bundle test is the
peer-drift tripwire, but it only ever exercises the installed version, so the
rest of the declared range is supported-by-caret rather than verified in CI.

## Quickstart

```ts
// xano/index.ts
import { workspace } from "@sidestep/core";
import { registerAuth } from "@sidestep/auth";

export default registerAuth(workspace("my-app"));
```

```bash
npx sidestep export   # → importable workspace bundle
```

Import the bundle into your Xano workspace. The endpoints are served under the
Authentication group's canonical — `<instanceUrl>/api:<canonical>/auth/signup`,
`/auth/login`, `/auth/me` — where `<canonical>` is the URL segment your
`xano.lock` minted for the group (see **Identity & the lock** below).

To pin that segment yourself instead — and let a frontend derive the URLs with
`getPath()` and no lock file — pass it at registration:

```ts
export default registerAuth(workspace("my-app"), { canonical: "authn" });
```

## Identity & the lock

This package pins **no** object guids, and no canonical unless you ask for one
(`registerAuth(xano, { canonical })` — see **Resolving the path**; an in-code
value takes precedence over the lock). Otherwise identity comes from the
consuming project, in one of two ways:

- **With `xano.lock` (recommended):** on your first locked export the lock mints
  and freezes a guid for every object and a canonical for the Authentication
  group, then reuses them on every subsequent export. That makes repeated
  imports idempotent (same lock → same identities → updates in place, never
  duplicates) and keeps your API URL stable. Commit `xano.lock`.
- **Without a lock:** each object's guid derives deterministically from its name
  (`md5("<kind>:<name>")`), and the engine assigns the group a random canonical
  at import time. Fine for a one-shot import; use a lock if you re-import.

Because references resolve through the same derivation, the queries bind to the
tables and function correctly under either path — no manual guid wiring.

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

## Calling the endpoints from a typed client

Each query is a def that knows its own route, verb, request payload, and
response shape, so the code that *calls* the API reuses the def instead of
re-typing URLs and bodies. Nothing here is codegen. The *request* types are
derived from each def and cannot drift; the three *response* types are
hand-declared (see **Declared response shapes** below), because a static walk of
the stack can't see through them.

```ts
// Importing the module that calls registerAuth is what pins the canonical —
// without it, the bare getPath() calls below throw. See "Resolving the path".
import "./xano/index.js";
import { loginQuery, meQuery } from "@sidestep/auth";
import type { InferInput, InferResponse } from "@sidestep/core";

const BASE = "https://your-instance.xano.io";

type LoginBody = InferInput<typeof loginQuery>;      // { email?: string; password?: string }
type LoginOut  = InferResponse<typeof loginQuery>;   // { authToken: string; user_id: number }
type MeOut     = InferResponse<typeof meQuery>;      // PublicUser | null

async function login(email: string, password: string): Promise<LoginOut> {
  const res = await fetch(BASE + loginQuery.getPath(), {
    method: loginQuery.verb,                          // "POST"
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password } satisfies LoginBody),
  });
  return res.json();
}

async function me(token: string): Promise<MeOut> {
  const res = await fetch(BASE + meQuery.getPath(), {
    method: meQuery.verb,
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();                                  // may be null — see below
}
```

### Resolving the path

`getPath()` builds `/api:<canonical>/<name>`, so it needs the Authentication
group's canonical. By default this package pins **none** (see **Identity & the
lock**) and a canonical can't be minted on the fly — it must be unique per
instance — so a bare `getPath()` **throws**.

**Pin one at registration** and both sides agree, with no lock file and nothing
for the browser to look up:

```ts
// xano/index.ts — the same module your frontend imports the defs from
import { workspace } from "@sidestep/core";
import { registerAuth } from "@sidestep/auth";

export default registerAuth(workspace("my-app"), { canonical: "authn" });
```

```ts
// anywhere downstream of that module — including a browser bundle
import "./xano/index.js";    // evaluating it is what sets the canonical
import { loginQuery } from "@sidestep/auth";

loginQuery.getPath();        // → /api:authn/auth/login
```

The pin is a side effect of `registerAuth` running, so the registering module
must actually be *evaluated* in that module graph — importing the defs alone is
not enough. Note the tradeoff: pulling `xano/index.ts` into a browser bundle also
pulls in `workspace()` and every def with its full statement stack. To keep that
weight out of the client, pass the segment per call instead —
`loginQuery.getPath({ canonical: "authn" })` — which needs no registration.

An in-code canonical takes precedence over the lock, so the deployed path and
the client-derived path are the same value from one source. It must be a
url-safe segment (`[A-Za-z0-9_-]+`); `registerAuth` rejects anything else rather
than emitting a broken path. It must *also* be unique across the instance's API
groups — that one `registerAuth` cannot check, since it sees only this group, so
a collision surfaces at Xano import time rather than at registration. Because the
group def is shared process-wide, once it is pinned every later `registerAuth` in
the same process must pass the same value: a *different* value throws instead of
silently retargeting the workspace registered earlier, and *omitting* the option
throws too rather than letting that workspace silently inherit the segment.

If you'd rather let the lock own identity, the two lock-based paths still work:

```ts
// A. Pass it per call — the canonical arrives as build config.
loginQuery.getPath({ canonical: "a1b2c3d4" });   // → /api:a1b2c3d4/auth/login

// B. Seed the lock once at startup, then bare getPath() works everywhere.
//    `readLockFile` is Node-only — build scripts/servers, not a browser bundle.
//    The sidestep CLI does this for you.
import { seedLockOverrides } from "@sidestep/core";
import { readLockFile } from "@sidestep/core/node";

seedLockOverrides(readLockFile("./xano.lock"));
loginQuery.getPath();                            // → /api:<locked canonical>/auth/login
```

Run `npx sidestep export --lock` once to mint the canonical and freeze it in
`xano.lock`, then commit that file.

### Declared response shapes

All three responses are declared via `responseShape` rather than inferred,
because a static walk of the stack can't see through them. A declared shape wins
over derivation and the compiler does not cross-check it against the stack, so
treat these as a hand-maintained contract:

- **`signup` / `login`** → `AuthTokenResponse` (`{ authToken, user_id }`). The
  token is minted by `security.create_auth_token`, so its type isn't readable
  off a table. Without the declaration both values derive as `unknown`.
- **`me`** → `PublicUser | null`. This endpoint has deliberately no null-user
  precondition, so a token whose user row was deleted is not guaranteed to
  produce a user; the `| null` forces callers to handle its absence. (The exact
  outcome on that path — null body vs. an error from the `event_log` write — is
  not yet verified against a live instance; see the note in `src/api/me.ts`.)

`PublicUser` itself is derived from the exported `PUBLIC_USER_FIELDS` array,
which is also the `output` list of `auth/me`'s read — so the type and the
selected columns move together.

The package also exports the table row types — `User` (includes the password
hash), `PublicUser` (the projection `auth/me` returns), `Account`, and
`EventLog`. Types erase at compile time, so `import type` adds no bundle bytes.

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
- **Quick-start naming is visible.** Objects keep their source names and
  `xano:quick-start` tags — you'll see "Getting Started Template/
  create_event_log" in your workspace even if you never installed the
  template. Rename them in your own fork if that's confusing; the guids are not
  pinned, so a rename just changes the name-derived identity (pin it in your
  lock first if you've already imported).
- **Your API URL depends on the lock.** The Authentication group's canonical
  (the `/api:<canonical>/` path segment) is minted by your `xano.lock`, or
  randomized by the engine if you import without one. Commit the lock to keep
  the URL stable across re-imports.

## Versioning

The exported bundle is covered by a byte-exact golden test. A sidestep peer bump
that changes the encoded bundle fails this package's test suite before it can
reach you — which is why the peer is pinned exactly and moved in lockstep with
`@sidestep/auth` releases.

## License

MIT
