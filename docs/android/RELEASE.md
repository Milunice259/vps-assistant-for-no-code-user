# VPS Control Widget V1.0 — release and installation

## Packages and signing
- `com.vpscontrol.widget.poc`: old offline demo 0.1; may be removed independently.
- `com.vpscontrol.widget.qa`: installable `1.0.0-rc.1` acceptance candidate. Disposable test signing identity; not the stable production update channel. Test builds signed with different disposable keys require uninstalling the earlier QA app, which erases its local pairing/cache. Revoke the old device in web Settings before re-pairing. The QA app contains no sample data or instrumentation hooks; mock tests are a separate APK.
- `com.vpscontrol.widget`: stable `1.0.0`, versionCode 10000. Sign only with the owner's stable Android release key. Never sign with a newly invented substitute key to bypass owner custody. Keep an encrypted off-repository/off-CI backup under owner control; future updates must retain the same certificate and increment versionCode.

Build without downloading Gradle/plugins: `bash android/app/build.sh unsigned`. The SDK must contain Android 35, build-tools 35.0.0 and JDK 17+ on a non-production machine. `bash android/app/build.sh qa` additionally signs a separate test package and compiles the instrumentation APK. No runtime dependencies or native libraries.

The owner-side `android/app/sign-release.sh` expects private local environment variables `VPS_SIGN_KEYSTORE`, `VPS_SIGN_ALIAS`, `VPS_SIGN_STOREPASS`, `VPS_SIGN_KEYPASS` and reviewed `VPS_UNSIGNED_SHA256`. It refuses public CI, verifies the reviewed unsigned digest and production package/version, signs using the owner's existing key, checks signature/alignment/size and prints only public certificate/APK fingerprints. Do not send signing passwords or keys through chat, source or public Actions.

Record the source HEAD, build tool versions, APK bytes/SHA-256 and signing certificate SHA-256 together at handoff. Do not claim a QA signature is the stable release identity.

## Install and pair
1. On Samsung, open the APK download and allow installation from the selected app if Android asks. Install VPS Control. The prior offline demo can remain installed.
2. The server must first have the reviewed Mobile API deployed. On the web panel, open Settings → Mobile Devices, enter a device name, select only required VPSs, and generate a code.
3. On the phone open Connect. Enter the root HTTPS panel address (no path, username, query or fragment), paste the complete `mp1_...` code within 5 minutes and connect. No owner password or SSH key is required. An already used/expired code must be regenerated.
4. Refresh Overview. Each server shows its observation time and online/unreachable/unknown/stale/disabled state. A dash is unavailable data, not zero. Unreachable is the monitor's observation, not proof that the VPS is powered off.
5. Add one of the four widgets from Settings or Samsung's widget picker. Tap its title to choose servers independently; resize by holding and dragging the widget edges. Tap ↻ for manual refresh and a listed VPS to open its web page. A compact widget shows fleet totals; larger layouts add server rows and an overflow count.
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
