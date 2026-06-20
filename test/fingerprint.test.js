import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintMessage, normalizeMessageId } from "../src/fingerprint.js";

function message(extraHeaders = "", messageId = "") {
  return Buffer.from([
    `From: Alice <alice@example.com>`,
    `To: Bob <bob@example.com>`,
    `Subject: Migration test`,
    `Date: Thu, 19 Jun 2025 10:00:00 +0300`,
    messageId ? `Message-ID: ${messageId}` : "",
    extraHeaders,
    `Content-Type: text/plain; charset=utf-8`,
    "",
    "Hello from the migration test.\r\n",
  ].filter(Boolean).join("\r\n"));
}

test("normalizes Message-ID values", () => {
  assert.equal(normalizeMessageId(" <ABC@Example.COM> "), "abc@example.com");
  assert.equal(normalizeMessageId(""), null);
});

test("semantic fingerprint ignores transport headers for messages without IDs", async () => {
  const first = await fingerprintMessage(message("Received: by old.example"));
  const second = await fingerprintMessage(message("Received: by new.example"));
  assert.equal(first.messageId, null);
  assert.equal(first.semanticHash, second.semanticHash);
});

test("attachment content contributes to the semantic fingerprint", async () => {
  const makeMultipart = (content) => Buffer.from([
    "From: a@example.com",
    "To: b@example.com",
    "Subject: Attachment",
    "Date: Thu, 19 Jun 2025 10:00:00 +0300",
    "Content-Type: multipart/mixed; boundary=x",
    "",
    "--x",
    "Content-Type: text/plain",
    "",
    "Body",
    "--x",
    "Content-Type: application/octet-stream; name=file.bin",
    "Content-Disposition: attachment; filename=file.bin",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(content).toString("base64"),
    "--x--",
    "",
  ].join("\r\n"));
  const first = await fingerprintMessage(makeMultipart("first"));
  const second = await fingerprintMessage(makeMultipart("second"));
  assert.notEqual(first.semanticHash, second.semanticHash);
});
