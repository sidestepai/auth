# Building a xanots extension package

How to build an npm package that ships reusable Xano workspace objects (tables,
functions, API groups, queries) as typed [xanots](https://github.com/xano-inc/xanots)
defs. **xts-auth is the reference implementation** — this guide documents the
pattern it established, written for the author of the *next* extension package.

> **Provisional (n=1).** These conventions have been validated by exactly one
> package. Sections marked **[reusable]** should generalize; sections marked
> **[port-specific]** are choices xts-auth made because it recreates an
> existing Xano template — re-derive those for your own package rather than
> copying them.

## The model [reusable]

A xanots extension package exports **plain def objects**. xanots factories
(`table()`, `query()`, `defineFunction()`, `apiGroup()`) are identity functions
with zero side effects, so defs cross package boundaries as ordinary values.
The *consumer's* `Xano` instance does all registration and encoding:

```
your-package                        consumer project
  src/tables/*.ts     ──exports──►  registerX(xano) / register* calls
  src/functions/*.ts                        │
  src/api/*.ts                              ▼
  src/register.ts                   xano.export() → importable bundle
```

Two consequences drive everything else:

1. **Statement encoding happens in the consumer's xanots copy** — which is why
   xanots must be a `peerDependency` (one shared copy), never a bundled
   dependency.
2. **Cross-object references are resolved to guids at authoring time** (when
   your module is evaluated), so they are correct in any consumer workspace.

## Project structure [reusable]

```
src/
├── index.ts          # named export per def + the install helper
├── register.ts       # registerX(xano): one-call install, idempotency-guarded
├── tables/*.ts       # one def per module
├── functions/*.ts
└── api/*.ts          # api group + one module per query
test/
├── *.test.ts         # encode-level fidelity assertions
├── bundle.test.ts    # golden-bundle byte-stability contract
└── fixtures/golden-bundle.json
```

Export **both** granular named defs (cherry-picking, tree-shaking, extension)
and a one-call `registerX(xano)` helper (the plug-and-play path). Guard the
helper against double-registration (xts-auth uses a `WeakSet` of installed
instances) — `Xano.register*` does not dedupe, and duplicate auth tables make
`export()` throw.

## References between objects [reusable]

- Always pass **def handles**, not bare names: `s.db.get({ table: userTable })`,
  `f.tableRef(accountTable)`, `apiGroup: authenticationGroup`,
  `fn: createEventLogFn`. Bare-name references resolve to *derived* guids and
  silently miss defs that pin explicit guids.
- Import order follows the reference graph (a def must be constructed before a
  handle to it is resolved). Only self-references need the bare-name form.
- `auth: true` on a query resolves at the consumer's `export()` to *the single
  registered auth table*. If your package ships an auth table, document that
  the consumer must not register another one.

## Identity: leave it to the consumer's lock [reusable rule]

Identity resolution has a three-level precedence: an explicit in-code `guid`
wins; else the consumer's seeded `xano.lock` entry; else `md5("<kind>:<name>")`.

**Default: pin nothing.** A reusable extension package should ship defs with no
explicit `guid` and no explicit `canonical`, and let the *consuming project's*
`xano.lock` mint and freeze them. This is what xts-auth does. The lock belongs
to the project, not the package — so identities (and API URLs) are stable per
project and don't collide when the same package is used across many workspaces.
Without a lock, everything falls back to the deterministic name-derivation,
which is still self-consistent (references and targets agree because both flow
through the same `deriveGuid`).

**When to pin an explicit guid instead:** only when the package must *adopt a
specific object that already exists* in a target workspace — e.g. a port meant
to upgrade Xano's quick-start template objects in place. Pinning couples the
package to those exact guids and overwrites hand-edits on import, so it's a
deliberate adoption choice, not a default. (xts-auth originally pinned the
quick-start guids for exactly this reason, then dropped them: coupling the
reference package to one template's identities was the wrong default.)

The guid is the upgrade contract: same guid ⇒ import updates, different guid ⇒
import creates. Let the lock own that contract unless you have a specific object
to adopt.

## Testing [reusable]

Two levels, both asserting on **compiled output** (there is no runtime here):

1. **Encode-level fidelity tests** — per def, assert the load-bearing fields:
   guids, auth flags, filters/methods, index shapes, stack statement order,
   error contracts, output column lists, response shapes. These document *why*
   each detail matters; see `test/tables.test.ts` / `test/queries.test.ts`.
2. **Golden-bundle test** — register everything on a fresh `Xano`, `export()`,
   and deep-equal against a committed fixture. `export()` is deterministic, so
   compare the **raw** bundle (signature included) with **no normalizer** —
   stripping keys risks blinding the test to exactly the identity fields it
   protects. Regenerating the fixture is an explicit, reviewed act.

The golden test doubles as the **peer-drift tripwire**: when a xanots upgrade
changes encoding, this test fails before consumers are affected.

## Packaging and publishing [reusable]

- ESM-only (`"type": "module"`), `tsup` build (esm + dts), `files: ["dist", "README.md"]`.
- `xanots` in **both** `peerDependencies` (pinned to the **exact** version the
  golden fixture was generated against) and `devDependencies` (for tests).
  Exact pinning matters doubly for prerelease peers: npm semver ranges do not
  match across prerelease tuples, so `>=0.0.2-beta.2 <1.0.0` stops resolving
  the moment xanots rolls to `0.0.3-beta.0`.
- Release in lockstep: bump the peer pin, regenerate + review the golden
  fixture, then `npm version prerelease --preid=beta && npm publish --tag beta`.
- Document the tested peer version in the README install command — consumers
  should install the exact version, not a dist-tag.
- During local development against an unpublished xanots build, point the
  devDependency at a packed tarball (`file:../xanots/xanots-<version>.tgz`);
  switch to the registry version before release so the README quickstart is
  what actually got tested.

## Things that will bite you

- **Register-once semantics** — `Xano.register*` keeps duplicates; guard your
  install helper and tell consumers not to re-register your defs.
- **`db.get` output vs column visibility** — an explicit `output` list
  overrides `internal`/`private` access. That's how login reads the password
  hash; it's also how you accidentally leak one.
- **`export()` mutates encoded objects, not defs** — but treat your module-level
  defs as immutable anyway; they are shared singletons across every consumer
  `Xano` instance in the process.
- **Canonical tokens are unique per Xano instance** — pin one only when you
  intend to own that URL segment (port-specific); the engine self-heals
  collisions with a new token.
