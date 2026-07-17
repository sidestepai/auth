/**
 * The pinned quick-start identities, hand-copied from the XanoScript sources.
 * Deliberately independent of src/ — tests must assert against these literals,
 * never against `<def>.guid`, or the pin becomes self-referential and stops
 * being a tripwire.
 */
export const GUIDS = {
  user: "CX-2L9cgEG4o9AkPNkWJK792tWs",
  account: "nrR_wBVyH9n79trtWn3pnug7-2c",
  eventLog: "NWjNSptneQ5Gs3PBGX3KY3gZ8Fo",
  createEventLog: "R_0tL5hQFC0aQrgi0qcbjhsMxhE",
  group: "Cr35df6IaPGaULJaUKfBjGjSu78",
  signup: "VWl1Tdrrm17hR5zrCvkA-W-zcyE",
  login: "MQN7cCfXwpnM3BRYA8NBSOB48kI",
  me: "aeu1-p-UhWY0Ymg2QE8xjSDdVKs",
} as const;

export const QUICK_START_TAG = [{ tag: "xano:quick-start" }];
