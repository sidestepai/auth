# @sidestep/auth

A [sidestep](https://www.npmjs.com/package/@sidestep/core) package implementing
Xano's quick-start authentication — `auth/signup`, `auth/login`, `auth/me`, plus
the `user`, `account`, and `event_log` tables and the event-log function —
recreated as typed sidestep defs you can register into any workspace and version
behind npm.

This package is also the **reference sidestep extension package** — the source
layout here (def modules + explicit registration, def-handle references,
identity left to the consumer's lock, the golden-bundle contract) is the pattern
to copy when building your own.

**Positioning:** the natural fit is a new project adopting this as primary
auth, but it no longer has to be your workspace's only auth table — core 3.0.0
binds each endpoint to a named auth table, and `auth/me` names the `user` table
this package ships, so a workspace with its own `auth: true` table can register
both.

## Install

```bash
npm install @sidestep/auth @sidestep/core
```

sidestep is a `^3.9.25` peer dependency — install the current stable release.
This package is built and tested against **3.9.27**; the golden-bundle test is
the peer-drift tripwire, but it only ever exercises the installed version, so
the rest of the declared range is supported-by-caret rather than verified in CI.

The floor is `3.9.25` rather than `3.0.0` because `auth/me`'s response type is
*derived* from its stack instead of hand-declared, and that derivation needs
core's miss-to-null handling for `db.get` (issue #105). On an older 3.x the defs
still encode to the identical bundle — every emitted byte is unchanged from the
3.0.0 build — but `InferResponse<typeof meQuery>` would silently lose its
`| null`, which is exactly the kind of quiet type regression a peer floor exists
to prevent.

The floor sits below the tested version on purpose: 3.9.25 is the oldest core
this package's *types* need, and it has been run green against this exact source,
so it is a verified minimum rather than a declared one. Nothing in 3.9.26/3.9.27
changed anything these defs touch.

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
derived from each def and cannot drift; `auth/me`'s response is derived too,
while `signup`/`login` hand-declare theirs (see **Response shapes** below).

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

### Response shapes

- **`me`** → `PublicUser | null`, **derived** from the stack. Core's static walk
  narrows the `db.get` to the columns in its `output` list and carries that
  statement's miss-to-null, so the type and the selected columns move together —
  edit the `output` and every consumer's type follows. Nothing is declared here,
  so nothing can drift. The `| null` is the endpoint's deliberately missing
  null-user precondition showing up in the type: a token whose user row was
  deleted is not guaranteed to produce a user, so callers must handle its
  absence. (What that path actually *does* — most likely a 500 rather than a
  null body — is still unverified against a live instance; see the note in
  `src/api/me.ts`.)
- **`signup` / `login`** → `AuthTokenResponse` (`{ authToken, user_id }`),
  **declared** via `responseShape`. The token is minted by
  `security.create_auth_token`, so its type isn't readable off a table and
  derivation gives `unknown`. A declared shape wins over derivation and the
  compiler does not cross-check it against the stack, so these two are a
  hand-maintained contract — the type tests pin the declared *keys* against the
  keys the walk does see.

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
  This package ships the engine default (the queries inherit), but you can turn
  it off **in code** before registering — the queries inherit from the group, so
  one line covers all three:

  ```ts
  import { workspace } from "@sidestep/core";
  import { authenticationGroup, registerAuth } from "@sidestep/auth";

  authenticationGroup.history = false;               // no capture for signup/login/me
  export default registerAuth(workspace("my-app"));
  ```

  Like `canonical`, the group def is a process-wide singleton, so this applies
  to every workspace built in the same process.
- **Every endpoint writes an event-log row** — including the `auth/me` GET.
  The table grows unbounded; there is no pruning or retention mechanism. You
  own its lifecycle.
- **Deleted user, valid token** → `auth/me` does not return a user (the source
  has no null-user guard). The response type is `PublicUser | null`, so
  null-check downstream — but the runtime outcome is most likely an HTTP 500
  rather than a 200 with a null body: the `db.get` binds null and the next
  statement drills `user.id` out of it, which core documents as a runtime
  "Unable to locate var" (issue #47). Unverified against a live instance.
- **Tokens live 24h with no refresh or revocation.** Multiple valid tokens
  per user is normal; password changes don't invalidate existing tokens.
- **Signup reveals account existence** ("already in use") — a deliberate
  template behavior; login's failures are indistinguishable.
- **Your own auth table may coexist.** `auth/me` names this package's `user`
  table explicitly, so registering another `auth: true` table is fine — it just
  isn't what these endpoints authenticate against.
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
reach you — which is why the peer floor moves in lockstep with `@sidestep/auth`
releases, and only ever to a version this package has been rebuilt and retested
against.

## License

MIT
