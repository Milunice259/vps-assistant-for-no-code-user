# Android — current release status

Updated2026-11-28 (Vietnam). Start with the [Android guide](README.md) for installation and widgets; this page records release identity and evidence.

## Published stable:1.3.0 /10300

| Field | Verified value |
| --- | --- |
| Package | `com.vpscontrol.widget` |
| Android | min API29 / target API35 |
| Release | [android-v1.3.0](https://github.com/Milunice259/vps-assistant-for-no-code-user/releases/tag/android-v1.3.0) |
| APK | `VPS-Control-Widget-1.3.0.apk`, **83,494 bytes** |
| APK SHA-256 | `2ae8c6b77aeb7373e8232b926644d3c4418ebb4c40a22890617dde7bc4c046a5` |
| Certificate SHA-256 | `512432e2f5bff57d2c9718ccb28b6d6f443cb34a3986940de5cbdb2d298edbc0` |
| Exact source/tag | `42d25be78208ead526e5782199ff13158ab384ba` |
| PR / merge | [#6](https://github.com/Milunice259/vps-assistant-for-no-code-user/pull/6), `1d521efbda6f60b7cf1b0c2aa489a81172e34e4b` |
| Feed | [stable.json](../../android/releases/stable.json) |

Hermes [publication receipt7233470276](https://github.com/Milunice259/vps-assistant-for-no-code-user/pull/6#issuecomment-7233470276) reports signing the reviewed72,466-byte unsigned APK without rebuild, reusing the existing stable key, private restored-backup certificate verification, publisher prepare/review/publish, and public APK signature/package/version/alignment/readback. Feed, public release asset digest/size and tag source were independently read back during documentation cleanup. The same certificate/package continues1.1/1.2 updates; previous releases and tags remain available.

## Behavior and validation

- [Refresh correction](REFRESH.md): explicit1/3/5-minute modes with user-granted Android12+ fast access, true15-minute fallback when denied, and one shared non-wakeup alarm. Visible main app refreshes each minute. Cached readings keep observation times and never count as current online. Per-widget customization from1.2 is retained.
- [CI46102820099](https://github.com/Milunice259/vps-assistant-for-no-code-user/actions/runs/46102820099) PASS on Android10/API29 and15/API35. JVM22+23+38; native core403/options1748 each; refresh160/163; automatic17/18; API35 revoke5. Actual awake native minute-alarm delivery performs one GET for two widgets, ELAPSED/type3 with0 wakeups. Foreground minute timer,3/5-minute arming, deletion/disconnect/fallback, real installer cancel/upgrade and retained pairing/cache/style/preference passed. Recorded crash log empty; app/widget images inspected.
- Reviewed unsigned SHA-256 `409bd99ae645a7ecac95ca53306479d256f30e749946eb42cf1b4d9658557428`. Final artifact15246587474/run46102820099 and a durable owner handoff retain provenance; CI artifact has one-day expiry.
- [Cleanup](CLEANUP.md): merged branches removed, main retained; five superseded artifacts removed by Hermes with readback. The old PoC and standalone SDK probe are retired from the active tree; current app/backend/signing QA remains.

## Remaining acceptance limits

Samsung1.3.0 sleep/battery/physical reboot acceptance awaits the owner. Awake emulator cadence does not prove exact execution during Doze or every OEM restriction. Signing-key backup remains same-host; off-host recovery is not established. Previously recorded backend/dependency limitations are not closed by an Android release. Backend/proxy/runtime keys were unchanged by1.3 publication and this repo cleanup.

[Release/build procedures](RELEASE.md) · [Update channel](UPDATES.md) · [Approved original roadmap](ROADMAP.md) · [Historical checkpoints](archive/README.md).
