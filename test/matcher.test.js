import assert from "node:assert/strict";
import test from "node:test";
import { finalizeMatches, matchInventories } from "../src/matcher.js";

function item(id, hash, folder = "INBOX", extra = {}) {
  return { messageId: id, semanticHash: hash, folder, folderKey: folder.toLowerCase(), ...extra };
}

test("matches unique Message-IDs", () => {
  const result = matchInventories([item("one", "source")], [item("one", "destination")]);
  assert.equal(result[0].status, "present");
});

test("uses semantic hashes for duplicated Message-IDs as a multiset", () => {
  const source = [item("duplicate", "a"), item("duplicate", "a")];
  const destination = [item("duplicate", "a")];
  assert.deepEqual(matchInventories(source, destination).map(({ status }) => status), ["present", "missing"]);
});

test("uses semantic hashes when Message-ID is absent", () => {
  const result = matchInventories([item(null, "same")], [item(null, "same")]);
  assert.equal(result[0].status, "present");
});

test("finds a message in another folder without duplicating it", () => {
  const result = matchInventories(
    [item("one", "same", "INBOX")],
    [item("one", "same", "Archive")],
  );
  assert.equal(result[0].status, "present-in-other-folder");
});

test("higher destination count cannot hide a missing source message", () => {
  const source = [item("wanted-1", "a"), item("wanted-2", "b")];
  const destination = [
    item("wanted-1", "a"),
    item("new-1", "x"),
    item("new-2", "y"),
  ];
  const result = matchInventories(source, destination);
  assert.equal(destination.length > source.length, true);
  assert.deepEqual(result.map(({ status }) => status), ["present", "missing"]);
});

test("marks newly found messages as copied and unresolved messages as failures", () => {
  const source = [item("one", "a"), item("two", "b")];
  const before = matchInventories(source, []);
  const after = matchInventories(source, [item("one", "a")]);
  assert.deepEqual(finalizeMatches(before, after).map(({ status }) => status), [
    "copied-and-verified",
    "unresolved",
  ]);
});

test("a second verification consumes existing messages without creating work", () => {
  const source = [item("one", "a"), item("two", "b")];
  const destination = [item("one", "a"), item("two", "b")];
  assert.equal(matchInventories(source, destination).some(({ status }) => status === "missing"), false);
});
