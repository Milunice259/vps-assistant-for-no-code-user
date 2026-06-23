# Contributing to VPS Control

Thanks for helping make VPS management safer for non-technical users.

## Good contributions

- Beginner-friendly UX, docs, and tooltips.
- Mobile and large-fleet UI improvements.
- Safer guided repair actions with clear audit logs.
- Tests around risky actions, backups, deploys, and secret redaction.
- Integrations for notifications, health checks, backups, and service discovery.

## Before opening a pull request

```bash
npm run lint
npm run build
```

For UI changes, include screenshots or a short screen recording.

## Product principles

- Safe Mode first.
- Explain before fixing.
- Audit every server-changing action.
- Never expose secrets in logs, API responses, screenshots, or docs.
- Prefer clear guided flows over terminal commands.

## Pull request style

Keep PRs small and focused. Explain:

1. What changed.
2. Why it helps non-technical users.
3. How you tested it.

## Security

Do not open public issues with secrets, credentials, or exploit details. Use GitHub Security Advisories if enabled, or contact the maintainer directly.
