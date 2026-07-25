# AGENTS.md

Instructions for coding agents (and humans) working **on** this repository.
For agents *consuming* the published package, see [llms.txt](llms.txt) instead.

## What this is

`@sidestep/auth` ships Xano's quick-start authentication as typed
[sidestep](https://www.npmjs.com/package/@sidestep/core) defs. It exports plain def
objects; there is **no runtime** — the consumer's `Xano` instance registers and
encodes them. Everything is verified at the compiled-output level.

## Commands

```bash
npm run build       # tsup → dist/ (esm + d.ts)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # tsc --noEmit && vitest run (type-level tests need the typecheck)
```

Run `npm run typecheck && npm run lint && npm test` before committing.

## Layout

- `src/tables/*.ts`, `src/functions/*.ts`, `src/api/*.ts` — one def per module.
- `src/register.ts` — `registerAuth(xano, opts?)`, the one-call install (idempotency-guarded).
- `src/index.ts` — named export per def, plus `registerAuth`.
- `test/*.test.ts` — encode-level fidelity assertions.
- `test/bundle.test.ts` + `test/fixtures/golden-bundle.json` — byte-exact bundle contract.

## Rules that bite

- **Faithful 1:1 port.** The defs recreate Xano's quick-start template exactly.
  Do not "fix" a quirk (e.g. the password hash logged into `event_log.metadata`)
  without a stated reason — the port's fidelity is the point. Documented
  deviations from the source are called out in each module's header comment.
- **References use def handles, never bare names** — `s.db.get({ table: userTable })`,
  `f.tableRef(accountTable)`, `apiGroup: authenticationGroup`. Only self-references
  use the bare-name form.
- **Pin no guids, and no canonical by default.** Identity belongs to the consumer's
  `xano.lock` (fallback: `md5("<kind>:<name>")`). Never hard-code a `guid` or a
  `canonical` in a def. The one exception is the opt-in
  `registerAuth(xano, { canonical })`, which the *consumer* supplies so a browser
  can resolve `getPath()` without a lock — the package itself still pins nothing.
- **`@sidestep/core` is a `peerDependency` with a caret range**; `devDependencies`
  carries the version actually tested. Never make it a regular dependency — one
  shared copy only. The golden-bundle test only exercises the *installed* version,
  so the rest of the peer range is declared but unverified; widen the range only
  when you mean it, and keep the README's and llms.txt's install notes pointing at
  both numbers.
  **The two numbers are allowed to differ, and usually should.** The dev pin is
  "what CI proved this release against" and moves on every core bump. The peer
  floor is "the oldest core whose **types** this package relies on" — currently
  3.9.25, for `db.get`'s miss-to-null in `InferResponse` — and moves only when a
  new core *type* becomes load-bearing here. Too low a floor hands consumers
  silently weaker types instead of an install error; needlessly raising it forces
  an upgrade that buys them nothing. Deciding requires reading the core diff, not
  just watching the suite go green: a patch release that changes nothing this
  package touches moves the dev pin alone.
- **Prefer derivation over `responseShape`.** Declare a shape only where core's
  static walk genuinely can't see the value (a minted token, a filtered result).
  `auth/me` deliberately declares nothing: derivation reads its `output` list, so
  the consumer type and the selected columns cannot drift. A declaration wins over
  derivation and is never cross-checked, so each one is a hand-maintained contract
  — add one only with a stated reason, and pin what *can* be checked in
  `test/types.test.ts` (see how the signup/login key assertions strip the
  declaration with `Omit<…, "responseShape">`).
- **`s.db.add`/`edit` use the `data: [{ name, value }]` array, not the newer
  `row: {}` map.** They are not interchangeable at the byte level: `row` emits the
  engine's full-column form (every column present, unset ones `ignore: true`, plus
  a leading null `id`), which the ported template does not. `row` is the better
  default in new code; here the `data` form is what keeps the bundle byte-faithful.
  Don't "modernize" it.
- **Values stay explicit `c.*`, never bare literals.** Core >= 3.9.27 coerces raw
  literals inside a call/agent `input` map (`input: { action: "login" }` in place of
  `c.text("login")`) and auto-wraps a nested plain object in a record response.
  Verified byte-identical, so it buys nothing here and costs the engine tag at the
  call site — which is load-bearing where a constant is a magic string the engine
  interprets (`c.text("now")` for `created_at`). Keep every value tagged.

## The golden-bundle contract

`test/bundle.test.ts` registers everything on a fresh `Xano`, calls `export()`,
and deep-equals the result against `test/fixtures/golden-bundle.json` (raw, no
normalizer). This is the peer-drift tripwire: a `@sidestep/core` bump that changes
encoding fails here first.

Regenerating the fixture is a deliberate, reviewed act — never do it just to make
a red test pass. If a change legitimately alters the bundle, regenerate, then
review the diff line by line (watch guids, auth flags, stack order, output lists)
before committing.

## Release

Lockstep with the peer. For each core bump:

1. Read the core diff (`llms.txt` and `README.md` between the two versions) before
   touching anything — the suite going green proves no encoding drift, not that the
   package still follows current guidance.
2. Move the `devDependencies` pin to the new version. Move the `peerDependencies`
   floor **only** if a new core type became load-bearing here (see the peer rule
   above).
3. Run `npm run typecheck && npm run lint && npm test`. Regenerate the golden
   fixture only if the bundle legitimately changed, and review that diff line by
   line — most patch bumps change nothing, and an unchanged fixture is the
   expected outcome, not a reason to look harder.
4. Update the install notes in `README.md` **and** `llms.txt` with both numbers
   (floor and tested), then `npm run release:beta`.
