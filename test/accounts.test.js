import assert from "node:assert/strict";
import test from "node:test";
import { parseAccounts } from "../src/accounts.js";

test("parses accounts while ignoring comments and blank lines", () => {
  const accounts = parseAccounts(`
# migration batch
one@example.com:yandex-one:guzel-one

two@example.com:yandex-two:guzel-two
`);
  assert.deepEqual(accounts.map(({ email }) => email), ["one@example.com", "two@example.com"]);
});

test("rejects malformed rows without exposing their contents", () => {
  assert.throws(
    () => parseAccounts("person@example.com:too:many:fields"),
    /Line 1: expected exactly/,
  );
});
