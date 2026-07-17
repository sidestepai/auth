/**
 * Encode-level port-fidelity assertions for the Authentication group and the
 * signup/login/me queries — stack order, byte-exact error contract, token
 * expiration, output column selection, and response shapes.
 */
import { describe, it, expect } from "vitest";
import { encodeQuery, encodeApiGroup, deriveGuid } from "xanots";
import { authenticationGroup } from "../src/api/authentication-group.js";
import { signupQuery } from "../src/api/signup.js";
import { loginQuery } from "../src/api/login.js";
import { meQuery } from "../src/api/me.js";
import { GUIDS, QUICK_START_TAG } from "./constants.js";

type Stmt = {
  name: string;
  context: Record<string, any>;
  input: Array<{ name: string; value: string; tag: string }>;
  output?: { customize: boolean; items: Array<{ name: string }> };
};
const run = (q: ReturnType<typeof encodeQuery>) => q.run as unknown as Stmt[];
const inputEntry = (s: Stmt, name: string) => s.input.find((e) => e.name === name);
const resultShape = (q: ReturnType<typeof encodeQuery>) =>
  (q.result as Array<{ name: string; value: string; tag: string }>).map((r) => [r.name, r.value, r.tag]);

describe("Authentication api group", () => {
  it("leaves guid + canonical unset for the lock; queries still bind to it by derived guid", () => {
    const g = encodeApiGroup(authenticationGroup);
    // Empty canonical: the consumer's lock mints it (or the engine assigns it at import).
    expect(g.canonical).toBe("");
    expect(authenticationGroup.guid).toBeUndefined();
    expect(g.tag).toEqual(QUICK_START_TAG);
    // Every query binds to the group's name-derived guid — reference and target agree.
    for (const q of [signupQuery, loginQuery, meQuery]) {
      expect(encodeQuery(q).app.id).toBe(GUIDS.group);
    }
  });
});

describe("auth/signup", () => {
  const q = encodeQuery(signupQuery);

  it("has verb/path/guid/tags and three optional inputs with email filters", () => {
    expect(q.name).toBe("auth/signup");
    expect(q.verb).toBe("POST");
    expect(signupQuery.guid).toBeUndefined();
    expect(q.tag).toEqual(QUICK_START_TAG);
    expect(q.input.map((i) => [i.name, i.required])).toEqual([
      ["name", false],
      ["email", false],
      ["password", false],
    ]);
    const email = q.input.find((i) => i.name === "email") as unknown as {
      methods: Array<{ name: string }>;
    };
    expect(email.methods.map((m) => m.name)).toEqual(["trim", "lower"]);
  });

  it("keeps the exact stack order — duplicate check before password validation", () => {
    expect(run(q).map((s) => s.name)).toEqual([
      "mvp:dbo_getby",
      "mvp:precondition",
      "mvp:dbo_add",
      "mvp:create_auth",
      "mvp:function",
    ]);
  });

  it("duplicate-email precondition is accessdenied with the byte-exact message", () => {
    const pre = run(q)[1]!;
    expect(pre.context.error_type).toBe("accessdenied");
    expect(pre.context.error).toEqual({ value: "This account is already in use.", tag: "const" });
  });

  it("db.add writes created_at:'now' and role:'member'; token lives 86400s", () => {
    const add = run(q)[2]!;
    expect(add.input.map((e) => e.name)).toEqual(["created_at", "name", "email", "password", "role"]);
    expect(inputEntry(add, "created_at")?.value).toBe("now");
    expect(inputEntry(add, "role")?.value).toBe("member");
    const token = run(q)[3]!;
    expect(inputEntry(token, "expiration")?.value).toBe("86400");
    expect(inputEntry(token, "dbtable")?.value).toBe(GUIDS.user);
  });

  it("logs a signup event (account_id 0) against the pinned function guid", () => {
    const log = run(q)[4]!;
    expect(log.context.function.id).toBe(GUIDS.createEventLog);
    expect(inputEntry(log, "action")?.value).toBe("signup");
    expect(inputEntry(log, "account_id")?.value).toBe("0");
    expect(inputEntry(log, "metadata")).toMatchObject({ value: "user", tag: "var" });
  });

  it("responds {authToken, user_id}", () => {
    expect(resultShape(q)).toEqual([
      ["authToken", "authToken", "var"],
      ["user_id", "user.id", "var"],
    ]);
  });
});

describe("auth/login", () => {
  const q = encodeQuery(loginQuery);

  it("pulls the internal password hash via the output list (load-bearing)", () => {
    const get = run(q)[0]!;
    expect(get.output?.customize).toBe(true);
    expect(get.output?.items.map((i) => i.name)).toEqual([
      "id", "created_at", "name", "email", "password", "account_id", "role",
    ]);
  });

  it("keeps the exact stack order with two indistinguishable failure branches", () => {
    expect(run(q).map((s) => s.name)).toEqual([
      "mvp:dbo_getby",
      "mvp:precondition",
      "mvp:check_pass",
      "mvp:precondition",
      "mvp:create_auth",
      "mvp:function",
    ]);
    for (const idx of [1, 3]) {
      const pre = run(q)[idx]!;
      expect(pre.context.error_type).toBe("accessdenied");
      expect(pre.context.error).toEqual({ value: "Invalid Credentials.", tag: "const" });
    }
  });

  it("maps check_password args from the input password and fetched hash", () => {
    const check = run(q)[2]!;
    expect(inputEntry(check, "text_password")).toMatchObject({ value: "password", tag: "input" });
    expect(inputEntry(check, "hash_password")).toMatchObject({ value: "user.password", tag: "var" });
  });

  it("mints a 24h token and logs a login event, responding {authToken, user_id}", () => {
    expect(inputEntry(run(q)[4]!, "expiration")?.value).toBe("86400");
    expect(inputEntry(run(q)[5]!, "action")?.value).toBe("login");
    expect(resultShape(q)).toEqual([
      ["authToken", "authToken", "var"],
      ["user_id", "user.id", "var"],
    ]);
  });
});

describe("auth/me", () => {
  const q = encodeQuery(meQuery);

  it("is an authenticated GET with an empty input block", () => {
    expect(q.verb).toBe("GET");
    expect(meQuery.guid).toBeUndefined();
    expect(q.auth).toBe(true);
    expect(q.input).toEqual([]);
  });

  it("selects the auth user's columns — password absent from the output list", () => {
    const get = run(q)[0]!;
    expect(inputEntry(get, "field_name")?.value).toBe("id");
    expect(inputEntry(get, "field_value")).toMatchObject({ value: "id", tag: "auth" });
    expect(get.output?.items.map((i) => i.name)).toEqual([
      "id", "created_at", "name", "email", "account_id", "role",
    ]);
    expect(get.output?.items.some((i) => i.name === "password")).toBe(false);
  });

  it("has NO null-user precondition (deleted-user tokens yield a null 200) and logs the read", () => {
    expect(run(q).map((s) => s.name)).toEqual(["mvp:dbo_getby", "mvp:function"]);
    expect(inputEntry(run(q)[1]!, "action")?.value).toBe("get_auth_user");
  });

  it("responds with the bare user record (not an object wrapper)", () => {
    expect(resultShape(q)).toEqual([["", "user", "var"]]);
  });
});

describe("identity invariants", () => {
  it("no def pins a guid — identity is left to the consumer's lock / name-derivation", () => {
    expect(signupQuery.guid).toBeUndefined();
    expect(loginQuery.guid).toBeUndefined();
    expect(meQuery.guid).toBeUndefined();
    expect(authenticationGroup.guid).toBeUndefined();
  });

  it("the group binding resolves to the name-derived guid when no lock is seeded", () => {
    expect(encodeQuery(signupQuery).app.id).toBe(deriveGuid("app", "Authentication"));
  });
});
