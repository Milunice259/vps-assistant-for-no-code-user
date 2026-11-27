#!/usr/bin/env bash
# Dependency-free SDK-only PoC build. No network or Gradle plugin downloads.
set -euo pipefail
cd "$(dirname "$0")"
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/usr/local/lib/android/sdk}}"
bt="$sdk/build-tools/35.0.0"
platform="$sdk/platforms/android-35/android.jar"
test -f "$platform"
test -x "$bt/aapt2"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
mkdir -p "$out/gen" "$out/classes" "$out/dex" build
"$bt/aapt2" compile --dir res -o "$out/res.zip"
"$bt/aapt2" link -I "$platform" --manifest AndroidManifest.xml --java "$out/gen" -o "$out/resources.apk" "$out/res.zip"
find src "$out/gen" -name '*.java' -print0 | xargs -0 javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$platform" -d "$out/classes"
jar cf "$out/classes.jar" -C "$out/classes" .
"$bt/d8" --release --min-api 29 --lib "$platform" --output "$out/dex" "$out/classes.jar"
cp "$out/resources.apk" "$out/unsigned.apk"
zip -q -j "$out/unsigned.apk" "$out/dex/classes.dex"
"$bt/zipalign" -p -f 4 "$out/unsigned.apk" "$out/aligned.apk"
# Ephemeral DEMO key, not a release credential; no persistence or real user data.
keytool -genkeypair -keystore "$out/demo.p12" -storetype PKCS12 -storepass demo-only -keypass demo-only -alias demo -keyalg RSA -keysize 2048 -validity 365 -dname 'CN=VPS Control PoC DEMO' -noprompt
"$bt/apksigner" sign --ks "$out/demo.p12" --ks-pass pass:demo-only --key-pass pass:demo-only --out build/vps-widget-poc.apk "$out/aligned.apk"
"$bt/apksigner" verify --verbose --print-certs build/vps-widget-poc.apk
"$bt/zipalign" -c -v 4 build/vps-widget-poc.apk
"$bt/aapt2" dump badging build/vps-widget-poc.apk
"$bt/aapt2" dump permissions build/vps-widget-poc.apk
bytes="$(wc -c < build/vps-widget-poc.apk)"
echo "POC_APK_BYTES=$bytes"
sha256sum build/vps-widget-poc.apk
test "$bytes" -le 512000
if "$bt/aapt2" dump permissions build/vps-widget-poc.apk | grep -q 'android.permission.INTERNET'; then echo "Unexpected internet permission"; exit 1; fi
if unzip -Z1 build/vps-widget-poc.apk | grep -q '^lib/'; then echo "Unexpected native runtime libraries"; exit 1; fi
