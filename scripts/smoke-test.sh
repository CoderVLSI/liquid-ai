#!/usr/bin/env bash
# Launch smoke test, run inside an Android emulator by CI (see .github/workflows/build-apk.yml).
# Installs the APK, launches it, taps through the main screens and fails on any crash or missing piece.
# Everything it saw is written to smoke-out/ (logcat, screenshots, UI dumps) for download.
set -u
APK="${1:?usage: smoke-test.sh app.apk}"
PKG=com.codervlsi.lfm3pocket
OUT=smoke-out
mkdir -p "$OUT"
FAIL=0
fail() { echo "❌ FAIL: $*"; FAIL=1; }
ok() { echo "✅ $*"; }

adb wait-for-device
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard 2>/dev/null || true

echo "== install"
adb install -r "$APK" || { fail "adb install failed"; exit 1; }
adb shell pm grant "$PKG" android.permission.RECORD_AUDIO || true
adb logcat -c

dump_ui() { # dump_ui <name>
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1
  adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null
}
ui_has() { grep -qF "$1" "$OUT/$2.xml" 2>/dev/null; }
alive() { [ -n "$(adb shell pidof "$PKG" | tr -d '\r')" ]; }

tap_desc() { # tap the element whose content-desc or text matches
  python3 - "$OUT/$2.xml" "$1" <<'EOF' | { read -r x y || { echo "none"; exit 0; }; adb shell input tap "$x" "$y"; echo "tapped $x $y"; }
import re, sys, xml.etree.ElementTree as ET
want = sys.argv[2]
for n in ET.parse(sys.argv[1]).iter('node'):
    if want in (n.get('content-desc') or '') or want == (n.get('text') or ''):
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds') or '')
        if m:
            a, b, c, d = map(int, m.groups())
            print((a + c) // 2, (b + d) // 2)
            break
EOF
}

crashed() {
  adb logcat -d -v time > "$OUT/logcat.txt"
  grep -E "FATAL EXCEPTION|Process $PKG.* has died|ANR in $PKG|Fatal signal|SIGSEGV|SIGABRT" "$OUT/logcat.txt" | head -20
}

# print the actual stack trace of a crash so it shows up in the CI log
show_crash() {
  adb logcat -d -v time > "$OUT/logcat.txt"
  echo "---------- crash details ----------"
  grep -n -A45 "FATAL EXCEPTION" "$OUT/logcat.txt" | cut -c1-220 | head -80
  echo "---------- app log lines before the crash ----------"
  grep -E "LiquidVoice|ReactNativeJS" "$OUT/logcat.txt" | tail -25 | cut -c1-240
  echo "-----------------------------------"
}

echo "== launch"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 25
dump_ui home

if alive; then ok "app process is running after launch"; else fail "app process is NOT running after launch"; fi
C=$(crashed); if [ -n "$C" ]; then fail "crash signatures in logcat:"; echo "$C"; fi

echo "== first screen"
if ui_has "Native module missing" home; then fail "native module (LiquidNative) was not found at runtime"; fi
if ui_has "Choose models" home || ui_has "Ask anything" home; then ok "welcome screen rendered"; else fail "welcome screen not visible"; fi
echo "-- visible text:"; grep -o 'text="[^"]\+"' "$OUT/home.xml" | sort -u | head -20

echo "== what the app logged on boot"
grep "LiquidVoice" "$OUT/logcat.txt" | grep -E "\[boot\]" | head -10
if grep -q "server binary present=true" "$OUT/logcat.txt"; then ok "llama server binary is inside the APK and extracted"; else fail "server binary missing from the installed app"; fi
if grep -q "LiquidNative module created" "$OUT/logcat.txt"; then ok "native module loaded"; else fail "native module did not initialise"; fi

echo "== tap through screens"
tap_desc "Choose model" home; sleep 3; dump_ui models
if ui_has "Models" models && (ui_has "Download" models || ui_has "LFM3-Omni" models); then ok "Models sheet opens"; else fail "Models sheet did not open"; fi
adb shell input keyevent KEYCODE_BACK; sleep 2

tap_desc "Settings" home; sleep 3; dump_ui settings
if ui_has "Live voice" settings || ui_has "Interrupt by speaking" settings; then ok "Settings sheet opens"; else fail "Settings sheet did not open"; fi
adb shell input keyevent KEYCODE_BACK; sleep 2

tap_desc "Debug" home; sleep 4; dump_ui debug
if ui_has "Logs" debug && ui_has "Crashes" debug; then ok "Debug sheet opens"; else fail "Debug sheet did not open"; fi
adb shell input keyevent KEYCODE_BACK; sleep 2

# the separate Agents button is gone; Agent is a mode toggle next to Chat
if ui_has 'content-desc="Agents"' home; then fail "the old Agents button is still there"; else ok "no separate Agents button"; fi
tap_desc "Agent mode" home; sleep 3; dump_ui agent
if ui_has "Give Pocket a task" agent && ui_has "Tools & connections" agent; then ok "Agent mode shows Pocket, its composer and tools button"; else fail "Agent mode did not render"; show_crash; fi
if ui_has "Pocket is" agent; then ok "mascot rendered"; else echo "(mascot label not detected)"; fi

tap_desc "Agent settings" agent; sleep 3; dump_ui agentsettings
if ui_has "Agent settings" agentsettings && ui_has "Connections" agentsettings; then ok "Agent settings sheet opens (options + connections)"; else fail "Agent settings did not open"; fi
adb shell input keyevent KEYCODE_BACK; sleep 2

# give Pocket a task with no model downloaded: it must fail gracefully; starting the foreground service must not crash the app
dump_ui agent2
tap_desc "Give Pocket a task" agent2; sleep 1; adb shell input text "what%sis%s2%splus%s2"; sleep 1
dump_ui agent3
tap_desc "Send task" agent3; sleep 8; dump_ui agent4
if ui_has "No model is downloaded" agent4 || ui_has "Failed" agent4; then ok "task without a model fails gracefully"; else echo "(task result not detected)"; fi
if alive; then ok "app alive after giving Pocket a task (foreground service)"; else fail "app died when starting an agent task"; show_crash; fi

tap_desc "Chat mode" agent4; sleep 2; dump_ui home

tap_desc "Start live voice" home; sleep 3; dump_ui mic
if ui_has "Download a model first" mic || ui_has "Models" mic; then ok "mic with no model downloaded explains what to do"; else fail "mic tap with no model gave no feedback"; fi
adb shell input keyevent KEYCODE_BACK; sleep 1

echo "== server binary runs on this device"
# google_apis emulator images allow adb root; the app's install dir is not listable as the plain shell user.
adb root >/dev/null 2>&1; adb wait-for-device; sleep 3
APKPATH=$(adb shell pm path "$PKG" | head -1 | sed 's/^package://' | tr -d '\r')
APPDIR=$(dirname "$APKPATH")
echo "app dir: $APPDIR"
adb shell "ls -la $APPDIR/lib/*/ 2>&1" | tr -d '\r' | head -20
BIN=$(adb shell "ls $APPDIR/lib/*/libllama_server.so 2>/dev/null" | tr -d '\r' | head -1)
echo "binary: ${BIN:-not found}"
if [ -n "$BIN" ]; then
  V=$(adb shell "$BIN --version 2>&1" | tr -d '\r' | head -6)
  echo "$V"
  if echo "$V" | grep -qiE "version|llama|build"; then ok "llama-server executes on Android"; else fail "llama-server did not run: $V"; fi
else
  fail "libllama_server.so not found next to the installed APK (native libs not extracted?)"
fi

echo "== final health"
if alive; then ok "app still running after interaction"; else fail "app died during interaction"; fi
C=$(crashed); if [ -n "$C" ]; then fail "crash signatures in logcat after interaction:"; echo "$C"; fi
grep -E "ReactNativeJS.*(Error|error)|LiquidVoice.*\bE\b" "$OUT/logcat.txt" | head -15

echo
if [ "$FAIL" -eq 0 ]; then echo "SMOKE TEST PASSED"; else echo "SMOKE TEST FAILED"; fi
exit "$FAIL"
