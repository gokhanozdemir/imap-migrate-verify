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
npm run migrate -- accounts.txt --days 7 --concurrency 3
npm run migrate -- accounts.txt --dry-run
npm run migrate -- accounts.txt --report-dir private-reports
```

The default audit covers messages whose Yandex IMAP `INTERNALDATE` is within
the last seven days. The destination scan includes a two-day safety buffer.
Each source message is matched anywhere on Güzel by `Message-ID`; missing or
ambiguous IDs fall back to a semantic hash of addresses, subject, date, body,
and attachments. A message found in another folder is reported but not copied.

Reports are written as permission-`0600` JSON and text files. A run passes only
when no recent source message remains unresolved.
