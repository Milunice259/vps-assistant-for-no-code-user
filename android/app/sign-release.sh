#!/usr/bin/env bash
# Run only on the owner's machine with the stable key and an independently verified unsigned APK.
set -euo pipefail
# Consume all output before inspecting its first line; pipefail must not turn
# an otherwise valid archive into SIGPIPE (141) when aapt2 outlives head/grep.
check_badging() {
  local badging first
  badging="$("$1" dump badging "$2")" || return "$?"
  first="${badging%%$'\n'*}"
  if [[ "$first" != "package: name='com.vpscontrol.widget' versionCode='$3' versionName='$4'"* ]]; then
    echo 'Unexpected stable package/version'; return 2
  fi
}
main() {
cd "$(dirname "$0")"
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo 'Release signing is prohibited in public CI'; exit 2; fi
: "${VPS_SIGN_KEYSTORE:?Owner keystore path required}"
: "${VPS_SIGN_ALIAS:?Owner alias required}"
: "${VPS_SIGN_STOREPASS:?Set password privately in your local environment}"
: "${VPS_SIGN_KEYPASS:?Set password privately in your local environment}"
: "${VPS_UNSIGNED_SHA256:?Expected reviewed APK digest required}"
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/usr/local/lib/android/sdk}}"
bt="${ANDROID_BUILD_TOOLS:-$sdk/build-tools/35.0.0}"
version="$(python3 - <<'VERSION'
import xml.etree.ElementTree as E
r=E.parse('AndroidManifest.xml').getroot()
print(r.attrib['{http://schemas.android.com/apk/res/android}versionName'])
VERSION
)"
code="$(python3 - <<'CODE'
import xml.etree.ElementTree as E
r=E.parse('AndroidManifest.xml').getroot()
print(r.attrib['{http://schemas.android.com/apk/res/android}versionCode'])
CODE
)"
input="build/vps-control-v$version-unsigned.apk"
output="build/VPS-Control-Widget-$version.apk"
printf '%s  %s\n' "$VPS_UNSIGNED_SHA256" "$input" | sha256sum -c -
check_badging "$bt/aapt2" "$input" "$code" "$version"
"$bt/apksigner" sign --ks "$VPS_SIGN_KEYSTORE" --ks-key-alias "$VPS_SIGN_ALIAS" --ks-pass env:VPS_SIGN_STOREPASS --key-pass env:VPS_SIGN_KEYPASS --out "$output" "$input"
"$bt/apksigner" verify --verbose --print-certs "$output"
"$bt/zipalign" -c 4 "$output"
test "$(wc -c < "$output")" -le 500000
sha256sum "$output"
}
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
