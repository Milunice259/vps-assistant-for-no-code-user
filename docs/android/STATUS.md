# Android Widget V1.0 — Phase 0 status

Updated 2026-11-27. State: Phase 0 development preflight PASSED WITH CONDITIONS; Phase 1 mock-only work authorized by approved roadmap. Production release remains BLOCKED.
- Source baseline: f3540b92573a7c9ebf0a3717e432f30c799883d6, confirmed as PR #1 base. No open PR was returned before creation.
- Feature branch: feature/android-widget. Draft PR: #1. Roadmap committed as bd1a7ef261371e2304c996edda164e6ead31d6f7.
- Repository public, connector admin/push/pull confirmed; workflow-file write, PR creation and Actions scheduling/log retrieval proven. No merge or production mutation.
- Standard Ubuntu hosted runner is free for public repos per GitHub billing docs. Probe uses no cache/artifact/deploy or paid runner. Account billing and storage limits still need verification before uploading artifacts.
- First probe run 45951393553 / job 140347840368: failure after finding JDK 17 and Gradle; adb not on PATH. Not evidence of missing SDK. Revised probe searches standard SDK locations and reports components; revision 173be9ad2009646bd4dad190509c0c35a2c7a66d. Latest run lookup at this checkpoint: 45951454552: completed/success.
- Local sandbox has JDK 21, Node 22, no Android SDK/Gradle/ADB; direct git DNS failed. Build fallback is already-owned machine via Hermes.
- Source review confirms server-level CPU/RAM/disk exists inside notification-checks; return value omits these fields. Plan bounded latest snapshot only from scheduler, without added SSH calls. Existing catch-all remote check labels any error offline: distinguish reachability from collection failure in mobile projection. Preserve current alert behavior until separate tests justify changes. App counts only if observation supports them. Docker exclusion and additive SQLite compatibility tests required.
- Release signing decision: stable owner-controlled key generated/kept on owner-controlled machine, never public source or chat; test-only key distinct from release. No production keys generated in Phase 0.
- Remaining before production: verified consistent backup, protected configuration/key custody and isolated rollback rehearsal; exact running image provenance; explicit release authorization. Before APK handoff: artifact cost/transfer and emulator or device validation.

## Production read-only preflight (operator-reported, 2026-11-27)
- Source checkout matches pinned main baseline; no tracked modifications reported. Running image revision label absent, so exact image provenance remains unproven. Selected runtime files match source. Service and worker operational; read-only SQLite quick_check ok. This evidence is operator-reported, not directly re-executed by ChatGPT.
- No verified recoverable panel backup or distinct rollback image found. BLOCK production deployment until consistent backup, protected configuration/key recovery and isolated rollback evidence exist. Keep current running image intact. No production intervention for mock APK.
- Production host has no Android toolchain. Do not install it there. Free hosted CI is primary. If needed, use an existing non-production workstation, not a new paid service.
- GitHub Actions probe run 45951454552 passed: Ubuntu 24.04, JDK 17, Gradle, Android API 34/35/36, build tools and ADB available via SDK path. KVM not readable in probe; emulator remains unverified.
- Signing key: owner-controlled encrypted vault and offline backup; no real signing key in public CI/repository. Use ephemeral separate test key for PoC only.
- Public repository: retain only sanitized evidence here; operational host paths, resource metrics, image identifiers and recovery locations stay out of Git history.

## Phase 1 initial PoC
- Java/RemoteViews offline demonstration under android/poc, package com.vpscontrol.widget.poc, Android 10+ (min 29), sample labels, no INTERNET or real connection. Separate disposable demo signing key, not upgrade-compatible with future production package.
- Initial build uses existing Android SDK CLI directly (aapt2, javac, d8, zipalign, apksigner) rather than adding AGP or Gradle downloads for this isolated PoC; release build tooling to be finalized in later gates. No R8 shrink claim yet.
- CI run 45955946777 on standard Ubuntu; Build in progress; result not verified.
- No artifact uploaded, no cache and no production access. Billing storage allowance not verified. UI render/install/resize remain untested; KVM unavailable in earlier probe. Phase 1 remains in progress.
