/**
 * registerAuth / export-surface behavior on a consumer `Xano` instance:
 * turnkey install, granular registration, auth-table resolution, and the
 * guard rails (double-install, second auth table).
 */
import { describe, it, expect } from "vitest";
import { Xano, table, f, seedLockOverrides, emptyLock, lockKey } from "@sidestep/core";
import {
  registerAuth,
  userTable,
  authenticationGroup,
  loginQuery,
  meQuery,
  signupQuery,
  createEventLogFn,
  accountTable,
  eventLogTable,
} from "../src/index.js";
import { GUIDS } from "./constants.js";

type Bundle = {
  payload: {
    dbo: Array<{ name: string; guid: string }>;
    function: Array<{ name: string; guid: string }>;
    app: Array<{ name: string; guid: string }>;
    query: Array<{ name: string; guid: string; auth: unknown }>;
  };
};

const freshInstance = () => new Xano().registerWorkspace({ name: "consumer-app" });

describe("registerAuth (turnkey install)", () => {
  it("registers the full set and exports cleanly", () => {
    const xano = registerAuth(freshInstance());
    const bundle = xano.export() as unknown as Bundle;
    expect(bundle.payload.dbo.map((d) => d.name).sort()).toEqual(["account", "event_log", "user"]);
    expect(bundle.payload.function.map((d) => d.name)).toEqual([
      "Getting Started Template/create_event_log",
    ]);
    expect(bundle.payload.app.map((d) => d.name)).toEqual(["Authentication"]);
    expect(bundle.payload.query.map((d) => d.name).sort()).toEqual([
      "auth/login",
      "auth/me",
      "auth/signup",
    ]);
  });

  it("stamps the name-derived guid for each object (no lock seeded)", () => {
    const bundle = registerAuth(freshInstance()).export() as unknown as Bundle;
    const guids = [
      ...bundle.payload.dbo,
      ...bundle.payload.function,
      ...bundle.payload.app,
      ...bundle.payload.query,
    ].map((o) => o.guid);
    for (const derived of Object.values(GUIDS)) {
      expect(guids).toContain(derived);
    }
  });

  it("leaves the api group's canonical empty for the lock/engine to assign", () => {
    const bundle = registerAuth(freshInstance()).export() as unknown as Bundle & {
      payload: { app: Array<{ canonical: string }> };
    };
    expect(bundle.payload.app[0]?.canonical).toBe("");
  });

  it("resolves auth/me's auth:true to the ported user table's guid", () => {
    const bundle = registerAuth(freshInstance()).export() as unknown as Bundle;
    const me = bundle.payload.query.find((q) => q.name === "auth/me");
    expect(me?.auth).toBe(GUIDS.user);
  });

  it("returns the same instance for chaining", () => {
    const xano = freshInstance();
    expect(registerAuth(xano)).toBe(xano);
  });

  it("throws a clear error when called twice on the same instance", () => {
    const xano = registerAuth(freshInstance());
    expect(() => registerAuth(xano)).toThrow(/already called on this Xano instance/);
  });
});

describe("consumer workspace with use_xdo:true", () => {
  it("does not flip the user table's storage mode", () => {
    type Dbo = { name: string; use_xdo: boolean; index: Array<{ type: string }> };
    const bundle = registerAuth(
      new Xano().registerWorkspace({ name: "consumer-app", use_xdo: true }),
    ).export() as unknown as { payload: { dbo: Dbo[] } };
    const user = bundle.payload.dbo.find((d) => d.name === "user");
    expect(user?.use_xdo).toBe(false);
    expect(user?.index.some((i) => i.type === "gin")).toBe(false);
  });
});

describe("granular registration", () => {
  it("a cherry-picked subset (login only) exports cleanly", () => {
    const bundle = freshInstance()
      .registerTables([userTable, accountTable, eventLogTable])
      .registerFunctions([createEventLogFn])
      .registerApiGroups([authenticationGroup])
      .registerQueries([loginQuery])
      .export() as unknown as Bundle;
    expect(bundle.payload.query.map((q) => q.name)).toEqual(["auth/login"]);
  });
});

describe("single-auth-table constraint (documented, pinned by test)", () => {
  it("export throws when the consumer registers a second auth table", () => {
    const second = table({ name: "admin_user", auth: true, schema: { email: f.email() } });
    const xano = registerAuth(freshInstance()).registerTables([second]);
    expect(() => xano.export()).toThrow();
  });
});

describe("registerAuth ({ canonical }) — issue #2", () => {
  // `authenticationGroup` is a module singleton, so every test here mutates
  // shared state. The reset lives in `test/setup.ts` so it applies to every
  // file unconditionally, rather than depending on describe ordering here.

  it("pins the group's canonical so a bare getPath() resolves with no lock", () => {
    const xano = registerAuth(freshInstance(), { canonical: "authn" });
    // The deployed path and the client-derived path agree — the point of #2.
    const app = (xano.export() as unknown as Bundle).payload.app[0] as unknown as {
      canonical: string;
    };
    expect(app.canonical).toBe("authn");
    expect(loginQuery.getPath()).toBe("/api:authn/auth/login");
    expect(meQuery.getPath()).toBe("/api:authn/auth/me");
    expect(signupQuery.getPath()).toBe("/api:authn/auth/signup");
  });

  it("leaves the canonical unpinned when no option is passed", () => {
    registerAuth(freshInstance());
    expect(authenticationGroup.canonical).toBeUndefined();
  });

  it("rejects a canonical that is not a url-safe segment, without mutating the def", () => {
    const bad = [
      "", // empty
      "auth/n", // path separator — would split the URL segment
      "auth n",
      "auth?x", // query separator
      "authn!",
      "..", // path traversal
      "authn\n", // `$` is strict without the /m flag; pinned so a future edit can't relax it
      "auth\nn",
      "authn٣", // non-ASCII digit — \d-style classes would let this through
    ];
    for (const value of bad) {
      expect(() => registerAuth(freshInstance(), { canonical: value })).toThrow(
        /not a valid URL segment/,
      );
      expect(authenticationGroup.canonical).toBeUndefined();
    }
  });

  it("rejects a non-string canonical instead of coercing it", () => {
    // `RegExp.test` stringifies, so `123` and `["authn"]` match the pattern via
    // their string form and would then be stored unconverted. JS consumers, and
    // TS consumers reading a canonical out of env/JSON config, hit this.
    for (const value of [123, ["authn"], { toString: () => "authn" }, true, null]) {
      expect(() =>
        registerAuth(freshInstance(), { canonical: value as unknown as string }),
      ).toThrow(/not a valid URL segment/);
      expect(authenticationGroup.canonical).toBeUndefined();
    }
  });

  it("refuses to let a later workspace silently inherit an earlier pin", () => {
    // The group def is process-wide, so omitting the option does not unpin it.
    // Without this guard workspace B would ship A's segment and collide at
    // import — the exact failure the conflicting-value guard exists to prevent.
    registerAuth(freshInstance(), { canonical: "authn" });
    expect(() => registerAuth(freshInstance())).toThrow(/already pinned to "authn"/);
    expect(authenticationGroup.canonical).toBe("authn");
  });

  it("an in-code canonical wins over the lock, and a per-call one wins over both", () => {
    const lock = emptyLock();
    const key = lockKey("app", "Authentication");
    lock.objects[key] = { ...(lock.objects[key] ?? {}), canonical: "fromlock" };
    seedLockOverrides(lock);

    const xano = registerAuth(freshInstance(), { canonical: "pinned" });
    const app = (xano.export() as unknown as Bundle).payload.app[0] as unknown as {
      canonical: string;
    };
    expect(app.canonical).toBe("pinned");
    expect(loginQuery.getPath()).toBe("/api:pinned/auth/login");
    expect(loginQuery.getPath({ canonical: "percall" })).toBe("/api:percall/auth/login");
  });

  it("rejects a double install before touching the shared group def", () => {
    const xano = registerAuth(freshInstance(), { canonical: "authn" });
    // The idempotency guard runs first, so a repeat call cannot re-pin or unpin.
    expect(() => registerAuth(xano, { canonical: "other" })).toThrow(/already called/);
    expect(authenticationGroup.canonical).toBe("authn");
  });

  it("reports canonical validation, not double-install, on a fresh instance", () => {
    // Ordering check: the `installed` guard precedes validation, so this only
    // holds for an instance that has not been registered yet.
    expect(() => registerAuth(freshInstance(), { canonical: "bad!" })).toThrow(
      /not a valid URL segment/,
    );
  });

  // NOTE: `registerAuth` rolls the canonical back if the register* chain throws
  // (src/register.ts), but no current register* call has a throwing path — a
  // duplicate table name is accepted, and the second-auth-table conflict only
  // surfaces at export(). The rollback is defensive and deliberately untested;
  // if a future core version makes registration fail, add a case here.

  it("accepts re-pinning the same value, but refuses a conflicting one", () => {
    registerAuth(freshInstance(), { canonical: "authn" });
    // Same value on another instance is a no-op, not an error.
    expect(() => registerAuth(freshInstance(), { canonical: "authn" })).not.toThrow();
    // A different value would silently retarget the first workspace's group.
    expect(() => registerAuth(freshInstance(), { canonical: "other" })).toThrow(
      /already pinned to "authn"/,
    );
    expect(authenticationGroup.canonical).toBe("authn");
  });
});
