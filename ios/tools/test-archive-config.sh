#!/bin/bash
# Shows archive.sh's signing-settings checks can refuse as well as pass (kosmos #4089), on scratch copies of
# ios/Signing.xcconfig: run with --check-config, so nothing is archived or uploaded.
set -u
unset KOSMOS_IOS_PROFILE KOSMOS_IOS_NOTICE_PROFILE   # #6262: an inherited value would run every default case in hand-signing mode
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work" "$here/../build/archive-999999"' EXIT   # the wiring cases below build into archive-999999
stone="864QZ""69GF2"   # in pieces, as in archive.sh, so the cut-sign sweep does not count this file
kosmos="6563JLN""5HF"   # Kosmos Agent Manager, Inc. (#6262), in pieces for the same reason as $stone
fail=0
# expect NAME WANT(0|1) TEAM BUNDLE
expect() {
  printf 'DEVELOPMENT_TEAM = %s\nKOSMOS_BUNDLE_ID = %s\n' "$3" "$4" > "$work/$1.xcconfig"
  out=$(KOSMOS_IOS_XCCONFIG="$work/$1.xcconfig" "$here/archive.sh" --check-config 2>&1); rc=$?
  if { [ "$2" -eq 0 ] && [ "$rc" -eq 0 ]; } || { [ "$2" -ne 0 ] && [ "$rc" -ne 0 ]; }; then
    echo "PASS  $1 (rc=$rc)"
  else
    echo "FAIL  $1: wanted rc=$2, got rc=$rc: $out"; fail=1
  fi
}
expect real-under-kosmos        0 "$kosmos"    io.kosmos.app
expect real-under-kosmos-case   0 "$kosmos"    IO.Kosmos.App
expect real-under-other-team    1 ABCDE12345   io.kosmos.app
expect real-under-stone         1 "$stone"     io.kosmos.app
expect real-under-stone-case    1 "$stone"     IO.Kosmos.App
expect other-id-under-other     0 ABCDE12345   io.kosmos.app.preview
for t in "$stone" ABCDE12345; do
  printf 'DEVELOPMENT_TEAM = %s\nKOSMOS_BUNDLE_ID = io.kosmos.app\n' "$t" > "$work/pin.xcconfig"
  if KOSMOS_IOS_XCCONFIG="$work/pin.xcconfig" "$here/archive.sh" --check-config 2>&1 | grep -q 'is built only under Kosmos Agent Manager'; then
    echo "PASS  io.kosmos.app under $t is refused by the pairing check itself"
  else echo "FAIL  io.kosmos.app under $t was not refused by the pairing check"; fail=1; fi
done
expect empty-team               1 ""           io.kosmos.app.preview
expect short-team               1 ABC          io.kosmos.app.preview
expect bad-bundle-dots          1 "$stone"     io..kosmos
expect bad-bundle-empty         1 "$stone"     ""
# A missing setting is refused WITH its sentence (a silent rc=1 told nobody why).
printf 'DEVELOPMENT_TEAM = ABCDE12345\n' > "$work/nobundle.xcconfig"
if KOSMOS_IOS_XCCONFIG="$work/nobundle.xcconfig" "$here/archive.sh" --check-config 2>&1 | grep -q 'KOSMOS_BUNDLE_ID must be set exactly once.*found 0'; then echo "PASS  a missing KOSMOS_BUNDLE_ID is refused and named"; else echo "FAIL  a missing KOSMOS_BUNDLE_ID was not refused with its sentence"; fail=1; fi
# A second KOSMOS_BUNDLE_ID line (xcconfig takes the last) must not slip io.kosmos.app past the pairing check.
printf 'DEVELOPMENT_TEAM = %s\nKOSMOS_BUNDLE_ID = io.kosmos.app.preview\nKOSMOS_BUNDLE_ID = io.kosmos.app\n' "$stone" > "$work/dup.xcconfig"
if KOSMOS_IOS_XCCONFIG="$work/dup.xcconfig" "$here/archive.sh" --check-config 2>&1 | grep -q 'must be set exactly once'; then echo "PASS  a second KOSMOS_BUNDLE_ID line is refused"; else echo "FAIL  a second KOSMOS_BUNDLE_ID line was not refused"; fail=1; fi
printf 'DEVELOPMENT_TEAM = %s\nKOSMOS_BUNDLE_ID = io.kosmos.app.preview\nKOSMOS_BUNDLE_ID[sdk=iphoneos*] = io.kosmos.app\n' "$stone" > "$work/cond.xcconfig"
if KOSMOS_IOS_XCCONFIG="$work/cond.xcconfig" "$here/archive.sh" --check-config 2>&1 | grep -q 'must be set exactly once'; then echo "PASS  a conditional KOSMOS_BUNDLE_ID line is refused"; else echo "FAIL  a conditional KOSMOS_BUNDLE_ID line was not refused"; fail=1; fi
# The project file takes its bundle id from the xcconfig, in every configuration. An id typed into Xcode's
# General pane is written there and would win over Signing.xcconfig, out of sight of every check above.
pbx="$here/../Kosmos.xcodeproj/project.pbxproj"
# kosmos#6487: the notification extension's is the app's with .notice, in both of its configurations.
lit=$(grep -E 'PRODUCT_BUNDLE_IDENTIFIER = ' "$pbx" | grep -vF 'PRODUCT_BUNDLE_IDENTIFIER = "$(KOSMOS_BUNDLE_ID)";' | grep -vcF 'PRODUCT_BUNDLE_IDENTIFIER = "$(KOSMOS_BUNDLE_ID).notice";')
ref=$(grep -cF 'PRODUCT_BUNDLE_IDENTIFIER = "$(KOSMOS_BUNDLE_ID)";' "$pbx")
nref=$(grep -cF 'PRODUCT_BUNDLE_IDENTIFIER = "$(KOSMOS_BUNDLE_ID).notice";' "$pbx")
if [ "$lit" -eq 0 ] && [ "$ref" -ge 2 ] && [ "$nref" -eq 2 ]; then echo "PASS  project.pbxproj takes its bundle ids from Signing.xcconfig ($ref app, $nref extension configurations)"; else echo "FAIL  project.pbxproj sets a bundle id of its own ($lit literal, $ref app and $nref extension from the xcconfig)"; fail=1; fi
# Each target signs by hand with its own profile setting, never one profile for both.
if [ "$(grep -cF 'PROVISIONING_PROFILE_SPECIFIER = "$(KOSMOS_APP_PROFILE)";' "$pbx")" -eq 2 ] && [ "$(grep -cF 'PROVISIONING_PROFILE_SPECIFIER = "$(KOSMOS_NOTICE_PROFILE)";' "$pbx")" -eq 2 ] \
  && [ "$(grep -c 'PROVISIONING_PROFILE_SPECIFIER = ' "$pbx")" -eq 4 ]; then echo "PASS  the app and the extension each take their own profile setting"
else echo "FAIL  project.pbxproj's profile settings are not one per target"; fail=1; fi

# The real file passes as it stands (an inherited override must not redirect it).
unset KOSMOS_IOS_XCCONFIG
# #6262: a hand-signing profile name PlistBuddy would mangle is refused by --check-config; a plain one with spaces passes.
printf 'DEVELOPMENT_TEAM = %s\nKOSMOS_BUNDLE_ID = %s\n' "$kosmos" io.kosmos.app > "$work/prof.xcconfig"
for name in "Josh's App Store" 'a "quoted" one' ' leading' 'back\slash' 'cost $5' 'Store $HOME' '' "$(printf 'Good\nbad')" "$(printf 'tab\there')"; do
  if KOSMOS_IOS_PROFILE="$name" KOSMOS_IOS_NOTICE_PROFILE='Kosmos Notice App Store' KOSMOS_IOS_XCCONFIG="$work/prof.xcconfig" "$here/archive.sh" --check-config 2>&1 | grep -q 'KOSMOS_IOS_PROFILE is'; then echo "PASS  the profile name '$name' is refused"; else echo "FAIL  the profile name '$name' was not refused"; fail=1; fi
  if KOSMOS_IOS_PROFILE='Kosmos App Store' KOSMOS_IOS_NOTICE_PROFILE="$name" KOSMOS_IOS_XCCONFIG="$work/prof.xcconfig" "$here/archive.sh" --check-config 2>&1 | grep -q 'KOSMOS_IOS_NOTICE_PROFILE is'; then echo "PASS  the extension's profile name '$name' is refused"; else echo "FAIL  the extension's profile name '$name' was not refused"; fail=1; fi
done
for name in 'Kosmos App Store' 'Kosmos, Inc. App Store + Push' 'Store/Dist & Co #2'; do
  if KOSMOS_IOS_PROFILE="$name" KOSMOS_IOS_NOTICE_PROFILE="$name Notice" KOSMOS_IOS_XCCONFIG="$work/prof.xcconfig" "$here/archive.sh" --check-config >/dev/null 2>&1; then echo "PASS  the profile name '$name' passes"; else echo "FAIL  the profile name '$name' was refused"; fail=1; fi
done
# kosmos#6487: signing by hand names both profiles, or neither.
if KOSMOS_IOS_PROFILE='Kosmos App Store' KOSMOS_IOS_XCCONFIG="$work/prof.xcconfig" "$here/archive.sh" --check-config 2>&1 | grep -q 'needs its own App Store profile too'; then echo "PASS  the app's profile without the extension's is refused"; else echo "FAIL  the app's profile without the extension's was not refused"; fail=1; fi
if KOSMOS_IOS_NOTICE_PROFILE='Kosmos Notice App Store' KOSMOS_IOS_XCCONFIG="$work/prof.xcconfig" "$here/archive.sh" --check-config 2>&1 | grep -q 'without KOSMOS_IOS_PROFILE'; then echo "PASS  the extension's profile without the app's is refused"; else echo "FAIL  the extension's profile without the app's was not refused"; fail=1; fi
# #6262: what hand signing does to the export options and the archive's settings, via export-options.sh (the
# helper archive.sh runs), and that without a profile nothing changes.
pb=/usr/libexec/PlistBuddy
settings=$("$here/export-options.sh" "$kosmos" io.kosmos.app "$work/auto.plist")
if [ -z "$settings" ] && [ "$($pb -c 'Print :signingStyle' "$work/auto.plist")" = automatic ] && ! $pb -c 'Print :provisioningProfiles' "$work/auto.plist" >/dev/null 2>&1 \
  && [ "$($pb -c 'Print :teamID' "$work/auto.plist")" = "$kosmos" ]; then echo "PASS  without a profile: automatic signing, the team, no profiles, no build settings"
else echo "FAIL  without a profile the export options or build settings changed: [$settings]"; fail=1; fi
for name in 'Kosmos App Store' 'Kosmos App Store ' 'Kosmos, Inc. App Store + Push'; do
  settings=$("$here/export-options.sh" "$kosmos" io.kosmos.app "$work/man.plist" "$name" "$name Notice"); rc=$?
  want=$(printf '%s\n' CODE_SIGN_STYLE=Manual "CODE_SIGN_IDENTITY=Apple Distribution" "KOSMOS_APP_PROFILE=$name" "KOSMOS_NOTICE_PROFILE=$name Notice")
  if [ "$rc" -eq 0 ] && [ "$settings" = "$want" ] && [ "$($pb -c 'Print :signingStyle' "$work/man.plist")" = manual ] \
    && [ "$($pb -c 'Print :signingCertificate' "$work/man.plist")" = 'Apple Distribution' ] \
    && [ "$($pb -c 'Print :provisioningProfiles:io.kosmos.app' "$work/man.plist")" = "$name" ] \
    && [ "$($pb -c 'Print :provisioningProfiles:io.kosmos.app.notice' "$work/man.plist")" = "$name Notice" ]; then echo "PASS  the profiles '$name' and '$name Notice' sign the export and the archive by hand"
  else echo "FAIL  the profile '$name' did not set hand signing: rc=$rc [$settings]"; fail=1; fi
done
if "$here/export-options.sh" "$kosmos" io.kosmos.app "$work/half.plist" 'Kosmos App Store' >/dev/null 2>&1; then echo "FAIL  export-options.sh signed by hand with no extension profile"; fail=1
else echo "PASS  export-options.sh refuses hand signing with no extension profile"; fi
if "$here/export-options.sh" "$kosmos" io.kosmos.app "$work/badn.plist" 'Kosmos App Store' "Josh's" >/dev/null 2>&1; then echo "FAIL  an extension profile name PlistBuddy drops was not refused by the read-back"; fail=1
else echo "PASS  an extension profile name PlistBuddy drops is refused by the read-back"; fi
if "$here/export-options.sh" "$kosmos" io.kosmos.app "$work/bad.plist" "Josh's" 'Kosmos Notice' >/dev/null 2>&1; then echo "FAIL  a name PlistBuddy drops was not refused by the read-back"; fail=1
else echo "PASS  a name PlistBuddy drops is refused by the read-back"; fi
if "$here/archive.sh" --check-config >/dev/null 2>&1; then echo "PASS  the project's own Signing.xcconfig"; else echo "FAIL  the project's own Signing.xcconfig is refused"; fail=1; fi
# The override is refused on a real (non --check-config) run, before anything is built.
out=$(KOSMOS_IOS_XCCONFIG="$work/real-under-kosmos.xcconfig" "$here/archive.sh" --build 1 2>&1); rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'for --check-config only'; then echo "PASS  the override is refused on a real archive (rc=$rc)"; else echo "FAIL  the override was not refused on a real archive (rc=$rc): $out"; fail=1; fi
# #6262: archive.sh's own wiring, with a stand-in xcodebuild that records its arguments and builds nothing (so the run
# stops after the export call, with no .ipa). Build 999999 under ios/build, removed by the trap.
mkdir -p "$work/bin"
printf '#!/bin/bash\n{ printf "%%s\\n" "$@"; echo ---; } >> "%s/xcodebuild.args"\n' "$work" > "$work/bin/xcodebuild"; chmod +x "$work/bin/xcodebuild"
wired() {   # $1: profile or empty; prints the recorded arguments
  rm -f "$work/xcodebuild.args"
  ( unset ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID; PATH="$work/bin:$PATH" KOSMOS_IOS_PROFILE="$1" KOSMOS_IOS_NOTICE_PROFILE="$2" "$here/archive.sh" --build 999999 ) >/dev/null 2>&1
  cat "$work/xcodebuild.args" 2>/dev/null
}
args=$(unset KOSMOS_IOS_PROFILE KOSMOS_IOS_NOTICE_PROFILE; rm -f "$work/xcodebuild.args"; ( unset ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID; PATH="$work/bin:$PATH" "$here/archive.sh" --build 999999 ) >/dev/null 2>&1; cat "$work/xcodebuild.args" 2>/dev/null)
plist=$(printf '%s\n' "$args" | grep -A1 -x -- -exportOptionsPlist | tail -1)
if printf '%s\n' "$args" | grep -qx archive && ! printf '%s\n' "$args" | grep -q '^CODE_SIGN_STYLE=\|^PROVISIONING_PROFILE_SPECIFIER=\|^KOSMOS_APP_PROFILE=\|^KOSMOS_NOTICE_PROFILE=\|^PRODUCT_BUNDLE_IDENTIFIER=' \
  && printf '%s\n' "$args" | grep -qx 'KOSMOS_BUNDLE_ID=io.kosmos.app' \
  && [ "$(/usr/libexec/PlistBuddy -c 'Print :signingStyle' "$plist" 2>/dev/null)" = automatic ] && ! /usr/libexec/PlistBuddy -c 'Print :provisioningProfiles' "$plist" >/dev/null 2>&1; then echo "PASS  archive.sh without a profile archives and exports with no hand-signing settings"
else echo "FAIL  archive.sh without a profile: $args"; fail=1; fi
args=$(wired 'Kosmos App Store' 'Kosmos Notice App Store')
plist=$(printf '%s\n' "$args" | grep -A1 -x -- -exportOptionsPlist | tail -1)
if printf '%s\n' "$args" | grep -qx 'CODE_SIGN_STYLE=Manual' && printf '%s\n' "$args" | grep -qx 'CODE_SIGN_IDENTITY=Apple Distribution' \
  && printf '%s\n' "$args" | grep -qx 'KOSMOS_APP_PROFILE=Kosmos App Store' && printf '%s\n' "$args" | grep -qx 'KOSMOS_NOTICE_PROFILE=Kosmos Notice App Store' \
  && ! printf '%s\n' "$args" | grep -q '^PROVISIONING_PROFILE_SPECIFIER=' && printf '%s\n' "$args" | grep -qx "DEVELOPMENT_TEAM=$kosmos" \
  && [ "$(/usr/libexec/PlistBuddy -c 'Print :provisioningProfiles:io.kosmos.app' "$plist" 2>/dev/null)" = 'Kosmos App Store' ] \
  && [ "$(/usr/libexec/PlistBuddy -c 'Print :provisioningProfiles:io.kosmos.app.notice' "$plist" 2>/dev/null)" = 'Kosmos Notice App Store' ]; then echo "PASS  archive.sh with a profile hands xcodebuild the hand-signing settings and the export options"
else echo "FAIL  archive.sh with a profile: $args"; fail=1; fi
[ "$fail" -eq 0 ] && echo "VERDICT: PASS" || echo "VERDICT: FAIL"
exit "$fail"
