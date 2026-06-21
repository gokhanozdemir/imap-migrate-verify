import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrationConfig } from "../src/config.js";

test("resolves built-in presets and permits explicit overrides", () => {
  const config = parseMigrationConfig(JSON.stringify({
    source: { preset: "yandex", host: "imap.yandex.example" },
    destination: "guzel",
  }));
  assert.equal(config.source.name, "Yandex");
  assert.equal(config.source.host, "imap.yandex.example");
  assert.equal(config.destination.host, "mail.guzel.net.tr");
  assert.equal(config.destination.loginMethod, "LOGIN");

  const defaults = parseMigrationConfig('{"source":"yandex","destination":"guzel"}');
  assert.equal(defaults.source.host, "imap.yandex.com");
  assert.equal(defaults.source.port, 993);
});

test("accepts custom IMAP providers", () => {
  const config = parseMigrationConfig(JSON.stringify({
    source: { name: "Old", host: "old.example", port: 993, secure: true },
    destination: { name: "New", host: "new.example", port: 143, secure: false },
  }));
  assert.equal(config.source.host, "old.example");
  assert.equal(config.destination.secure, false);
});

test("rejects unknown presets and unsafe provider shapes", () => {
  assert.throws(
    () => parseMigrationConfig('{"source":"unknown","destination":"guzel"}'),
    /Unknown source preset/,
  );
  assert.throws(
    () => parseMigrationConfig('{"source":{"host":"old","port":0,"secure":true},"destination":"guzel"}'),
    /source.port/,
  );
});
