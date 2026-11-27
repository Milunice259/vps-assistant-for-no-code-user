#!/usr/bin/env bash
# Run only on the owner's machine with the stable key and an independently verified unsigned APK.
set -euo pipefail
cd "$(dirname "$0")"
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo 'Release signing is prohibited in public CI'; exit 2; fi
: "${VPS_SIGN_KEYSTORE:?Owner keystore path required}"
: "${VPS_SIGN_ALIAS:?Owner alias required}"
: "${VPS_SIGN_STOREPASS:?Set password privately in your local environment}"
: "${VPS_SIGN_KEYPASS:?Set password privately in your local environment}"
: "${VPS_UNSIGNED_SHA256:?Expected reviewed APK digest required}"
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/usr/local/lib/android/sdk}}"
bt="${ANDROID_BUILD_TOOLS:-$sdk/build-tools/35.0.0}"
input=build/vps-control-v1.0.0-unsigned.apk
printf '%s  %s\n' "$VPS_UNSIGNED_SHA256" "$input" | sha256sum -c -
"$bt/aapt2" dump badging "$input" | head -1 | grep -q "package: name='com.vpscontrol.widget' versionCode='10001' versionName='1.0.0'"
"$bt/apksigner" sign --ks "$VPS_SIGN_KEYSTORE" --ks-key-alias "$VPS_SIGN_ALIAS" --ks-pass env:VPS_SIGN_STOREPASS --key-pass env:VPS_SIGN_KEYPASS --out build/VPS-Control-Widget-1.0.0.apk "$input"
"$bt/apksigner" verify --verbose --print-certs build/VPS-Control-Widget-1.0.0.apk
"$bt/zipalign" -c 4 build/VPS-Control-Widget-1.0.0.apk
test "$(wc -c < build/VPS-Control-Widget-1.0.0.apk)" -le 500000
sha256sum build/VPS-Control-Widget-1.0.0.apk
