import assert from "node:assert/strict";
import test from "node:test";
import { isAuthenticationError, withTransientRetry } from "../src/imap.js";

test("recognizes provider authentication failures without retrying", async () => {
  const error = Object.assign(new Error("Command failed"), {
    responseStatus: "BAD",
    responseText: "Please authenticate first",
    authenticationFailed: true,
  });
  let attempts = 0;
  await assert.rejects(
    withTransientRetry(async () => {
      attempts += 1;
      throw error;
    }),
    /Command failed/,
  );
  assert.equal(isAuthenticationError(error), true);
  assert.equal(attempts, 1);
});
