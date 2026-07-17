/**
 * The `account` table — companies/teams that users belong to. Ported 1:1 from
 * the Xano quick-start template (`table/account.xs`); the explicit `guid`
 * pins identity so importing over a workspace that already has the quick-start
 * upgrades the same object in place.
 */
import { table, f } from "xanots";

export const accountTable = table({
  name: "account",
  guid: "nrR_wBVyH9n79trtWn3pnug7-2c",
  description: "Stores information about accounts that users belong to",
  auth: false,
  // The source stores fields as JSON under the internal `xdo` column; this also
  // auto-prepends the engine's `gin(xdo)` index in canonical order.
  useXdo: true,
  tags: ["xano:quick-start"],
  schema: {
    name: f.text({ nullable: true, methods: ["trim"], description: "The name of the company." }),
    description: f.text({
      nullable: true,
      methods: ["trim"],
      description: "A brief description of the company.",
    }),
    location: f.text({ nullable: true, methods: ["trim"] }),
  },
});
