/**
 * Encode-level port-fidelity assertions for the three tables and the
 * event-log function, checked against the quick-start XanoScript sources.
 * (Whole-bundle byte stability is the golden test's job — see bundle.test.ts.)
 */
import { describe, it, expect } from "vitest";
import { encodeTable, encodeFunction } from "xanots";
import { userTable } from "../src/tables/user.js";
import { accountTable } from "../src/tables/account.js";
import { eventLogTable } from "../src/tables/event-log.js";
import { createEventLogFn } from "../src/functions/create-event-log.js";

const QUICK_START_TAG = [{ tag: "xano:quick-start" }];

const GUIDS = {
  user: "CX-2L9cgEG4o9AkPNkWJK792tWs",
  account: "nrR_wBVyH9n79trtWn3pnug7-2c",
  eventLog: "NWjNSptneQ5Gs3PBGX3KY3gZ8Fo",
  createEventLog: "R_0tL5hQFC0aQrgi0qcbjhsMxhE",
};

type Col = { name: string; type: string; nullable: boolean; access: string; values: unknown[]; methods: Array<{ name: string; arg: string[] }>; children: Col[] };
const col = (t: ReturnType<typeof encodeTable>, name: string): Col => {
  const c = (t.schema as unknown as Col[]).find((c) => c.name === name);
  if (!c) throw new Error(`column ${name} not found`);
  return c;
};
const methodNames = (c: Col) => c.methods.map((m) => (m.arg.length ? `${m.name}:${m.arg.join(",")}` : m.name));

describe("user table", () => {
  const u = encodeTable(userTable);

  it("is the auth table with pinned identity and tags", () => {
    expect(userTable.guid).toBe(GUIDS.user);
    expect(u.auth).toBe(true);
    expect(u.use_xdo).toBe(false);
    expect(u.tag).toEqual(QUICK_START_TAG);
  });

  it("carries the source's column set, nullability, and filters", () => {
    expect((u.schema as unknown as Col[]).map((c) => c.name)).toEqual([
      "id", "created_at", "name", "email", "password", "account_id", "role", "password_reset",
    ]);
    expect(col(u, "name").nullable).toBe(false);
    expect(methodNames(col(u, "name"))).toEqual(["trim"]);
    expect(col(u, "email").nullable).toBe(true);
    expect(methodNames(col(u, "email"))).toEqual(["trim", "lower"]);
    expect(col(u, "password").nullable).toBe(true);
    expect(methodNames(col(u, "password"))).toEqual(["min:8", "minAlpha:1", "minDigit:1"]);
  });

  it("hides the password hash (internal access) and keeps created_at private", () => {
    expect(col(u, "password").access).toBe("internal");
    expect(col(u, "created_at").access).toBe("private");
  });

  it("links account_id to the ported account table (deviation from the dangling source ref)", () => {
    expect(methodNames(col(u, "account_id"))).toEqual([`@:dbo=${GUIDS.account}`]);
    expect(col(u, "account_id").nullable).toBe(true);
  });

  it("carries the role enum and password_reset object", () => {
    expect(col(u, "role").type).toBe("enum");
    expect(col(u, "role").values).toEqual(["admin", "member"]);
    const reset = col(u, "password_reset");
    expect(reset.type).toBe("obj");
    expect(reset.children.map((c) => [c.name, c.type, c.nullable])).toEqual([
      ["token", "password", true],
      ["expiration", "epochms", true],
      ["used", "bool", true],
    ]);
  });

  it("indexes: primary(id), btree(created_at desc), unique btree(email asc) — no gin", () => {
    expect(u.index.map((i) => `${i.type}:${i.fields.map((f) => `${f.name}${f.op ? ` ${f.op}` : ""}`).join(",")}`)).toEqual([
      "primary:id",
      "btree:created_at desc",
      "btree|unique:email asc",
    ]);
  });
});

describe("account and event_log tables", () => {
  const a = encodeTable(accountTable);
  const e = encodeTable(eventLogTable);

  it("pin their identities, tags, and xdo storage mode", () => {
    expect(accountTable.guid).toBe(GUIDS.account);
    expect(eventLogTable.guid).toBe(GUIDS.eventLog);
    expect(a.auth).toBe(false);
    expect(e.auth).toBe(false);
    expect(a.use_xdo).toBe(true);
    expect(e.use_xdo).toBe(true);
    expect(a.tag).toEqual(QUICK_START_TAG);
    expect(e.tag).toEqual(QUICK_START_TAG);
  });

  it("emit the engine's canonical index order: primary, gin(xdo), btree(created_at desc)", () => {
    for (const t of [a, e]) {
      expect(t.index.map((i) => `${i.type}:${i.fields.map((f) => f.name).join(",")}`)).toEqual([
        "primary:id",
        "gin:xdo",
        "btree:created_at",
      ]);
      expect(t.index[1]?.fields[0]?.op).toBe("jsonb_path_op");
    }
  });

  it("event_log links user_id and account_id to the ported tables", () => {
    expect(methodNames(col(e, "user_id"))).toEqual([`@:dbo=${GUIDS.user}`]);
    expect(methodNames(col(e, "account_id"))).toEqual([`@:dbo=${GUIDS.account}`]);
    expect(col(e, "action").type).toBe("text");
    expect(methodNames(col(e, "action"))).toEqual(["trim"]);
    expect(col(e, "metadata").type).toBe("json");
  });
});

describe("create_event_log function", () => {
  const fn = encodeFunction(createEventLogFn);

  it("keeps the namespaced source name, guid, and tags verbatim", () => {
    expect(fn.name).toBe("Getting Started Template/create_event_log");
    expect(createEventLogFn.guid).toBe(GUIDS.createEventLog);
    expect(fn.tag).toEqual(QUICK_START_TAG);
  });

  it("requires user_id/account_id/action; metadata stays optional", () => {
    expect(fn.input.map((i) => [i.name, i.required])).toEqual([
      ["user_id", true],
      ["account_id", true],
      ["action", true],
      ["metadata", false],
    ]);
  });

  it("writes one row into event_log (by pinned guid) and responds null", () => {
    expect(fn.run).toHaveLength(1);
    expect(fn.run[0]?.name).toBe("mvp:dbo_add");
    expect((fn.run[0]?.context as { dbo: { id: string } }).dbo.id).toBe(GUIDS.eventLog);
    const names = (fn.run[0]?.input as Array<{ name: string; value: string }>).map((e) => e.name);
    expect(names).toEqual(["created_at", "user_id", "account_id", "action", "metadata"]);
    expect(fn.result).toEqual([
      { filters: [], name: "", tag: "const:null", value: "null", _xsid: "", disabled: false },
    ]);
  });
});
