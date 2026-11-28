> Historical checkpoint, frozen before the 1.3.0 publication receipt was reconciled. Read [current status](../STATUS.md) first. Pending/not-started statements and old paths below describe their original checkpoint, not the current product.

## 2026-11-28 — 1.2.0 widget customization published; cleanup started

- Owner requested per-widget background transparency, softer daylight appearance, horizontal bars and more display choices. Stable 1.2.0 is now published; 1.1.0 remains the previous signed release.
- Released app: stable package unchanged, version 1.2.0 / 10200. Separate QA4 package/key is disposable and must never replace a stable update.
- Per-instance draft editor: live native preview, app/light/dark theme, 0–100% background transparency, four accent colors, auto/gauges/bars/numbers, comfortable/compact fleet density and independent server selection. Gear on each widget and app Settings entries open its editor; Save commits appearance/selection together, Cancel discards, Reset changes appearance only. A dedicated 4×1 strip (minimum 250×72dp, resize width ≥230dp) supplies an actual low horizontal widget; launcher resize controls the outer shape, and small sizes simplify content.
- Old selectors migrate with defaults; text remains opaque, observation timestamps remain visible, stale/unavailable data remains unavailable. No network/permission/backend/worker change. Existing pairing/cache and style preferences must survive same-certificate updates.
- Native Android 10/15 QA and screenshot review PASS at source `13021c1659e257bc69743eb9eb7ce3b4f887a892` (CI 46089735791). PR #5 merged as `f93621480493926b1711d670df79db1494266be2`; unsigned APK is 68,052 bytes, SHA-256 `67a3022bdd8100c37e6f2b8fec831efd21c26558cd79f33b889be46543bf6475`. Hermes published 1.2.0 (79,398 bytes, SHA-256 `f7f58f8afdc0aad863e380ee9003118977bf44350c58131476d5d57b2b573415`) using the existing stable certificate `512432e2f5bff57d2c9718ccb28b6d6f443cb34a3986940de5cbdb2d298edbc0`; no replacement key. Owner reports stable phone behavior; version-specific Samsung acceptance and off-host key backup remain recorded. See CLEANUP.md for the bounded cleanup plan and completed local result.

# Work implementation checkpoint — 2026-11-27

Continues HANDOVER.md on feature/android-widget. No merge, production modification, new paid service or stable signing key generated.

## Implemented
- SDK-only Java app in android/app, separate production package com.vpscontrol.widget and installable test package com.vpscontrol.widget.qa. Overview/Connection/Settings, VI/EN, light/dark/system, read-only browser links.
- Fleet 2x2, single server 2x2, multi-server 4x2/4x4. Per-instance selections, responsive RemoteViews (size maps on Android 12+, options on 10/11), compact/expanded typography, CPU/RAM/disk bars on expanded single-server widgets and overview, timestamps, explicit unknown/stale/disabled/unreachable states and overflow count.
- Coalesced manual/foreground/best-effort 15/30/60 minute persisted JobScheduler sync, one snapshot fetch across all widgets. No foreground service, polling loop, SSE, extra daemon or runtime library.
- Android Keystore AES-256-GCM, authenticated package binding, encrypted token and origin, no plaintext credential cache, backup and device-transfer exclusions, strict root HTTPS origin validation, system trust only, no redirects, bounded responses, generic errors, cache erasure on 401/403, generation guard against responses restoring disconnected state.
- Disposable QA signing identity kept separate from owner-controlled release signing. sign-release.sh refuses public CI and requires the owner's existing key plus independently verified unsigned APK SHA-256. No production credential or release key in source/CI.
- Next.js patched from 16.2.10 to 16.4.6 after locked dependency audit reported critical advisories. Narrow compatible overrides for Prisma config effect 3.22.5 and lint-time Zod 4.6.7. Existing old SOCKS transitive dependency requires separate compatibility review; no clean-security-audit claim.

## Observed local checks
- Prisma generate, full tsc --noEmit, full eslint src and targeted mobile lint PASS before this checkpoint.
- Backend production build using webpack PASS with Next.js 16.4.6.
- Baseline SQLite schema -> additive schema on isolated empty DB PASS; snapshot lifecycle, pairing/replay/scope/revoke/session invalidation PASS.
- Actual HTTP checks on built production-mode fixture PASS: actual login, cookie/CSRF protections, wrong role/scope, exact native routes, paired bearer reads, replay, wrong-route denial, revocation. No production data or host collection used.
- JVM origin/freshness/layout policy: 22 assertions PASS.
- SDK compile, d8, zipalign, signed test APK and apksigner validation PASS; first native app approximately 46 KiB. Exact final size/hash must be measured after QA fixes.
- Android emulator and native instrumentation tests IN PROGRESS. Do not claim installation/UI/Keystore runtime PASS until runner output is checked. Test APK includes no test code or fixture injection; separate instrumentation APK targets only the QA package.

## Required gates still open
1. Exact-head CI, Android 10/15 runtime/RemoteViews and screenshot review; additional negative security tests; final dependency/notification regressions, fleet/storage/no-host-call measurements.
2. Production: explicit owner deployment authorization after technical QA; Hermes exact-image isolated testing, refreshed backup, restored-credential invalidation and rollout/smoke evidence. No production changes authorized by this checkpoint.
3. Release: stable signing on owner-controlled machine, signature continuity/update test, final APK digest/certificate and delivery. QA APK is an acceptance candidate, not the stable signed production release.
4. Actual Samsung acceptance for pairing against deployed Mobile API, widget add/resize/independent instances, background and failure states. QR remains deferred.
