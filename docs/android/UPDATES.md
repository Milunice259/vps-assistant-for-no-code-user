# Android GitHub update channel

## App behavior

The native 1.1.0 candidate checks `android/releases/stable.json` on the public repository's main branch every time the activity enters the foreground. It uses bounded HTTPS and conditional ETags, with its own worker queue. It never sends the VPS bearer/cookie to GitHub and does not block or change monitoring/authentication. Missing/unpublished feed, network/rate errors and incompatible Android builds are distinct from an actual up-to-date result.

A newer release appears in Overview and App updates in Settings with version, notes and a Download and update button. Download is opt-in. The app limits file size/time/redirect count and GitHub/CDN hosts, checks exact size and SHA-256, package/version/minimum Android and the current installed signing certificate. It refuses downgrade, other package/key, truncated or altered downloads. Android's PackageInstaller then verifies the signed APK and requests user confirmation. Android's install-from-this-app permission is requested only after the user initiates an update. No silent/root installer or external runtime is used.

Download/failed/cancelled APKs stay only in the private updater cache. It is cleaned after staging, failure, cancellation and next startup; MY_PACKAGE_REPLACED cleans successful installs. PackageInstaller owns and cleans its staged session. A leftover active session is retained briefly for its system callback and abandoned if expired. Cleanup never clears VPS pairing, snapshots, widget selections or user files.

The new REQUEST_INSTALL_PACKAGES permission is necessary for the Android confirmation flow. The app does not request device-owner, root, all-packages, broad storage or notification permissions.

## First stable release

RC1/RC2 used discarded disposable QA keys. They cannot receive an in-place stable update. The owner must install the stable package `com.vpscontrol.widget` once, pair it and add its widgets. Later releases keep that package, increase versionCode and use the same owner-controlled certificate; normal upgrades retain the app's Keystore/preferences/widgets. Do not publish `qa`, `qa2` or `qa3` APKs as stable releases. An unpublished/null feed does not activate a release.

1. Review the final exact source/checks and owner-controlled signing identity. Merge the reviewed Android changes into main; this does not authorize a backend deployment.
2. Retrieve the exact tested stable-package unsigned APK and independently compare its SHA-256 from the checkpoint. On an owner-controlled signing environment, run `android/app/sign-release.sh` with the existing private key, alias/password environment variables and VPS_UNSIGNED_SHA256. Keep an encrypted key backup outside source/public CI/chat; never invent an ephemeral replacement for a stable key. Initial stable-key setup must remain under owner custody.
3. Inspect `apksigner verify --print-certs` and record the approved public certificate SHA-256. Check out the exact tested source, place short UTF-8 notes in an owner-local file, then prepare:

```sh
python3 android/app/publish-release.py --apk /absolute/signed.apk --source FULL_TESTED_SOURCE_SHA --cert-sha256 APPROVED_PUBLIC_CERT_SHA256 --notes-file /absolute/notes.txt
```

4. Review the generated `android/app/build/release/stable.json` and signed APK. Use the same command with `--publish` only when ready. It requires the owner's authenticated GitHub CLI and existing Android SDK tools; neither credential enters the APK. It refuses public CI, unmerged/dirty Android source, QA package, wrong certificate and downgrade. The script creates a draft release, verifies downloaded assets and tag/source, publishes it, and only then advances the main feed with a content-SHA guard and reads it back. Existing assets/tags are never overwritten. GitHub Releases are separate from backend release/deploy automation; `--latest=false` leaves the general latest-release selection alone.
5. Verify the public feed and actual owner phone upgrade. Keep the previously signed APK/release for recovery; do not reset a live app's data to test an update. Samsung install-source permission, Android confirmation and actual stable certificate update acceptance remain owner device steps.

## Release data

The checked-in bootstrap is `{"schema":1,"release":null}`. Only the publisher should advance it after a real signed release is available. Release fields include packageName, versionCode, versionName, minSdk, exact signed size/SHA-256, GitHub release URL and bounded plain-text notes; public source/certificate fingerprints are recorded for operations. App trust is the existing installed signer plus Android verification, not the feed's certificate claim. Current strict signing policy does not accept certificate rotation; plan it as an explicit future change.

Only the publisher handles GitHub write authorization. The phone reads public HTTPS; no token or paid update infrastructure is required.
