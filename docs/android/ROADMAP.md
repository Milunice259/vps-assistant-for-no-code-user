# VPS Control Widget V1.0 — approved implementation roadmap

Approved by product owner: 2026-11-27. Baseline: f3540b92573a7c9ebf0a3717e432f30c799883d6 (2026-11-12, repository baseline; production identity not yet verified). Work only on feature/android-widget until gates pass. No production changes in Phase 0–4. No paid services or paid runners. Stop and use a free fallback if costs are possible.

## Scope and architecture
One repository, independent Android/backend builds and versions. Native Java, Android SDK XML/RemoteViews, minSdk 29, JobScheduler, platform HTTPS/JSON, Android Keystore + AES-GCM, no third-party runtime libraries, no Firebase, Play Store, new server/container/worker or new database. Keep Android out of Docker build context. APK target <=500 KB, stretch <200 KB, measured signed release. Reuse worker/SQLite: latest bounded per-server snapshot, not duplicate time series. Read-only Mobile API v1, one request per refresh, no SSH/host commands on reads, no background SSE or continuous service. Distinguish actual observations from isActive configuration, online/offline/unknown/stale, timestamps and unavailable metrics. Default best-effort 15-minute sync, manual refresh, cache and network error states. No promises of exact background timing.

V1: overview, connection and settings; VI/EN and light/dark, 2x2 fleet, 2x2 single server, 4x2 and 4x4 multi-server widgets, resize/multiple instances, browser deep links. Settings > Mobile Devices: scoped device pairing, one-time expiring code, optional QR if feasible without adding Android dependencies, revoke and last access. Do not store owner passwords or SSH keys on phone. Tokens scoped to mobile read-only route and current user/server permissions; revocation and disabled users enforced at access. Token hashes server-side, no secrets/logs in repo or CI; HTTPS validation, bounded input/rate limits, no admin-cookie reuse, preserve existing CSRF protections. Device key in Android Keystore, backup excludes credentials. No automatic privileged actions.

## Phases and gates
| Phase | Owner | Deliverable and gate |
|---|---|---|
| 0 Preflight | ChatGPT, Hermes for host evidence | Pin source and production identity, inspect open work, confirm free build workflow or free fallback, branch, roadmap, signing custody; no prod changes. |
| 1 APK PoC | ChatGPT; Hermes only if build environment blocked | Java mock-data widget, signed test APK, actual size/dependency/manifest checks, install and render check. No production connection. |
| 2 API/security | ChatGPT | Latest server snapshot from existing worker; Mobile API v1, device management/pairing/revocation, user scope, auth tests and additive database compatibility. |
| 3 Android | ChatGPT | Overview/connection/settings, all widget layouts, resize, offline/cache/error handling, refresh and secure token storage; mock/staging integration. |
| 4 Integration/QA | ChatGPT; Hermes as needed | Code review, backend lint/types/build/regression, Android build/manifest/size/UI/emulator tests, authorization negative tests, load/storage comparisons, no additional SSH on refresh, rollback plan. |
| 5 Production | Hermes executes; ChatGPT reviews | Backup verified consistent DB and preserve keys, test exact image on isolated copy, confirm rollback, merge reviewed commit only after gate, deploy exact tested image, authenticated smoke tests and resource comparison. No shared Traefik/other VPS changes. |
| 6 Release | ChatGPT; Hermes for signing/artifact handoff if needed | Owner-controlled stable signing key; verify signature/cert SHA-256, APK SHA-256 and size, version android-v1.0.0, signed APK and installation/update instructions, changelog. |
| 7 Acceptance | Owner + ChatGPT | Install/update on real Samsung device, pair, widget sizes/resize/multiple instances, stale/error and refresh/background tests; fix any failures before closing. |

## Roles and operating rules
ChatGPT: primary architecture, development, CI, security and review, source management, documentation and APK handover. Hermes: production read-only evidence, isolated build fallback, deployment/backup and owner-controlled signing if needed. Owner: approves baseline, owns signing key, accepts device experience. Production release only after technical QA and explicit deployment authorization. No workflow on self-hosted or paid runners; standard hosted Ubuntu only if repository permits free use. Do not put signing secrets into public repository or untrusted PR workflows. Short-lived build artifacts; no paid retention. If Actions blocked, use already-owned machine via Hermes, no extra VPS. Never fabricate build/test evidence. Stop unsafe changes, choose bounded fallback, record blockers. Keep source minimal and do not add unrelated refactors.

## Initial preflight evidence (2026-11-27)
- GitHub repository public, default main, connector reports admin/push/pull. No open PR returned and no existing Android branch returned before creation. Base commit: f3540b92573a7c9ebf0a3717e432f30c799883d6.
- Local execution environment: JDK 21 and Node 22 present; no Gradle/ADB/sdkmanager/apksigner/Android SDK discovered. Direct git remote access failed DNS. Connector works for repository reads/writes.
- Existing worker invokes monitoring-metrics and notification-checks sequentially; latter obtains host stats. Reuse that path; confirm completeness and failure classification before implementation.
- Dashboard summary executes host commands and uses isActive configuration; not suitable for widget refresh. Existing remote stats endpoint opens SSH. Existing auth uses vps-session JWT cookies and current database role; maintain separate narrowly scoped mobile token.
- Dockerfile COPY . . and current .dockerignore does not exclude Android; adjust in implementation. Entrypoint uses Prisma db push; test additive schema on disposable DB copy before production.
- Actual production commit/image, Actions settings/billing policy, workflow write/run access, artifact handoff, emulator and signing key custody: unverified. No credentials requested in chat or source.
- Phase 0 status: in progress; blockers and evidence recorded separately as confirmed. No production modifications.

## Reporting
Each phase: completed work, changed files, commit/PR, test commands and observed results, blockers, next actions. Do not mark a gate passed without evidence. Track the latest status in docs/android/STATUS.md.
