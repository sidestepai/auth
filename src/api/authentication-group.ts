/**
 * The `Authentication` API group. The pinned `canonical` keeps the public URL
 * segment (`/api:QC35j52Y/...`) identical to the quick-start template; the
 * guid pins object identity for upgrade-in-place imports.
 */
import { apiGroup } from "xanots";

export const authenticationGroup = apiGroup({
  name: "Authentication",
  guid: "Cr35df6IaPGaULJaUKfBjGjSu78",
  canonical: "QC35j52Y",
  description:
    "This group provides endpoints for user login, signup, and reset password, returning authentication tokens and user records.",
  tags: ["xano:quick-start"],
});
