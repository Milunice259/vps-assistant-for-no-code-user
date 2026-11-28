#!/usr/bin/env bash
# SDK-only, no Gradle/plugin dependency downloads. Release signing is a separate owner operation.
set -euo pipefail
cd "$(dirname "$0")"
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/usr/local/lib/android/sdk}}"
bt="${ANDROID_BUILD_TOOLS:-$sdk/build-tools/35.0.0}"
platform="${ANDROID_PLATFORM_JAR:-$sdk/platforms/android-35/android.jar}"
mode="${1:-unsigned}"
if [[ "$mode" != unsigned && "$mode" != qa ]]; then echo 'Usage: build.sh [unsigned|qa]'; exit 2; fi
test -f "$platform"
out="$(mktemp -d)";trap 'rm -rf "$out"' EXIT
mkdir -p "$out/gen" "$out/classes" "$out/dex" build
cp AndroidManifest.xml "$out/AndroidManifest.xml"
if [[ "$mode" == qa ]]; then
  sed -i 's/package="com.vpscontrol.widget"/package="com.vpscontrol.widget.qa4"/;s/android:label="VPS Control"/android:label="VPS Control · Preview 1.2"/;s/android:versionName="1.2.0"/android:versionName="1.2.0-rc.1"/' "$out/AndroidManifest.xml"
fi
"$bt/aapt2" compile --dir res -o "$out/res.zip"
"$bt/aapt2" link -I "$platform" --manifest "$out/AndroidManifest.xml" --custom-package com.vpscontrol.widget --java "$out/gen" -o "$out/resources.apk" "$out/res.zip"
find src "$out/gen" -name '*.java' -print0 | xargs -0 javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$platform" -d "$out/classes"
jar cf "$out/classes.jar" -C "$out/classes" .
"$bt/d8" --release --min-api 29 --lib "$platform" --output "$out/dex" "$out/classes.jar"
cp "$out/resources.apk" "$out/unsigned.apk"
zip -q -j "$out/unsigned.apk" "$out/dex/classes.dex"
unsigned=build/vps-control-v1.2.0-unsigned.apk
if [[ "$mode" == qa ]]; then unsigned=build/vps-control-rc4-qa-unsigned.apk; fi
"$bt/zipalign" -p -f 4 "$out/unsigned.apk" "$unsigned"
if [[ "$mode" == qa ]]; then
 keytool -genkeypair -keystore "$out/qa.p12" -storetype PKCS12 -storepass qa-build-only -keypass qa-build-only -alias qa -keyalg RSA -keysize 2048 -validity 365 -dname 'CN=VPS Control QA ONLY' -noprompt >/dev/null 2>&1
 "$bt/apksigner" sign --ks "$out/qa.p12" --ks-pass pass:qa-build-only --key-pass pass:qa-build-only --out build/VPS-Control-Widget-1.2.0-rc.1.apk "$unsigned"
 "$bt/apksigner" verify --verbose --print-certs build/VPS-Control-Widget-1.2.0-rc.1.apk
 # Use the same disposable key for the separate on-device instrumentation APK.
 if [[ -f tests/AndroidManifest.xml ]]; then
  mkdir -p "$out/test-assets"
  # Real signed archives for update rejection and same-certificate upgrade tests; test APK only.
  make_fixture() {
   local fixture_name="$1" fixture_code="$2" fixture_version="$3" fixture_package="$4" fixture_key="$5"
   sed -e "s/android:versionCode=\"[0-9]*\"/android:versionCode=\"$fixture_code\"/" -e "s/android:versionName=\"[^\"]*\"/android:versionName=\"$fixture_version\"/" -e "s/package=\"com.vpscontrol.widget.qa4\"/package=\"$fixture_package\"/" "$out/AndroidManifest.xml" > "$out/fixture-manifest.xml"
   "$bt/aapt2" link -I "$platform" --manifest "$out/fixture-manifest.xml" -o "$out/fixture.apk" "$out/res.zip"
   zip -q -j "$out/fixture.apk" "$out/dex/classes.dex"
   "$bt/zipalign" -p -f 4 "$out/fixture.apk" "$out/fixture-aligned.apk"
   "$bt/apksigner" sign --ks "$fixture_key" --ks-pass pass:qa-build-only --key-pass pass:qa-build-only --out "$out/test-assets/$fixture_name.apk" "$out/fixture-aligned.apk"
  }
  make_fixture upgrade 10201 1.2.1 com.vpscontrol.widget.qa4 "$out/qa.p12"
  make_fixture older 10199 1.1.9 com.vpscontrol.widget.qa4 "$out/qa.p12"
  make_fixture package 10201 1.2.1 com.vpscontrol.widget.other "$out/qa.p12"
  keytool -genkeypair -keystore "$out/other.p12" -storetype PKCS12 -storepass qa-build-only -keypass qa-build-only -alias qa -keyalg RSA -keysize 2048 -validity 365 -dname 'CN=Wrong QA key' -noprompt >/dev/null 2>&1
  make_fixture signer 10201 1.2.1 com.vpscontrol.widget.qa4 "$out/other.p12"
  mkdir -p "$out/testclasses" "$out/testdex"
  "$bt/aapt2" link -I "$platform" --manifest tests/AndroidManifest.xml -A "$out/test-assets" -o "$out/test-res.apk"
  find tests/com -name '*.java' -print0 | xargs -0 javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$platform" -classpath "$out/classes" -d "$out/testclasses"
  jar cf "$out/test.jar" -C "$out/testclasses" .
  "$bt/d8" --release --min-api 29 --lib "$platform" --classpath "$out/classes.jar" --output "$out/testdex" "$out/test.jar"
  cp "$out/test-res.apk" "$out/test.apk";zip -q -j "$out/test.apk" "$out/testdex/classes.dex"
  "$bt/zipalign" -p -f 4 "$out/test.apk" "$out/test-aligned.apk"
  "$bt/apksigner" sign --ks "$out/qa.p12" --ks-pass pass:qa-build-only --key-pass pass:qa-build-only --out build/vps-widget-tests.apk "$out/test-aligned.apk"
 fi
fi
"$bt/zipalign" -c 4 "$unsigned"
"$bt/aapt2" dump badging "$unsigned"
"$bt/aapt2" dump permissions "$unsigned"
if unzip -Z1 "$unsigned" | grep -q '^lib/'; then echo 'Unexpected native runtime';exit 1;fi
bytes="$(wc -c < "$unsigned")";test "$bytes" -le 500000
sha256sum build/*.apk
