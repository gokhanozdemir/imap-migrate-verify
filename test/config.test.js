import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrationConfig } from "../src/config.js";

test("loads explicit source and destination providers", () => {
  const config = parseMigrationConfig(JSON.stringify({
    source: { name: "Yandex", host: "imap.yandex.com", port: 993, secure: true },
    destination: {
      name: "Güzel",
      host: "mail.guzel.net.tr",
      port: 993,
      secure: true,
      legacyGreetingCapabilities: true,
      loginMethod: "LOGIN",
    },
  }));
  assert.equal(config.source.host, "imap.yandex.com");
  assert.equal(config.destination.host, "mail.guzel.net.tr");
  assert.equal(config.destination.loginMethod, "LOGIN");
});

test("accepts custom IMAP providers", () => {
  const config = parseMigrationConfig(JSON.stringify({
    source: { name: "Old", host: "old.example", port: 993, secure: true },
    destination: { name: "New", host: "new.example", port: 143, secure: false },
  }));
  assert.equal(config.source.host, "old.example");
  assert.equal(config.destination.secure, false);
});

test("rejects missing or unsafe provider shapes", () => {
  assert.throws(
    () => parseMigrationConfig('{"source":"yandex","destination":{}}'),
    /source must be a provider object/,
  );
  assert.throws(
    () => parseMigrationConfig(JSON.stringify({
      source: { name: "Old", host: "old", port: 0, secure: true },
      destination: { name: "New", host: "new", port: 993, secure: true },
    })),
    /source.port/,
  );
});
