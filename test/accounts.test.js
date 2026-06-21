import assert from "node:assert/strict";
import test from "node:test";
import { parseAccounts, parseAccountsJson } from "../src/accounts.js";

test("parses provider-neutral JSON credentials including colon passwords", () => {
  const accounts = parseAccountsJson(JSON.stringify([{
    email: "person@example.com",
    sourcePassword: "source:secret",
    destinationPassword: "destination:secret",
  }]));
  assert.equal(accounts[0].sourcePassword, "source:secret");
  assert.equal(accounts[0].destinationPassword, "destination:secret");
});

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

test("reports every invalid JSON account without echoing secrets", () => {
  assert.throws(
    () => parseAccountsJson(JSON.stringify([
      { email: "not-an-email", sourcePassword: "very-secret", destinationPassword: "also-secret" },
      { email: "ok@example.com", sourcePassword: "", destinationPassword: "hidden" },
    ])),
    (error) => /Account 1: invalid email/.test(error.message)
      && /Account 2: sourcePassword is required/.test(error.message)
      && !/very-secret|also-secret|hidden/u.test(error.message),
  );
});
