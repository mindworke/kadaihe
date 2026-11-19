#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

sdk_root=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
if [[ -z "$sdk_root" ]]; then
  printf '%s\n' '请设置 ANDROID_SDK_ROOT，指向 Android SDK 目录。' >&2
  exit 1
fi
tools="$sdk_root/build-tools/35.0.0"
platform="$sdk_root/platforms/android-35/android.jar"
if [[ ! -x "$tools/aapt2" || ! -x "$tools/d8" || ! -x "$tools/zipalign" || ! -x "$tools/apksigner" || ! -f "$platform" ]]; then
  printf '%s\n' '请安装 Android SDK Platform 35 与 Build-Tools 35.0.0。' >&2
  exit 1
fi

cover_origin=${KADAIBOX_COVER_ORIGIN:-}
if [[ -n "$cover_origin" && ! "$cover_origin" =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
  printf '%s\n' 'KADAIBOX_COVER_ORIGIN 应为 HTTPS 站点根地址，无需路径、参数或尾部斜杠。' >&2
  exit 1
fi

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

fetch_dependency() {
  local name=$1 address=$2 expected=$3 target temp
  target="build/dependencies/$name"
  if [[ -f "$target" && "$(sha256 "$target")" == "$expected" ]]; then
    return
  fi
  temp="$work/$name"
  curl --fail --silent --show-error --location --retry 2 "$address" --output "$temp"
  if [[ "$(sha256 "$temp")" != "$expected" ]]; then
    printf '依赖校验失败：%s\n' "$name" >&2
    exit 1
  fi
  mv "$temp" "$target"
}

mkdir -p build/dependencies
work=$(mktemp -d build/build.XXXXXXXX)
trap 'rm -rf -- "$work"' EXIT
fetch_dependency ecj-3.38.0.jar \
  https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.38.0/ecj-3.38.0.jar \
  97c566b120009c203a2fc8b291f4a9adbc171cf1ccb70f06f6b4e1828c00ce8e
fetch_dependency zxing-core-3.5.3.jar \
  https://repo.maven.apache.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar \
  8d8064c1636fdaef7189dd9055c7d59950a8940a12f2293956446ec3c109fd82
ecj=build/dependencies/ecj-3.38.0.jar
zxing=build/dependencies/zxing-core-3.5.3.jar

mkdir -p "$work/res" "$work/gen" "$work/classes" "$work/dex"
cp -R app/res/. "$work/res/"
printf '<resources><string name="cover_library_origin" translatable="false">%s</string></resources>\n' \
  "$cover_origin" > "$work/res/values/cover-library.xml"
"$tools/aapt2" compile --dir "$work/res" -o "$work/resources.zip"
"$tools/aapt2" link -I "$platform" --manifest app/AndroidManifest.xml --java "$work/gen" \
  -A app/assets -o "$work/unaligned.apk" "$work/resources.zip"

mapfile -t sources < <(find app/java "$work/gen" -name '*.java' | LC_ALL=C sort)
java -jar "$ecj" -source 8 -target 8 -encoding UTF-8 -nowarn -proc:none \
  -classpath "$platform:$zxing" -d "$work/classes" "${sources[@]}"
mapfile -t classes < <(find "$work/classes" -name '*.class' | LC_ALL=C sort)
"$tools/d8" --release --lib "$platform" --min-api 26 --output "$work/dex" "${classes[@]}" "$zxing"
zip -q -X -j "$work/unaligned.apk" "$work"/dex/classes*.dex
"$tools/zipalign" -f -p 4 "$work/unaligned.apk" "$work/aligned.apk"

version=$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' app/AndroidManifest.xml)
if [[ -n "${KADAIBOX_KEYSTORE:-}" ]]; then
  : "${KADAIBOX_KEY_ALIAS:?请设置签名密钥别名}"
  : "${KADAIBOX_KEYSTORE_PASSWORD:?请设置签名文件密码}"
  apk="build/Kadaihe-$version.apk"
  signing=(--ks "$KADAIBOX_KEYSTORE" --ks-key-alias "$KADAIBOX_KEY_ALIAS" --ks-pass env:KADAIBOX_KEYSTORE_PASSWORD)
  if [[ -n "${KADAIBOX_KEY_PASSWORD:-}" ]]; then
    signing+=(--key-pass env:KADAIBOX_KEY_PASSWORD)
  fi
else
  apk="build/Kadaihe-$version-debug.apk"
  debug_keystore=build/local-debug.p12
  if [[ ! -f "$debug_keystore" ]]; then
    (
      umask 077
      keytool -genkeypair -alias kadaihe-local-debug -keyalg RSA -keysize 2048 -validity 3650 \
        -storetype PKCS12 -keystore "$debug_keystore" -storepass android \
        -dname 'CN=Kadaihe Local Debug' -noprompt
    )
  fi
  signing=(--ks "$debug_keystore" --ks-key-alias kadaihe-local-debug --ks-pass pass:android)
fi
"$tools/apksigner" sign "${signing[@]}" --v4-signing-enabled false --out "$apk" "$work/aligned.apk"
"$tools/apksigner" verify --verbose "$apk"
"$tools/zipalign" -c -p 4 "$apk"
printf '生成：%s\n' "$apk"
