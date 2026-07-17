/**
 * registerAuth / export-surface behavior on a consumer `Xano` instance:
 * turnkey install, granular registration, auth-table resolution, and the
 * guard rails (double-install, second auth table).
 */
import { describe, it, expect } from "vitest";
import { Xano, table, f } from "xanots";
import {
  registerAuth,
  userTable,
  authenticationGroup,
  loginQuery,
  createEventLogFn,
  accountTable,
  eventLogTable,
} from "../src/index.js";

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

  it("stamps the pinned guids into the bundle payload verbatim", () => {
    const bundle = registerAuth(freshInstance()).export() as unknown as Bundle;
    const guids = [
      ...bundle.payload.dbo,
      ...bundle.payload.function,
      ...bundle.payload.app,
      ...bundle.payload.query,
    ].map((o) => o.guid);
    for (const pinned of [
      "CX-2L9cgEG4o9AkPNkWJK792tWs",
      "nrR_wBVyH9n79trtWn3pnug7-2c",
      "NWjNSptneQ5Gs3PBGX3KY3gZ8Fo",
      "R_0tL5hQFC0aQrgi0qcbjhsMxhE",
      "Cr35df6IaPGaULJaUKfBjGjSu78",
      "VWl1Tdrrm17hR5zrCvkA-W-zcyE",
      "MQN7cCfXwpnM3BRYA8NBSOB48kI",
      "aeu1-p-UhWY0Ymg2QE8xjSDdVKs",
    ]) {
      expect(guids).toContain(pinned);
    }
  });

  it("resolves auth/me's auth:true to the ported user table's guid", () => {
    const bundle = registerAuth(freshInstance()).export() as unknown as Bundle;
    const me = bundle.payload.query.find((q) => q.name === "auth/me");
    expect(me?.auth).toBe("CX-2L9cgEG4o9AkPNkWJK792tWs");
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
