# AGENTS.md

Instructions for coding agents (and humans) working **on** this repository.
For agents *consuming* the published package, see [llms.txt](llms.txt) instead.

## What this is

`@xanots/auth` ships Xano's quick-start authentication as typed
[xanots](https://www.npmjs.com/package/@xanots/core) defs. It exports plain def
objects; there is **no runtime** — the consumer's `Xano` instance registers and
encodes them. Everything is verified at the compiled-output level.

## Commands

```bash
npm run build       # tsup → dist/ (esm + d.ts)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # vitest run
```

Run `npm run typecheck && npm run lint && npm test` before committing.

## Layout

- `src/tables/*.ts`, `src/functions/*.ts`, `src/api/*.ts` — one def per module.
- `src/register.ts` — `registerAuth(xano)`, the one-call install (idempotency-guarded).
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
- **Pin no guids and no canonical.** Identity belongs to the consumer's `xano.lock`
  (fallback: `md5("<kind>:<name>")`). Don't add explicit `guid`/`canonical`.
- **`@xanots/core` is a `peerDependency` pinned to an exact version**, mirrored in
  `devDependencies`. Never make it a regular dependency — one shared copy only.

## The golden-bundle contract

`test/bundle.test.ts` registers everything on a fresh `Xano`, calls `export()`,
and deep-equals the result against `test/fixtures/golden-bundle.json` (raw, no
normalizer). This is the peer-drift tripwire: a `@xanots/core` bump that changes
encoding fails here first.

Regenerating the fixture is a deliberate, reviewed act — never do it just to make
a red test pass. If a change legitimately alters the bundle, regenerate, then
review the diff line by line (watch guids, auth flags, stack order, output lists)
before committing.

## Release

Lockstep with the peer: bump the `@xanots/core` pin, regenerate + review the
golden fixture, then `npm run release:beta`. Document the tested peer version in
the README install command.
