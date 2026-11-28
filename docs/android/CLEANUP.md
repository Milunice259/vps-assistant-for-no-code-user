# Post-stable cleanup — 2026-11-28 (Vietnam)

## Current state and authorization

The owner reports that the app appears stable on the phone and requested a cleanup plan/work shared by ChatGPT and Hermes. This authorizes scoped removal of verified disposable project files. It does not cancel pending release work or authorize deleting recovery material, changing app behavior, deploying a backend, reducing production backup retention or modifying unrelated services. Skip ambiguous items and report them; continue independently with proven disposable items.

Planning began while the public feed was 1.1.0. During the check, Hermes published **1.2.0 / 10200**; the plan was rebased onto feed commit `0fc6268e22086d601c9a1cbe9c72507e7fee1a97` instead of overwriting it. Current [1.2.0 release](https://github.com/Milunice259/vps-assistant-for-no-code-user/releases/tag/android-v1.2.0), tag source `13021c1659e257bc69743eb9eb7ce3b4f887a892`, asset size **79,398 bytes**, asset/feed SHA-256 `f7f58f8afdc0aad863e380ee9003118977bf44350c58131476d5d57b2b573415` were read back. Operator [checkpoint 7231957063](https://github.com/Milunice259/vps-assistant-for-no-code-user/pull/5#issuecomment-7231957063) reports signature/certificate/backup verification and removal of private portable-tool directories. Stable key/certificate was retained. Keep 1.2.0 current and 1.1.0 previous. The owner's general phone-stability report does not by itself identify the installed version or cover every background/resize case.

## Responsibility and sequence

| Owner | This cleanup | State |
| --- | --- | --- |
| ChatGPT | Remove idle local QA emulator data, generated Next build cache, redundant old QA renders/archives and generated test APKs | Done; result below |
| ChatGPT | Preserve source/tests, signing/publishing tools, current receipt/evidence and 1.2.0 release handoff; record this plan in GitHub | Done |
| Hermes | Inventory and clean only proven disposable VPS Control QA/staging objects and temporary files, then run service checks | Completed per operator checkpoint 7232267401 |
| Hermes + ChatGPT | Delete superseded GitHub artifacts and merged branch refs; protect final evidence and stable releases | Artifacts removed by Hermes and read back by ChatGPT; five merged branches removed by ChatGPT after explicit owner instruction |
| Owner | If still installed, remove unused Demo/RC apps after distinguishing them from the stable package | Optional device action; not remotely executed |

## Completed local cleanup

- No emulator or Next server was active. An explicit 18-item allowlist was measured before deletion; paths were checked to stay inside this workspace, with no tracked source under the two generated repository directories.
- Removed idle local AVD data, `.next`, `android/app/build` generated outputs, superseded QA/debug render directories and duplicate intermediate ZIPs. Removed allocated size: **1,514,160,128 bytes (1,444.0 MiB, about 1.41 GiB)**. This is the development workspace, **not reclaimed VPS space**.
- Kept JDK/Android SDK/dependencies for future builds, all tracked source and regression/CI tests, deliverables, the full final 1.2.0 native evidence and the exact candidate unsigned APK.
- These three protected file hashes were checked before and after; all unchanged:

| File | SHA-256 |
| --- | --- |
| Stable `VPS-Control-Widget-1.1.0.apk` | `a51213c8a44b23ac389bed7d206acacf578e0abd9903e7bd2e4cdf6f7798635c` |
| `VPS-Control-1.2.0-signing-handoff.zip` | `e73ba4d365e3e89c4698c0422ba6203c6ee3d39f401d95f56f9d719ed53df594` |
| Exact `vps-control-v1.2.0-unsigned.apk` | `67a3022bdd8100c37e6f2b8fec831efd21c26558cd79f33b889be46543bf6475` |

Tracked source stayed clean; no VPS access, running service or live database was involved. No runtime tests were rerun for cache deletion; source and protected artifact integrity were the relevant checks.

## Completed VPS and GitHub cleanup

Operator [checkpoint 7232267401](https://github.com/Milunice259/vps-assistant-for-no-code-user/pull/5#issuecomment-7232267401) reports actual project-scoped VPS execution: the unused unapproved d350134 image, two detached disposable QA DB clones and three completed detached worktrees were retired after reference/open-path checks. Recovery snapshots, current/rollback images, both stable APKs, signing/recovery material and final 1.2.0 evidence were retained. A concurrent unrelated host job was excluded. Reported filesystem net reduction: **1,229,848,576 bytes (about 1.145 GiB)**; concurrent unrelated activity is possible, so this is not a sum of nominal image sizes. App HTTPS200, anonymous mobile401, natural worker heartbeat and unchanged container identities/config/mounts/restarts were reported PASS. ChatGPT did not independently access the VPS or rerun these host checks.

Hermes removed superseded artifacts `15240486306`, `15240761118`, `15240691950`, totaling **15,030,804 GitHub bytes**. ChatGPT independently queried their three workflow artifact lists and found them empty; final artifact `15240498312` was still present. This storage is separate from VPS and local cleanup.

The owner then explicitly instructed deletion of the five already-merged branches. ChatGPT checked exact heads against their merged PRs, no open PR use, ancestry in main, and no active workflow/script dependency on those branch names. [One-shot cleanup run 46098338166](https://github.com/Milunice259/vps-assistant-for-no-code-user/actions/runs/46098338166) PASS: an atomic push used exact expected-head leases to remove only `feature/android-widget`, `feature/android-ui-refresh`, `feature/owner-signing-wizard`, `fix/android-release-tools` and `feature/widget-customization`; main and all tag refs were checked unchanged by that operation. The first preflight attempt stopped at an incorrect repository URL before deletion; the corrected run completed. The temporary workflow was removed in `d218fc95f31d2eaf9c581118dc056b868cb7908b`; its add/remove sequence leaves the full source tree identical to the pre-cleanup tree. Only ordinary audit history remains, with no persistent cleanup workflow or signing secret. Remote branch inventory now contains **main only**; both release tag targets are unchanged. Corresponding merged local branches and the completed local docs branch were also deleted; local main is clean.

## VPS execution procedure — retained for audit

1. Read this plan, STATUS.md and the current PR #5 checkpoint. Recheck the actual public release/feed and production identity; the read above is a point-in-time observation. Record disk/RAM, container identity/restarts/health, worker heartbeat and app HTTPS/auth baseline without exposing secrets.
2. Build a concrete deletion allowlist with type, exact object/path, project ownership, size, current reference/use and retention reason. Separate retained objects explicitly and coordinate with any active operator/build job; never delete its leased/open temporary objects. Use verified project labels/paths and running-container mounts; a name prefix or old timestamp alone is not proof.
3. Remove only stopped disposable QA/harness containers, detached fixture/restored-copy DBs, duplicate temporary APK/download files, superseded QA directories and images proven unused and outside the retained running/rollback set. A QA clone must be detached from all live mounts and absent from retained recovery manifests. Revoke only test mobile-device IDs proven by test/audit records; retain audit history and leave unclear devices unchanged.
4. Keep signing tools needed for the next release. Remove only proven temporary signing/build files; do not remove a keystore, password/unlock material, encrypted backup or retained release/candidate artifact based on age or filename.
5. Work at object/path level. Do not use host-wide Docker image/build-cache/volume pruning, wildcard backup deletion, live DB cleanup/invalidation scripts, truncation of production logs, shared-proxy changes or service restarts as cleanup shortcuts. Shared BuildKit cache cannot be treated as project-owned without independent evidence; skip it if ownership cannot be established.
6. After deletion, compare the protected material and baseline: app HTTPS works, anonymous mobile read is denied, worker heartbeat advances naturally, running image/mounts/keys are unchanged, no unexpected restart/OOM. Report actual disk reclaimed and exact removed/retained groups in the PR #5 checkpoint. Do not call VPS cleanup complete from ChatGPT's local result.

## Retention boundaries

- **Always retain:** stable signing key and usable encrypted recovery/unlock custody, current configuration/runtime encryption key, running backend image, a verified rollback image/archive and usable DB/config/key recovery set. Keep the established production backup policy; this cleanup does not shorten it. No deletion of the only verified copy; lack of an off-host key copy remains an open recovery item.
- **Published Android releases:** retain signed stable APKs, release tags/feed metadata, source/PR history and public fingerprints. They are small and form the update/recovery record. Preserve the stable package `com.vpscontrol.widget` and its phone pairing/settings.
- **1.2.0 release evidence:** retain exact unsigned/signed provenance, receipt, handoff and full final QA evidence through the 7-day observation window and version-specific owner acceptance. CI artifact **15240498312**, run **46089735791**, keeps its existing one-day expiry; a durable owner handoff and full local final evidence are retained independently. Do not depend on the transient artifact as the sole copy. Compact release/checksum/test records remain afterward.

- **Superseded QA artifacts:** the three objects `15240486306` (failed run46088598634), `15240761118` (failed run46088959358), `15240691950` (superseded successful run46089310132) have been removed as recorded above. For future cleanup, re-fetch ownership/status first; expired or missing means nothing to delete. Keep workflow logs, source/checkpoints and final proof.
- **After a future release is accepted:** raw QA/scratch duplicates may be retired after a 7-day observation window while retaining compact checksums, final evidence and release/recovery records. This is a documented policy, not a newly scheduled job. Delete a merged branch only when it has no open PR/workflow dependency and every commit is reachable from main or a retained tag; keep any future pending-candidate refs until its release is pinned.

## Phone distinction

Stable package: `com.vpscontrol.widget` — keep its data/widgets/pairing. Old separate test packages are `com.vpscontrol.widget.poc`, `.qa`, `.qa2`, `.qa3`, `.qa4`; remove only if installed and no longer used. Identify the matching obsolete enrollment before revoking it; do not revoke the active stable phone or clear all app data as cleanup.

## Completion receipt

Hermes records: observed release/source/image; allowlist removed and retained; before/after disk and service state; protected recovery/signing checks without secret values; skipped ambiguities; and any next action. Only then mark VPS/GitHub cleanup done. Current result: **local cleanup complete; VPS cleanup completed per operator evidence; GitHub artifact/branch cleanup independently read back, with main and release tags retained**. This does not close the previously recorded off-host key recovery or version-specific Samsung acceptance limits.
