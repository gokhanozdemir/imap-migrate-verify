function clean(value) {
  return String(value ?? "-").replace(/[\r\n\t]+/gu, " ").trim();
}

function pad(value, width, align = "left") {
  const text = clean(value);
  const space = " ".repeat(Math.max(0, width - text.length));
  return align === "right" ? `${space}${text}` : `${text}${space}`;
}

export function renderTable(columns, rows) {
  if (!rows.length) return "";
  const widths = columns.map((column) => Math.max(
    clean(column.label).length,
    ...rows.map((row) => clean(row[column.key]).length),
  ));
  const border = (left, middle, right, fill = "─") =>
    `${left}${widths.map((width) => fill.repeat(width + 2)).join(middle)}${right}`;
  const row = (values) => `│${columns.map((column, index) =>
    ` ${pad(values[column.key], widths[index], column.align)} `).join("│")}│`;

  return [
    border("┌", "┬", "┐"),
    row(Object.fromEntries(columns.map((column) => [column.key, column.label]))),
    border("├", "┼", "┤"),
    ...rows.map(row),
    border("└", "┴", "┘"),
  ].join("\n");
}

export function inboxTimelineRows(accounts) {
  const rows = [];
  for (const account of accounts) {
    if (account.inboxCounts?.before) {
      rows.push({
        account: account.email,
        stage: "Before",
        folder: "-",
        yandex: account.inboxCounts.before.yandex,
        guzel: account.inboxCounts.before.guzel,
      });
    }
    for (const iteration of account.inboxCounts?.iterations ?? []) {
      rows.push({
        account: account.email,
        stage: `Batch ${iteration.iteration}/${iteration.totalIterations}`,
        folder: iteration.folder,
        yandex: iteration.yandex,
        guzel: iteration.guzel,
      });
    }
    if (account.inboxCounts?.after) {
      rows.push({
        account: account.email,
        stage: "After",
        folder: "-",
        yandex: account.inboxCounts.after.yandex,
        guzel: account.inboxCounts.after.guzel,
      });
    }
  }
  return rows;
}

export function summaryRows(accounts) {
  return accounts.map((account) => {
    const statuses = Object.groupBy(account.messages ?? [], (message) => message.status);
    return {
      account: account.email,
      result: account.success ? "PASS" : "FAIL",
      checked: account.messages?.length ?? 0,
      copied: statuses["copied-and-verified"]?.length ?? 0,
      elsewhere: statuses["present-in-other-folder"]?.length ?? 0,
      unresolved: statuses.unresolved?.length ?? 0,
      seconds: (account.durationMs / 1_000).toFixed(1),
    };
  });
}
