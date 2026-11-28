# VPS Control Widget V1.0 — release and installation

## Current stable1.3.0 — published2026-11-28 (Vietnam)

[android-v1.3.0](https://github.com/Milunice259/vps-assistant-for-no-code-user/releases/tag/android-v1.3.0) is public: package `com.vpscontrol.widget`,1.3.0/code10300, **83,494 bytes**, SHA-256 `2ae8c6b77aeb7373e8232b926644d3c4418ebb4c40a22890617dde7bc4c046a5`. Tag/source `42d25be78208ead526e5782199ff13158ab384ba`; existing stable certificate retained. Hermes [receipt](https://github.com/Milunice259/vps-assistant-for-no-code-user/pull/6#issuecomment-7233470276) reports signing the exact reviewed unsigned artifact without rebuild and verifying the public APK/tag/feed. Public asset metadata, tag source and main feed were read back during repo cleanup. See [STATUS.md](STATUS.md) for identity, QA and limits.

Use an in-place stable update to retain pairing/customization. Select1/3/5 minutes in Settings; Android12+ requires the explained Alarms & reminders access, with15-minute fallback if denied. Fast alarms do not wake the sleeping phone. Cached readings remain labeled with observation times. Samsung sleep/battery/reboot acceptance remains open.

## Previous stable1.2.0 — published 2026-11-28 (Vietnam)

[android-v1.2.0](https://github.com/Milunice259/vps-assistant-for-no-code-user/releases/tag/android-v1.2.0) is public: stable package `com.vpscontrol.widget`, code10200, signed APK **79,398 bytes**, SHA-256 `f7f58f8afdc0aad863e380ee9003118977bf44350c58131476d5d57b2b573415`. Exact source/tag target `13021c1659e257bc69743eb9eb7ce3b4f887a892`, merged in PR #5. Hermes [checkpoint](https://github.com/Milunice259/vps-assistant-for-no-code-user/pull/5#issuecomment-7231957063) reports signing the exact 68,052-byte reviewed unsigned APK, existing stable certificate/backup verification and publisher prepare/review/publish plus public APK readback, without rebuilding. ChatGPT read back the release asset digest, tag/source and main feed during cleanup planning; certificate pin remains the 1.1.0 identity below. Native Android10/15 QA and screenshot review passed in run46089735791. Normal same-package/certificate updates preserve pairing/cache/widgets; do not uninstall or clear stable app data. General owner stability feedback received; version-specific Samsung acceptance and same-host key recovery limitations remain recorded. [CLEANUP.md](CLEANUP.md) governs post-release disposable-file cleanup.

## Previous stable 1.1.0 delivery — 2026-11-28 (Vietnam)

Android **1.1.0 / 10100 is published** as [android-v1.1.0](https://github.com/Milunice259/vps-assistant-for-no-code-user/releases/tag/android-v1.1.0). Exact app source/tag target is `7695a4e1893624cb3eccf18e41c59276d4ea3348`; the original unsigned APK was signed without rebuilding or substituting QA. APK: **67,039 bytes**, SHA-256 `a51213c8a44b23ac389bed7d206acacf578e0abd9903e7bd2e4cdf6f7798635c`. Public certificate SHA-256: `512432e2f5bff57d2c9718ccb28b6d6f443cb34a3986940de5cbdb2d298edbc0`.

The public release and main feed were read back; APK downloaded independently and verified for bytes/SHA-256, v3 signature/certificate, stable package/version, SDK 29/35 and zip alignment. Future stable releases must preserve this package/certificate and increase versionCode. The phone now has an active stable update channel; first installation from the RC packages still requires installing stable, re-pairing and adding its widgets.

The owner delegated key custody to Hermes on the existing owner VPS, superseding the earlier Windows signing-host gate. Operator [checkpoint 7225024194](https://github.com/Milunice259/vps-assistant-for-no-code-user/pull/2#issuecomment-7225024194) reports a durable protected key, encrypted backup with separate unlock custody, restored-copy signing verification, and unchanged backend/proxy/runtime keys. Key and backup remain on the same VPS: **off-host recovery is not yet established**. Actual owner Samsung install, resize/background/reboot acceptance remains pending; do not close all V1.0 gates from the release alone.

The operational workarounds reported at release (aapt2 SIGPIPE, a missing draft tag and argparse --publish abbreviation) are covered by the release-tool maintenance regression tests. They do not alter the published 1.1.0 APK/tag/feed. Historical candidate/setup procedures below remain for subsequent releases.

## Packages and signing
- `com.vpscontrol.widget.poc`: old offline demo 0.1; may be removed independently.
- `com.vpscontrol.widget.qa`: installable `1.0.0-rc.1` acceptance candidate. Disposable test signing identity; not the stable production update channel. Test builds signed with different disposable keys require uninstalling the earlier QA app, which erases its local pairing/cache. Revoke the old device in web Settings before re-pairing. The QA app contains no sample data or instrumentation hooks; mock tests are a separate APK.
- `com.vpscontrol.widget.qa2`: UI refresh `1.0.0-rc.2` (VPS Control · RC2), versionCode 10001. Installs alongside RC1 and leaves its pairing/cache intact. Pair RC2 separately and add widgets from the RC2 app. The disposable RC1 key was not retained; this is not an in-place RC1 update. After accepting RC2, remove old RC1 widgets and revoke its device from web Settings before uninstalling. No synthetic data or test hooks in the delivered app.
- `com.vpscontrol.widget.qa3`: update-flow QA candidate `1.1.0-rc.3`, versionCode 10100. Its disposable key/package is isolated from the stable update channel. Real same-certificate upgrade/cancellation is exercised using separately signed test archives.
- `com.vpscontrol.widget`: stable public package; current release `1.3.0`, versionCode10300. Sign only with the owner's stable Android release key. Never sign with a newly invented substitute key to bypass owner custody. Keep an encrypted off-repository/off-CI backup under owner control; future updates must retain the same certificate and increment versionCode.

Build without downloading Gradle/plugins: `bash android/app/build.sh unsigned`. The SDK must contain Android 35, build-tools 35.0.0 and JDK 17+ on a non-production machine. `bash android/app/build.sh qa` additionally signs a separate test package and compiles the instrumentation APK. The1.3.0 test build uses the isolated QA5 package. The QA command writes `vps-control-rc5-qa-unsigned.apk`; this must never be passed to stable signing. Run the unsigned command separately for `vps-control-v1.3.0-unsigned.apk` with the stable package. No runtime dependencies or native libraries.

The owner-side `android/app/sign-release.sh` expects private local environment variables `VPS_SIGN_KEYSTORE`, `VPS_SIGN_ALIAS`, `VPS_SIGN_STOREPASS`, `VPS_SIGN_KEYPASS` and reviewed `VPS_UNSIGNED_SHA256`. It refuses public CI, verifies the reviewed unsigned digest and production package/version, signs using the owner's existing key, checks signature/alignment/size and prints only public certificate/APK fingerprints. Do not send signing passwords or keys through chat, source or public Actions.

Record the source HEAD, build tool versions, APK bytes/SHA-256 and signing certificate SHA-256 together at handoff. Do not claim a QA signature is the stable release identity.

See [UPDATES.md](UPDATES.md) for the foreground GitHub check, verified download, Android confirmation, temporary-file cleanup and owner-side stable release activation. No stable release is active until a real signed APK and feed are published.

## Install and pair
1. On Samsung, open the APK download and allow installation from the selected app if Android asks. Install VPS Control. The prior offline demo can remain installed.
2. The server must first have the reviewed Mobile API deployed. On the web panel, open Settings → Mobile Devices, enter a device name, select only required VPSs, and generate a code.
3. On the phone open Connect. Enter the root HTTPS panel address (no path, username, query or fragment), paste the complete `mp1_...` code within 5 minutes and connect. No owner password or SSH key is required. An already used/expired code must be regenerated.
4. Refresh Overview. Each server shows its observation time and online/unreachable/unknown/stale/disabled state. A dash is unavailable data, not zero. Unreachable is the monitor's observation, not proof that the VPS is powered off.
5. Add one of the four widgets from Settings or Samsung's widget picker. In 1.2.0, tap its gear (or open app Settings → the installed widget) to choose servers and customize appearance independently; resize by holding and dragging the widget edges. Tap refresh for a manual update; tap the widget body to open the app and its server dashboard link to open the web panel. Every provider switches to detailed resource meters when only one VPS is selected. The Wide preset is a 4×1 strip in 1.2.0; its outer dimensions follow launcher grid/padding. With multiple VPSs, larger layouts show server rows and an overflow count. Current meters show current utilization, not trends.
6. Choose Vietnamese/English and light/dark in Settings. Default refresh is best effort every 15 minutes; Android battery saving/Doze/network can delay it. No continuous monitoring service runs on the phone.
7. Revoke a phone from web Settings if lost; it is denied at the next API read. An offline phone cannot receive instant revocation. Disconnect locally erases its credentials/cache. Expiry, password change and global forced logout require pairing again.

## Production gate and rollout (Hermes/operator)
Do not merge or alter production based solely on this document. Obtain explicit owner deployment authorization after technical QA. Use the already approved infrastructure and existing worker/SQLite; no extra VPS/database/daemon, no shared proxy or unrelated app changes.

- Pin reviewed source/image; take a fresh consistent SQLite backup and preserve current image/config/encryption keys. Verify hashes/integrity/FK and recovery access. Keep encrypted owner-controlled off-host copies when available at no added service cost.
- Build the exact candidate image with a source revision label. Start it on a disposable restored DB copy with production credentials/network/host commands/Docker access isolated. Test additive schema and existing data, login/CSRF, Mobile Devices issue/redeem/replay/scope/revoke, worker lifecycle, snapshot freshness and no commands on mobile GET. Record the exact image ID; deploy that tested image without rebuild.
- Before exposing any restored DB, invalidate ALL resurrected MobileDevice tokens and pairing codes using the isolated copy procedure below. Restoring an older database must never re-enable a previously revoked phone. Preserve protected tables and keys; do not blindly overwrite the current live DB during rollback.
- Verify public TLS/hostnames, HTTP-to-HTTPS policy and trusted proxy configuration, request limiting and authentication. Do not disable TLS or widen trusted proxy scope for the app.
- Apply reviewed additive schema once, start existing service/worker, perform owner-authenticated smoke tests and compare resource/storage behavior with baseline. Monitor API errors, lastAccess write frequency and worker freshness.
- Roll back to the preserved previous image when necessary; additive tables can remain. Do not discard post-backup data without explicit owner approval. Old images do not expose the mobile routes; phones will show cached timestamps and service-unavailable errors.

## Restored copy invalidation
With the restored copy still isolated and the panel stopped, inspect counts using:

```bash
node scripts/mobile-revoke-restored.cjs --restored-copy=/absolute/restored-copy.db
```

The runner image packages `scripts/mobile-revoke-restored.cjs` with the same generated Prisma client as the application. It is dormant: the entrypoint, worker and HTTP handlers never call it. The offline regression runner explicitly classifies it ISOLATED-ONLY and does not auto-run it. The operator must verify its source checksum and execution inside the exact candidate image during isolated image QA.

After verifying this is the intended restored COPY and its service is stopped/isolated, apply with `--apply --confirm-isolated-copy`; the script marks all active rows revoked and removes both credential hashes. Run it before that restored copy is exposed. It requires an explicit existing absolute regular file with one link, rejects symbolic/hard links and query/fragment path ambiguity, ignores DATABASE_URL, has no default live target and does not print device credentials. The confirmation flag is an operator acknowledgement, not automatic proof of OS isolation. Never invoke this against a live database; stop and isolate the restored copy first. All phones must pair again. Verify the resulting active count is zero and former bearer/pairing requests return 401 in isolation.

## Acceptance evidence required
Android 10 and 15 install/runtime, actual Keystore roundtrip and corruption fail-closed, no plaintext credentials/backup, HTTP input limits, auth erasure/in-flight response guard, independent widget instances and all sizes/themes/languages, missing/stale/disabled/null metrics, browser URLs without credentials, manual/coalesced/background updates, reboot and upgrade with a stable certificate. Finish with actual Samsung pairing after server rollout. A successful CI build alone does not close these gates.
