import assert from "node:assert/strict";
import test from "node:test";
import { formatUidSet } from "../src/imapsync.js";

test("compacts consecutive UIDs into short IMAP ranges", () => {
  assert.equal(formatUidSet([8, 2, 3, 4, 8, 10, 11]), "2:4,8,10:11");
  assert.equal(formatUidSet([]), "");
});
