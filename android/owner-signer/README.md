# Owner-controlled Windows signing setup

The operator signing checkpoint on PR #2 reports no separate signing environment/key handle. This package establishes one on the owner's existing Windows x64 PC. It never requires access to the production VPS or a paid service. The reviewed unsigned 1.1.0 APK remains unchanged (SHA-256 `8e1bda22f6da63390311ee6efa4844486cbff477aa259645d0c5fc53598eca81`, 58,931 bytes).

The distributed ZIP adds that exact APK and its release receipt to these tracked launcher files. Extract it, run START.cmd normally (not as Administrator), use an existing encrypted PKCS12 stable key or explicitly establish the first durable key, enter its password locally, and select an encrypted-key backup destination on owner-controlled removable/cloud storage. Keep the password separately in the owner's password manager. Future kits reuse the same local key and compare its public certificate; interrupted initialization resumes the existing key rather than replacing it.

Private state is stored under `%LOCALAPPDATA%\VPSControlSigner\keys`, restricted to the current Windows account and SYSTEM. PKCS12 is encrypted using the owner's password. The convenience password copy is protected using Windows DPAPI for that account. DPAPI is not a disaster-recovery backup: the encrypted P12 and separately retained password are required on another computer. A copied backup is checked against the original hash and read back with the password before any APK is signed.

The wizard downloads portable Microsoft OpenJDK 21 and Google Android Build Tools 35 into its own tool folder and checks pinned SHA-256 hashes. It does not alter global Java/SDK settings or install Android Studio. Initial downloads total about 250 MB. Signing operations are blocked in CI. The Windows workflow tests parsing, DPAPI/ACL/hash/path guards and actual pinned Windows tool execution only, with synthetic non-key data; it never creates an owner/stable signing key. Standard Windows hosted runners on this public repository are free; no larger/paid runner, signing secret or artifact upload is used.

`KET-QUA-GUI-HERMES.zip` contains only the signed APK, public DER certificate and signed-release metadata. Send that ZIP to the operator, who verifies its package/version/signature/hash then runs the existing publisher from the exact tested app source. Do not send `keys`, encrypted-key backups or the password. The wizard makes no GitHub release/feed write. Publishing and actual Samsung stable acceptance remain later steps.

The native application is not rebuilt by this setup. APK source stays `7695a4e1893624cb3eccf18e41c59276d4ea3348` (merged as `2c09761f83e2a2487233a5fca4282583b7c0e757`). Do not substitute the disposable QA APK or its key. An imported P12 must contain the private key under the provided alias and use the same store/key password; other formats need a controlled conversion outside this wizard.


## Operator verification without a host SDK

Hermes does not need the owner's private key. After receiving the public handoff, use the existing authenticated gh/git and Python 3.9+ on Linux. `verify-publish-portable.py` fetches pinned portable Java/Build Tools into a private temporary directory, caps the verifier JVM heap at 128 MiB, runs only the exact reviewed publisher and removes its tool directory afterward. It makes no system package installation, service or production configuration change. Keep the owner key on Windows; never copy it into this verifier environment. Temporary free space must be at least 1.2 GiB.

Copy/download the helper from this setup revision to a separate path. Check out the original exact tested app source, then prepare:

```
python3 /absolute/verify-publish-portable.py --publisher /exact-app-checkout/android/app/publish-release.py --apk /absolute/owner-signed.apk --source 7695a4e1893624cb3eccf18e41c59276d4ea3348 --cert-sha256 OWNER_PUBLIC_CERT_HASH --notes-file /absolute/notes.txt
```

After review, repeat with the publisher's `--publish` argument. Verify the owner's signed APK hash, public certificate fingerprint and input unsigned digest from the handoff first. No stable key is involved in this operation. The helper refuses publishing in CI, checks the publisher's own source hash, verifies both official tool archives, and its CI mode exercises binaries only. Its Python process needs the existing gh account authorization to perform the already authorized GitHub release; no VPS runtime credential is used.
