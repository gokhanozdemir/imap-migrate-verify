import assert from "node:assert/strict";
import test from "node:test";
import { inboxTimelineRows, renderTable, summaryRows } from "../src/table.js";

test("renders aligned boxed tables", () => {
  const table = renderTable(
    [
      { key: "name", label: "Name" },
      { key: "count", label: "Count", align: "right" },
    ],
    [{ name: "Inbox", count: 12 }],
  );
  assert.match(table, /┌───────┬───────┐/);
  assert.match(table, /│ Inbox │    12 │/);
});

test("builds Inbox timeline and verification summary rows", () => {
  const accounts = [{
    email: "person@example.com",
    success: true,
    durationMs: 1_500,
    inboxCounts: {
      before: { yandex: 100, guzel: 90 },
      iterations: [{ iteration: 1, totalIterations: 1, folder: "INBOX", yandex: 100, guzel: 100 }],
      after: { yandex: 100, guzel: 100 },
    },
    messages: [
      { status: "present" },
      { status: "copied-and-verified" },
      { status: "present-in-other-folder" },
    ],
  }];
  assert.deepEqual(inboxTimelineRows(accounts).map((row) => row.stage), ["Before", "Batch 1/1", "After"]);
  assert.deepEqual(summaryRows(accounts)[0], {
    account: "person@example.com",
    result: "PASS",
    checked: 3,
    copied: 1,
    elsewhere: 1,
    unresolved: 0,
    seconds: "1.5",
  });
});
