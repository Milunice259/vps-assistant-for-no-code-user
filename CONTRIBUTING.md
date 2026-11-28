# Contributing to VPS Control

Thanks for helping make VPS management safer for non-technical users.

## Good contributions

- Beginner-friendly UX, docs, and tooltips.
- Mobile and large-fleet UI improvements.
- Safer guided repair actions with clear audit logs.
- Tests around risky actions, backups, deploys, and secret redaction.
- Integrations for notifications, health checks, backups, and service discovery.

## Before opening a pull request

Use the [local setup](docs/INSTALLATION.md) with a disposable development database. Then run checks appropriate to your change:

| Change | Validation |
| --- | --- |
| Docs / images | Relative links, commands against source, image provenance and visual rendering |
| Web / backend | `npm run lint`, `npx --no-install tsc --noEmit`, `npm run build -- --webpack`; relevant regressions |
| Mobile API | The mobile backend workflow's fixture tests, including auth/scope/restore behavior |
| Android app | JVM policies, SDK build and API29/35 native workflow; screenshots for UI |
| Release tools | Existing owner-signer verification workflow; no real stable key in CI |

The offline runner is `TMPDIR=/tmp node scripts/check-conf3-regressions.cjs`; it uses an explicit reviewed allowlist. Other scripts can start servers, provision containers or change runtime data: do not execute them by wildcard. See the runner's excluded classifications before choosing a test.

For UI changes, include screenshots or a short screen recording.

## Product principles

- Safe Mode first.
- Explain before fixing.
- Audit every server-changing action.
- Never expose secrets in logs, API responses, screenshots, or docs.
- Prefer clear guided flows over terminal commands.
- Treat timestamps, unknown values and cached observations honestly; never label historical data as current online state.
- Keep test source in Git. Generated APKs, keystores, local databases and credentials do not belong in commits.

## Pull request style

Keep PRs small and focused. Explain:

1. What changed.
2. Why it helps non-technical users.
3. How you tested it.

## Security

Do not open public issues with secrets, credentials, or exploit details. Use GitHub Security Advisories if enabled, or contact the maintainer directly.
