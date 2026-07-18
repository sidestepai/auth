/**
 * Expected object identities. The defs no longer pin guids — identity is left
 * to the consuming project's `xano.lock` (or, with no lock, the deterministic
 * name-derivation `md5(type:name)`). These tests run with no lock seeded, so
 * the expected guid for each object is exactly its name-derivation. Deriving
 * them here from the same `(type, name)` the defs use proves the *referential*
 * contract: every statement/binding reference resolves to the same identity the
 * target object emits. The committed golden fixture freezes the literal values,
 * so a change to the derivation formula is still caught there.
 */
import { deriveGuid } from "@sidestep/core";

export const GUIDS = {
  user: deriveGuid("dbo", "user"),
  account: deriveGuid("dbo", "account"),
  eventLog: deriveGuid("dbo", "event_log"),
  createEventLog: deriveGuid("function", "Getting Started Template/create_event_log"),
  group: deriveGuid("app", "Authentication"),
  signup: deriveGuid("query", "auth/signup"),
  login: deriveGuid("query", "auth/login"),
  me: deriveGuid("query", "auth/me"),
} as const;

export const QUICK_START_TAG = [{ tag: "xano:quick-start" }];
