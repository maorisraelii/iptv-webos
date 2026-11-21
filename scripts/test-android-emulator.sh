#!/usr/bin/env bash
set -u

APK_PATH="${1:-android-tv/app/build/outputs/apk/release/app-release.apk}"
OUT_DIR="emulator-artifacts"
mkdir -p "$OUT_DIR"

echo "=== Waiting for Android TV emulator device ==="
adb wait-for-device

for i in $(seq 1 60); do
  BOOT_COMPLETED="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  if [ "$BOOT_COMPLETED" = "1" ]; then
    break
  fi
  sleep 2
done

if [ "${BOOT_COMPLETED:-}" != "1" ]; then
  echo "ERROR: Emulator did not finish booting (sys.boot_completed=${BOOT_COMPLETED:-})"
  exit 1
fi

{
  echo "ro.build.version.release=$(adb shell getprop ro.build.version.release | tr -d '\r')"
  echo "ro.build.version.sdk=$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
  echo "ro.product.cpu.abi=$(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
  echo "ro.config.low_ram=$(adb shell getprop ro.config.low_ram | tr -d '\r')"
  echo "--- /proc/meminfo ---"
  adb shell head -n 5 /proc/meminfo | tr -d '\r'
  echo "--- dumpsys webviewupdate ---"
  adb shell dumpsys webviewupdate | tr -d '\r'
} > "$OUT_DIR/env.txt" 2>&1 || true

echo "=== Emulator Environment ==="
cat "$OUT_DIR/env.txt"

if [ ! -f "$APK_PATH" ]; then
  echo "ERROR: APK not found at $APK_PATH"
  exit 1
fi

echo "=== Installing APK: $APK_PATH ==="
adb install -r "$APK_PATH"

adb logcat -G 16M || true
adb logcat -c || true

echo "=== Launch 1 (Cold Boot) ==="
adb shell am start -W -n com.iptv.livetv.androidtv/.MainActivity
sleep 1

PID="$(adb shell pidof com.iptv.livetv.androidtv 2>/dev/null | tr -d '\r' || true)"
echo "[initial] pid=${PID:-NONE}"

CRASH_DETECTED=0
for sec in $(seq 1 25); do
  CUR_PID="$(adb shell pidof com.iptv.livetv.androidtv 2>/dev/null | tr -d '\r' || true)"
  echo "[t=${sec}s] pid=${CUR_PID:-NONE}"

  if [ -z "$CUR_PID" ] || { [ -n "$PID" ] && [ "$CUR_PID" != "$PID" ]; }; then
    CRASH_DETECTED=1
    sleep 2
    break
  fi

  if [ "$sec" -eq 5 ]; then
    adb exec-out screencap -p > "$OUT_DIR/boot_5s.png" || true
  fi

  if [ "$sec" -eq 10 ]; then
    adb shell dumpsys meminfo com.iptv.livetv.androidtv > "$OUT_DIR/meminfo.txt" 2>&1 || true
    adb shell dumpsys activity top | head -n 120 > "$OUT_DIR/activity_top.txt" 2>&1 || true
  fi

  if [ "$sec" -eq 15 ]; then
    echo "=== Sending TV remote D-pad / OK / Back events ==="
    adb shell input keyevent KEYCODE_DPAD_DOWN || true
    sleep 0.5
    adb shell input keyevent KEYCODE_DPAD_DOWN || true
    sleep 0.5
    adb shell input keyevent KEYCODE_DPAD_CENTER || true
    sleep 1
    adb shell input keyevent KEYCODE_DPAD_CENTER || true
    sleep 2
    adb shell input keyevent KEYCODE_BACK || true
    sleep 1
    adb exec-out screencap -p > "$OUT_DIR/after_keys.png" || true
  fi

  if [ "$sec" -eq 22 ]; then
    adb exec-out screencap -p > "$OUT_DIR/boot_22s.png" || true
  fi

  sleep 1
done

if [ "$CRASH_DETECTED" -eq 0 ]; then
  echo "=== Launch 2 (Warm Relaunch) ==="
  adb shell am force-stop com.iptv.livetv.androidtv || true
  sleep 1
  adb shell am start -W -n com.iptv.livetv.androidtv/.MainActivity
  sleep 1
  WARM_PID="$(adb shell pidof com.iptv.livetv.androidtv 2>/dev/null | tr -d '\r' || true)"
  echo "[warm initial] pid=${WARM_PID:-NONE}"
  for sec in $(seq 1 10); do
    CUR_WARM_PID="$(adb shell pidof com.iptv.livetv.androidtv 2>/dev/null | tr -d '\r' || true)"
    echo "[warm t=${sec}s] pid=${CUR_WARM_PID:-NONE}"
    if [ -z "$CUR_WARM_PID" ] || { [ -n "$WARM_PID" ] && [ "$CUR_WARM_PID" != "$WARM_PID" ]; }; then
      CRASH_DETECTED=1
      sleep 2
      break
    fi
    sleep 1
  done
fi

echo "=== Collecting Logcat & Diagnostics ==="
adb logcat -d > "$OUT_DIR/logcat-full.txt" 2>&1 || true

echo "=== IPTVAndroidTV Lifecycle Logs ==="
grep "IPTVAndroidTV" "$OUT_DIR/logcat-full.txt" || true

if [ -f "$OUT_DIR/meminfo.txt" ]; then
  echo "=== Meminfo Summary ==="
  grep -Ei "TOTAL PSS|Native Heap|Dalvik Heap|EGL|GL |Graphics|WebView|Views:" "$OUT_DIR/meminfo.txt" || head -n 40 "$OUT_DIR/meminfo.txt"
fi

if [ -f "$OUT_DIR/activity_top.txt" ]; then
  echo "=== Activity Top (first 40 lines) ==="
  head -n 40 "$OUT_DIR/activity_top.txt"
fi

echo "=== Filtered Logcat (last 300 lines) ==="
grep -Ei "IPTVAndroidTV|AndroidRuntime|FATAL|Fatal signal|SIGSEGV|SIGABRT|SIGBUS|backtrace|chromium|WebView|RenderProcess|lmkd|lowmemorykiller|ActivityManager.*iptv|WindowManager.*iptv|OpenGLRenderer|MediaCodec|com\.iptv\.livetv" "$OUT_DIR/logcat-full.txt" | tail -n 300 || true

FATAL_FOUND=0
if grep -Eq "FATAL EXCEPTION|Fatal signal|StackOverflowError|FATAL:jni_android|WebView render process gone|WebView initialization failed|WIN DEATH.*com\.iptv\.livetv|Process com\.iptv\.livetv\.androidtv.*has died" "$OUT_DIR/logcat-full.txt"; then
  echo "=== Fatal Logcat Markers Matched ==="
  grep -E "FATAL EXCEPTION|Fatal signal|StackOverflowError|FATAL:jni_android|WebView render process gone|WebView initialization failed|WIN DEATH.*com\.iptv\.livetv|Process com\.iptv\.livetv\.androidtv.*has died" "$OUT_DIR/logcat-full.txt" || true
  FATAL_FOUND=1
fi

BOOT_HIDDEN=0
if grep -q "IPTVAndroidTV.*Boot overlay hidden" "$OUT_DIR/logcat-full.txt"; then
  BOOT_HIDDEN=1
else
  echo "ERROR: Boot overlay was never hidden (app stayed stuck on loading spinner!)"
fi

if [ "$CRASH_DETECTED" -ne 0 ] || [ "$FATAL_FOUND" -ne 0 ] || [ "$BOOT_HIDDEN" -ne 1 ]; then
  echo "FAILED: CRASH_DETECTED=$CRASH_DETECTED FATAL_FOUND=$FATAL_FOUND BOOT_HIDDEN=$BOOT_HIDDEN"
  exit 1
fi

echo "PASSED: Android 14 TV emulator checks completed cleanly (Boot overlay hidden, 0 crashes)."
exit 0
