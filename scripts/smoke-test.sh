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

# The CI emulator is a slow virtual phone: the system launcher can stall and pop an "isn't responding" dialog that
# blocks every tap. Hide those dialogs (crashes are still detected through logcat / the process list) and settle first.
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put global window_animation_scale 0.0 || true
adb shell settings put global transition_animation_scale 0.0 || true
adb shell settings put global animator_duration_scale 0.0 || true
echo "waiting for the emulator to settle..."; sleep 25

echo "== install"
adb install -r "$APK" || { fail "adb install failed"; exit 1; }
adb shell pm grant "$PKG" android.permission.RECORD_AUDIO || true
adb logcat -c

dump_ui() { # dump_ui <name>
  # uiautomator refuses to dump a screen that never goes idle (e.g. a looping animation) and then leaves the OLD file in
  # place, which would silently show the previous screen. Delete it first so a failed dump is detected, and retry.
  local ok=0
  for attempt in 1 2 3; do
    adb shell rm -f /sdcard/ui.xml >/dev/null 2>&1
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    if adb shell test -s /sdcard/ui.xml 2>/dev/null; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" -eq 1 ]; then
    adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1
  else
    echo "(uiautomator could not dump '$1': the screen never went idle, probably a looping animation)"
    echo '<hierarchy/>' > "$OUT/$1.xml"
  fi
  if grep -q "isn't responding" "$OUT/$1.xml" 2>/dev/null; then
    echo "(a system 'isn't responding' dialog appeared; pressing Wait)"
    tap_desc "Wait" "$1" >/dev/null; sleep 3
    adb shell rm -f /sdcard/ui.xml >/dev/null 2>&1
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1
  fi
  adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null
}

ui_has() { grep -qF "$1" "$OUT/$2.xml" 2>/dev/null; }
# print every text / content-desc on a dumped screen (xml-unescaped), to see what the app really showed
show_ui() { python3 - "$OUT/$1.xml" <<'PY'
import sys, xml.etree.ElementTree as ET
seen = []
for n in ET.parse(sys.argv[1]).iter('node'):
    for k in ('text', 'content-desc'):
        v = n.get(k)
        if v and v not in seen: seen.append(v)
print('   on screen:', ' | '.join(x.replace('\n', ' ')[:60] for x in seen[:40]))
PY
}
alive() { [ -n "$(adb shell pidof "$PKG" | tr -d '\r')" ]; }

# Press BACK until the main screen (with the Chat/Agent toggle) is showing again. A modal sheet only exposes its own
# window to uiautomator, so the toggle appearing proves the sheet really closed.
close_sheet() {
  for i in 1 2 3 4; do
    adb shell input keyevent KEYCODE_BACK; sleep 2
    dump_ui probe
    if ui_has 'content-desc="Agent mode"' probe; then dump_ui home; return 0; fi
  done
  fail "BACK did not return to the main screen after 4 tries"; show_ui probe
  return 1
}

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

echo "== first screen: the first-run setup wizard"
if ui_has "Native module missing" home; then fail "native module (LiquidNative) was not found at runtime"; fi
if ui_has "Meet your buddy" home; then ok "first-run setup opens on a fresh install"; else fail "setup wizard not shown on first launch"; show_ui home; fi
echo "-- visible text:"; grep -o 'text="[^"]\+"' "$OUT/home.xml" | sort -u | head -20

echo "== what the app logged on boot"
grep "LiquidVoice" "$OUT/logcat.txt" | grep -E "\[boot\]" | head -10
if grep -q "server binary present=true" "$OUT/logcat.txt"; then ok "llama server binary is inside the APK and extracted"; else fail "server binary missing from the installed app"; fi
if grep -q "LiquidNative module created" "$OUT/logcat.txt"; then ok "native module loaded"; else fail "native module did not initialise"; fi

echo "== walk through the setup wizard"
tap_desc "Buddy Bloop" home; sleep 2; dump_ui s_buddy
if ui_has 'text="Bloop"' s_buddy; then ok "picking a buddy fills in its name"; else fail "buddy name was not filled in"; show_ui s_buddy; fi
setup_step() { # setup_step <title it should reach>
  tap_desc "Next" cur; sleep 2; dump_ui cur
  if ui_has "$1" cur; then ok "setup step: $1"; else fail "setup did not reach: $1"; show_ui cur; fi
}
dump_ui cur
setup_step "About you"
setup_step "Your time zone"
tap_desc "Time zone India" cur; sleep 1
setup_step "Get a brain"
setup_step "What may it use"
setup_step "Connect more"
setup_step "Quick tour"
tap_desc "Start" cur; sleep 4; dump_ui home
if ui_has "Choose models" home || ui_has "Ask anything" home; then ok "main screen after setup"; else fail "main screen not visible after setup"; show_ui home; fi
if alive; then ok "app alive after setup"; else fail "app died during setup"; show_crash; fi

echo "== tap through screens"
tap_desc "Choose model" home; sleep 3; dump_ui models
if ui_has "Models" models && (ui_has "Download" models || ui_has "LFM3-Omni" models); then ok "Models sheet opens"; else fail "Models sheet did not open"; fi
close_sheet

tap_desc "Settings" home; sleep 3; dump_ui settings
if ui_has "Live voice" settings || ui_has "Interrupt by speaking" settings; then ok "Settings sheet opens"; else fail "Settings sheet did not open"; fi
if ui_has "Phone voice" settings; then ok "phone voice option is there"; else echo "(phone voice option not detected)"; fi
tap_desc "Profile and setup" settings; sleep 3; dump_ui rerun
if ui_has "Meet your buddy" rerun; then ok "setup can be reopened from Settings"; else fail "Profile & setup did not reopen the wizard"; show_ui rerun; fi
tap_desc "Close setup" rerun; sleep 3; dump_ui home

tap_desc "History" home; sleep 3; dump_ui history
if ui_has "History" history && (ui_has "No past chats" history || ui_has "Open chat" history); then ok "History sheet opens"; else fail "History sheet did not open"; show_ui history; fi
close_sheet

tap_desc "Debug" home; sleep 4; dump_ui debug
if ui_has "Logs" debug && ui_has "Crashes" debug; then ok "Debug sheet opens"; else fail "Debug sheet did not open"; fi
close_sheet

# the separate Agents button is gone; Agent is a mode toggle next to Chat
if ui_has 'content-desc="Agents"' home; then fail "the old Agents button is still there"; else ok "no separate Agents button"; fi
tap_desc "Agent mode" home; sleep 5; dump_ui agent
echo "--- after the first tap:"; show_ui agent
adb logcat -d -v time | grep "LiquidVoice" | grep "\[ui\]" | tail -8 | cut -c1-200
if ! ui_has "Give Bloop a task" agent; then
  echo "(mode did not switch; tapping the Agent toggle once more)"; tap_desc "Agent mode" home; sleep 5; dump_ui agent
  echo "--- after the second tap:"; show_ui agent
  adb logcat -d -v time | grep "LiquidVoice" | grep "\[ui\]" | tail -8 | cut -c1-200
fi
# note: the dump escapes '&', so match on words without it
if ui_has "Give Bloop a task" agent && ui_has "Agent settings" agent; then ok "Agent mode shows the buddy, its composer and tools button"; else fail "Agent mode did not render"; show_crash; fi
if ui_has "Bloop is" agent; then ok "mascot rendered"; else echo "(mascot label not detected)"; fi

tap_desc "Agent settings" agent; sleep 3; dump_ui agentsettings
if ui_has "Agent settings" agentsettings && ui_has "Connections" agentsettings; then ok "Agent settings sheet opens (options + connections)"; else fail "Agent settings did not open"; fi
close_sheet

# give Pocket a task with no model downloaded: it must fail gracefully; starting the foreground service must not crash the app
dump_ui agent2
tap_desc "Give Bloop a task" agent2; sleep 1; adb shell input text "what%sis%s2%splus%s2"; sleep 1
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
