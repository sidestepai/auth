# Building a xanots extension package

How to build an npm package that ships reusable Xano workspace objects (tables,
functions, API groups, queries) as typed [xanots](https://github.com/xano-inc/xanots)
defs. **xanots-auth is the reference implementation** — this guide documents the
pattern it established, written for the author of the *next* extension package.

> **Provisional (n=1).** These conventions have been validated by exactly one
> package. Sections marked **[reusable]** should generalize; sections marked
> **[port-specific]** are choices xanots-auth made because it recreates an
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
helper against double-registration (xanots-auth uses a `WeakSet` of installed
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

## Identity: explicit guids vs derived [port-specific decision, reusable rule]

A def with no `guid` gets one derived from its kind + name — stable, and fine
for a brand-new package. An **explicit** `guid` pins identity to an object that
already exists somewhere.

- **xanots-auth pins the quick-start template's guids, names, and
  `xano:quick-start` tags verbatim** so importing over a workspace that has the
  template *upgrades those objects in place*. That is a port-specific choice —
  the flip side is that hand-edited template objects get overwritten, and the
  template's branding shows up in fresh workspaces.
- **A new extension (no upstream object to align with) should omit explicit
  guids** and use its own naming plus a package-scoped tag (e.g.
  `myext:core`). Derived guids are already deterministic per name.

Either way, the guid is the upgrade contract: same guid ⇒ import updates,
different guid ⇒ import creates. Renaming a def without pinning its guid forks
its identity.

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
