import assert from "node:assert/strict";
import test from "node:test";
import { classifyImapsyncFailure, formatUidSet } from "../src/imapsync.js";

test("compacts consecutive UIDs into short IMAP ranges", () => {
  assert.equal(formatUidSet([8, 2, 3, 4, 8, 10, 11]), "2:4,8,10:11");
  assert.equal(formatUidSet([]), "");
});

test("classifies destination quota failures as non-transient", () => {
  assert.deepEqual(classifyImapsyncFailure({
    code: 113,
    stdout: "",
    stderr: "could not append [OVERQUOTA] Mailbox is full",
  }), {
    code: "quota_exceeded",
    kind: "quota",
    retryable: false,
    message: "destination mailbox is full; free space on the destination and rerun the same command",
    output: "could not append [OVERQUOTA] Mailbox is full",
  });
  assert.equal(classifyImapsyncFailure({
    code: 42,
    stdout: "Quota limit will be exceeded",
    stderr: "",
  }).code, "quota_exceeded");
});
