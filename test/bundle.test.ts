/**
 * The byte-stability contract: the full exported bundle deep-equals the
 * committed golden fixture — RAW, signature included, with no normalization.
 * `Xano.export()` is fully deterministic (no timestamps, no randomness), so
 * nothing needs stripping; a normalizer would only risk hiding drift in the
 * very fields (guids, app bindings, indexes, canonical) this contract exists
 * to protect. Regenerating the fixture is an explicit, reviewed act.
 *
 * This is the tripwire that catches upstream xanots encoding drift when the
 * peer dependency is bumped.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { Xano } from "xanots";
import { registerAuth } from "../src/index.js";

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/golden-bundle.json", import.meta.url), "utf8"),
);

const exportBundle = () =>
  registerAuth(new Xano().registerWorkspace({ name: "xts-auth-golden" })).export() as any;

describe("golden bundle", () => {
  it("the exported bundle deep-equals the committed fixture, signature included", () => {
    expect(exportBundle()).toEqual(golden);
  });

  it("export is deterministic across instances", () => {
    expect(JSON.stringify(exportBundle())).toBe(JSON.stringify(exportBundle()));
  });

  it("every guid referenced by a statement or binding resolves to a payload object", () => {
    const bundle = exportBundle();
    const p = bundle.payload;
    const known = new Set<string>(
      [...p.dbo, ...p.function, ...p.app, ...p.query].map((o: { guid: string }) => o.guid),
    );

    const referenced: string[] = [];
    for (const q of p.query) {
      referenced.push(q.app.id); // api-group binding
      if (typeof q.auth === "string") referenced.push(q.auth); // auth-table binding
    }
    const collectFromRun = (run: any[]) => {
      for (const stmt of run) {
        if (stmt.context?.dbo?.id) referenced.push(stmt.context.dbo.id); // db targets
        if (stmt.context?.function?.id) referenced.push(stmt.context.function.id); // function.run
        for (const entry of stmt.input ?? []) {
          if (entry.name === "dbtable") referenced.push(entry.value); // create_auth table
        }
      }
    };
    for (const q of p.query) collectFromRun(q.run);
    for (const fn of p.function) collectFromRun(fn.run);
    for (const t of p.dbo) {
      for (const col of t.schema) {
        for (const m of col.methods ?? []) {
          if (m.name === "@") referenced.push(String(m.arg[0]).replace(/^dbo=/, "")); // tableRefs
        }
      }
    }

    expect(referenced.length).toBeGreaterThanOrEqual(15);
    for (const guid of referenced) {
      expect(known).toContain(guid);
    }
  });
});
