/**
 * Type-level contract for the consumer-facing surface. These assertions are
 * compile-time only — `expectTypeOf` erases at runtime, so a failure here is a
 * `vitest`/`tsc` type error, not a failed expectation. They exist because the
 * inferred response types are a published API: a core upgrade that changes the
 * static response walk, or an edit to a `db.get` `output` list, should break
 * here rather than silently degrade a consumer's types to `unknown`.
 */
import { describe, it, expectTypeOf } from "vitest";
import type { InferInput, InferResponse, InferRow } from "@sidestep/core";
import {
  signupQuery,
  loginQuery,
  meQuery,
  userTable,
  type User,
  type PublicUser,
  type Account,
  type EventLog,
  type AuthTokenResponse,
} from "../src/index.js";

describe("row types", () => {
  it("User is the full row, including the internal password hash", () => {
    expectTypeOf<User>().toEqualTypeOf<InferRow<typeof userTable>>();
    expectTypeOf<User>().toHaveProperty("password");
    expectTypeOf<User["id"]>().toEqualTypeOf<number>();
    expectTypeOf<User["role"]>().toEqualTypeOf<"admin" | "member">();
  });

  it("PublicUser is the endpoint projection and excludes the password hash", () => {
    expectTypeOf<PublicUser>().not.toHaveProperty("password");
    expectTypeOf<PublicUser>().not.toHaveProperty("password_reset");
    // The columns the auth endpoints' `output` lists actually select.
    expectTypeOf<PublicUser>().toEqualTypeOf<
      Pick<User, "id" | "created_at" | "name" | "email" | "account_id" | "role">
    >();
  });

  it("exposes the remaining table rows", () => {
    expectTypeOf<Account>().toHaveProperty("name");
    expectTypeOf<EventLog>().toHaveProperty("action");
    expectTypeOf<EventLog>().toHaveProperty("metadata");
  });
});

describe("response types", () => {
  it("signup and login resolve to the declared token shape, not unknown", () => {
    expectTypeOf<InferResponse<typeof signupQuery>>().toEqualTypeOf<AuthTokenResponse>();
    expectTypeOf<InferResponse<typeof loginQuery>>().toEqualTypeOf<AuthTokenResponse>();
    expectTypeOf<AuthTokenResponse["authToken"]>().toEqualTypeOf<string>();
    expectTypeOf<AuthTokenResponse["user_id"]>().toEqualTypeOf<User["id"]>();
  });

  it("me is nullable — a valid token for a deleted row returns a null body", () => {
    expectTypeOf<InferResponse<typeof meQuery>>().toEqualTypeOf<PublicUser | null>();
  });
});

describe("input types", () => {
  it("derives the request payloads from each query's input map", () => {
    // Faithful to the port: none of the auth inputs are `required`, so every
    // key is optional. Tightening this would fork the template's behavior.
    expectTypeOf<InferInput<typeof loginQuery>>().toEqualTypeOf<{
      email?: string;
      password?: string;
    }>();
    expectTypeOf<InferInput<typeof signupQuery>>().toEqualTypeOf<{
      name?: string;
      email?: string;
      password?: string;
    }>();
  });

  it("me takes no inputs", () => {
    // `InferInput` of an empty input map is the empty object type; assert on
    // its keys rather than the type itself (`{}` trips no-empty-object-type).
    expectTypeOf<keyof InferInput<typeof meQuery>>().toEqualTypeOf<never>();
  });
});
