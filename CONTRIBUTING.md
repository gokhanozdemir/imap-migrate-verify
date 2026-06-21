# Contributing to Yandex Escape

Thanks for helping make mailbox migrations less nerve-racking.

## Development setup

1. Install Node.js 20 or newer.
2. Run `npm ci`.
3. Run `npm test` before and after your change.

Unit tests must not connect to real mailboxes. Inject fake IMAP and imapsync
dependencies, as the existing migration tests do. Never commit credentials,
reports, message metadata, or real email addresses.

## Pull requests

- Keep changes focused and explain the user-visible behavior.
- Add tests for new parsing, matching, migration, and recovery behavior.
- Update the README when the public CLI or configuration changes.
- Preserve the promise that source mail is never deleted or modified.

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.
