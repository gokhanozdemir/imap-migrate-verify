# IMAP migration verifier

This command-line tool verifies and repairs a one-way email migration from
Yandex to Güzel Hosting. Folder counts are shown for context, but success is
based on matching every individual recent Yandex message on the destination.

The tool never deletes, moves, or overwrites messages. It asks imapsync to copy
only the exact source UIDs that the recent-message audit found missing.
Destination-only mail is expected after an MX change and does not cause a
failure.

## Requirements

- Node.js 20 or newer
- `imapsync` installed with Homebrew
- Yandex IMAP access enabled and, when required, a Yandex application password

Güzel uses a compatibility bootstrap because the endpoint advertises its IMAP
capabilities in the greeting but rejects the standard pre-login `CAPABILITY`
command. It also rejects both advertised SASL mechanisms, so the client uses
the classic IMAP `LOGIN` command over TLS.

```sh
brew install imapsync
npm install
```

## Account file

Copy `accounts.example.txt` to `accounts.txt` and add one account per line:

```text
email:yandex-password:guzel-password
```

Blank lines and lines beginning with `#` are ignored. Colons cannot appear in
passwords. `accounts.txt` and generated reports are ignored by Git. The tool
uses password files with mode `0600` when invoking imapsync; passwords are not
placed in process arguments or logs.

## Run

```sh
npm run migrate -- accounts.txt
```

Useful options:

```sh
npm run migrate -- accounts.txt --concurrency 3
npm run migrate -- accounts.txt --days 7
npm run migrate -- accounts.txt --dry-run 
npm run migrate -- accounts.txt --report-dir private-reports
npm run migrate -- accounts.txt --restart
```

The default audit covers the complete mailbox history. Use `--days 7` (or any
other positive number) when a faster recent-message audit is wanted. For a
limited window, the destination scan includes a two-day safety buffer. Each
source message is matched anywhere on Güzel by `Message-ID`; missing or
ambiguous IDs fall back to a semantic hash of addresses, subject, date, body,
and attachments. Full bodies are downloaded only when an ID is absent or
duplicated. A message found in another folder is reported but not copied.
Large mailboxes are processed in bounded UID batches: metadata in groups of
250, full ambiguous-message bodies in groups of 25, and imapsync repair jobs in
groups of 200. Consecutive UIDs are compacted into ranges.

Non-dry runs save private, atomic checkpoints under the report directory. If a
destination mailbox fills up, that account is paused while other accounts keep
running. Free destination space and rerun the same command to reconcile any
partially copied batch and resume the remaining work. Checkpoints contain
message metadata and UIDs, never passwords or message bodies. Use `--restart`
to discard compatible saved progress and inventory the account again.
After a successful verification, the state directory records the account's
last successful sync time. Later runs with the same servers and audit settings
skip that account automatically; use `--restart` to force a new verification.
Report and state directories contain their own deny-all `.gitignore`, and the
repository ignore rules cover account lists and common private-data filenames.

The console and reports show Yandex and Güzel Inbox totals before migration,
after every repair batch, and after final verification. Folder metadata progress
is printed while large mailboxes are being inventoried. At completion, the CLI
prints boxed Inbox-timeline and verification-summary tables.

Reports are written as permission-`0600` JSON and text files. A run passes only
when no recent source message remains unresolved.
