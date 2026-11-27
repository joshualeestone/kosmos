#!/bin/bash
# kosmos#7609: the sample-board UI tests (no account, a Debug build) a CI runner can run, on one fresh simulator: the +
# tray (AttachMenuUITests), the room title check (RoomTitleUITests), the keyboard (KeyboardSlideUITests), a long
# room opening on its newest post (RoomOpensAtNewestUITests, #7654), the x on an add (StopAddingUITests, #7682) and the
# keyboard in that long room (RoomKeyboardUITests, #7690), and the launch screen's hand-over to the Connecting wait
# (LaunchHandoverUITests, #7945), a sent message settling without a step (SendMovesOnceUITests, #7348), text-message
# second-step setup on the phone, not the web page (TextSetupUITests, #8959), a web page opening on the phone while
# reaching nothing (WebFileUITests, #8953), and a task page's message, due date, edit, repeat, receipt, undo,
# subtask, parts, hold and checks, natively (TaskPageActionsUITests, #8958).
# Run by the ios workflow's "ui tests (sample board)" job, with --uikit by its two "uikit list (sample board) 1/2" and "2/2" jobs (--shard, kosmos#8453),
# with --build-only by its "ui build (sample board)" job (kosmos#8993), and by
# hand. Prints PASS, or FAIL with the failing check's own words.
#
#
#   ios/tools/ui-sample.sh [--keep] [--uikit [--shard 1/2|2/2]] [--products <dir>]
#   ios/tools/ui-sample.sh --build-only <dir>
#
# kosmos#8993: the app is built once per CI run and shared. --build-only <dir> builds for testing (xcodebuild
# build-for-testing, the same project, scheme and Debug configuration `xcodebuild test` uses) and leaves the products, their
# .xctestrun and the Xcode that built them (xcode-version) in <dir>, with no simulator. --products <dir> runs the tests from
# those products (test-without-building) instead of building; products from another Xcode, or none, are built here as
# before, said in one line, so a runner with another Xcode is slower, never red for it.
#
# --uikit (kosmos#8221): the same run on the UIKit chat list (TEST_RUNNER_KOSMOS_UIKITLIST=1), the list a phone draws only
# with Settings' "New chat list" switch on (slice 5). Only classes that switch lists; the full list and each slice's reason
# are at "classes=" below (KeyboardSlideUITests runs less its three rebuild checks: the UIKit list never rebuilds).
# ChatOpensAtNewest and NewMessages stay by hand on a Mac, for the reason ChatOpensAtNewest does below; ChatSearch and
# ChatDrag, also 260-message classes, run on this arm since slice 10 (the UIKit list draws that chat without the blank).
# Two of its checks open a project room, which draws the same either way: 12 of the 14 reach the UIKit list.
#
# The newest iOS runtime the selected Xcode's simulator SDK can run, and the smallest iPhone it offers (the least room above the keyboard). The simulator is
# new for each run and deleted at the end, and so are its own build and the results (--keep keeps them; a --products folder
# is never deleted). SignInUITests is left
# out: it needs a real account (ios/tools/ui-signin.sh). The keyboard checks need the on-screen keyboard, so a run stops if
# the Simulator's hardware keyboard preference is on (a setting others on a shared Mac use; it is never changed here).
# UI_SAMPLE_FAILED_RESULT=<path>: on a failed run, copy the result bundle there before it is deleted (CI's job sets it).
set -u
here="$(cd "$(dirname "$0")" && pwd)"
keep=0
uikit=0
shard=""
build_only=""
products=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep=1; shift ;;
    --uikit) uikit=1; shift ;;
    # kosmos#8453: half of the UIKit arm's classes, 1/2 (the earlier-pages classes) or 2/2 (the rest); see "shard" below.
    --shard) shard="${2:-}"; case "$shard" in 1/2|2/2) ;; *) echo "ui-sample: --shard takes 1/2 or 2/2" >&2; exit 2 ;; esac; shift 2 ;;
    # kosmos#8993: build once, test from the products (see the header).
    --build-only) build_only="${2:-}"; [ -n "$build_only" ] || { echo "ui-sample: --build-only takes a folder" >&2; exit 2; }; shift 2 ;;
    --products) products="${2:-}"; [ -n "$products" ] || { echo "ui-sample: --products takes a folder" >&2; exit 2; }; shift 2 ;;
    # The header comment, however long it grows: a fixed line range has to be raised each time the header grows, and
    # #7690's longer header would have cut its last line.
    -h|--help) awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "ui-sample: unknown argument $1" >&2; exit 2 ;;
  esac
done
# Each class and how many tests it holds: a filter that matches nothing also exits 0, so the count is what proves a run.
# kosmos#7420: KeyboardSlideUITests is 7 (its three rebuild checks and the composer-growth guard joined it; all 7 passed on
# CI's runner on PR #7692 before this count was raised, the job failing only on the count). kosmos#7817: 9 (the box
# growing and shrinking at the newest message, and a reader higher up while it grows).
# kosmos#7945 follow-up: LaunchHandoverUITests measures that the Connecting wait's ring sits at the screen's centre, where
# the launch screen draws it, on the Agents tab and on Projects, and at the largest text size (3 checks).
# kosmos#7348: SendMovesOnceUITests, a send paced as a real Mac answers does not step as it settles, nor as the agent picks it up (3 checks).
# kosmos#8072: EndPullUITests, pulling a chat past its newest message: the dots, ending, staying put, a second pull (6 checks).
# kosmos#8053: BlankRingUITests, the ring's real timing with the blank held back, and a normal open never showing it (5 checks).
# kosmos#8055: WarmReturnChatUITests, an open chat stays open across a return to the front, plainly and through a brief
#   Kosmos+ outage (the second fails without the fix), and one opened during the first connect stays open (3 checks).
# kosmos#8221 slice 5: NewChatListSwitchUITests, Settings' "New chat list" switch choosing the list for the next chat (1 check;
#   it sets no list by environment, so it runs in this lazy-arm run only).
# kosmos#8959: TextSetupUITests, "Use text messages instead" opening the number screen (no web page) and back, and the
#   texted-code and refused-number screens (2 checks).
# kosmos#8959 slice B1a: AccountScreenUITests, Settings' account row opening the native account screen, its rows and the
#   Retire sheet (1 check; no chat list, so this lazy-arm run only). Slice B1b: the second step offered, set up and on (1 more).
#   Slice B1c: passkeys (Remove asks first, Add) and a sign-in from a new place (Not me asks first) (1 more).
# kosmos#8959 slice C: DeleteAccountUITests, Settings' Delete account opening the native flow, Delete my account doing
#   nothing until I understand is ticked, the done screen, and Send the code again plus Keep my account (2 checks; no
#   chat list, so this lazy-arm run only).
classes="AttachMenuUITests:14 RoomTitleUITests:2 KeyboardSlideUITests:9 RoomOpensAtNewestUITests:5 StopAddingUITests:2 RoomKeyboardUITests:3 LaunchHandoverUITests:3 BlankRingUITests:5 SendMovesOnceUITests:3 EndPullUITests:6 NewChatListSwitchUITests:1 WarmReturnChatUITests:3 TextSetupUITests:2 WebFileUITests:1 AccountScreenUITests:3 DeleteAccountUITests:2"
# kosmos#7609: AttachMenuUITests.testTheRowFitsAtTheLargestText skips itself in this run (TEST_RUNNER_KOSMOS_UI_SAMPLE) and is named as skipped.
#   Alone on a Mac it runs: TEST_RUNNER_KOSMOS_UI_PLUS=1 xcodebuild test ... -only-testing:KosmosUITests/AttachMenuUITests/testTheRowFitsAtTheLargestText
# ChatOpensAtNewestUITests is left out of this run: its 260-message chat is too big for a CI runner to query (XCTest
# "Timed out while evaluating UI query" on both CI runs, iOS 26.5, while it passes here). Run it alone on a Mac:
#   TEST_RUNNER_KOSMOS_UI_PLUS=1 xcodebuild test ... -only-testing:KosmosUITests/ChatOpensAtNewestUITests
# kosmos#7420: the box growing then sending in that long chat is in ChatOpensAtNewestUITests for the same reason.
# KeyboardSlideUITests' third check (read higher up) used to wait on a clock and flake under load; Mona Lisa's #7627
# (kbrested-7609) replaced the wait with a marker, so the whole class runs here again. It records the chat's scroll events
# (KOSMOS_SAMPLE_TRACE=1): when it fails, the trace is printed below while the simulator still exists. RoomKeyboardUITests'
# checks (#7690, #7645) append to the SAME file, so the dump prints the whole file and names every keyboard check that ran,
# in order; each launch starts at its own "chat shown" or "room shown" line.
# kosmos#8958: on their own line, so a change here and one to the list above never conflict. UnsentDraftUITests, an unsent
#   draft drawn in the chat with Put in the message box and Dismiss, never the board (3 checks). TaskPageActionsUITests, a
#   task page's message box, due date and Edit title or detail (3), Repeats changed and saved (1), a done task's
#   receipt (1), minutes typed and saved (1), its file changes undone (1), Add subtask opening New Task for it (1), a part added, given and done (1), a hold's
#   wait and reason set (1), and Done when and the wake line (1).
classes="$classes UnsentDraftUITests:3 TaskPageActionsUITests:11"
# kosmos#8959 slice D1a: AutomationUITests, Settings' Automation row opening the native screen, a switch saved, and the
#   Recommender's guards under the page's heading (1 check; no chat list, so this lazy-arm run only). Its own line, as above.
classes="$classes AutomationUITests:1"
# kosmos#8959 slice D1b1: GlobalSkillsUITests, Settings' Global skills row opening the native list, Remove asking once,
#   and a skill added (1 check; lazy arm only). Its own line, as above.
classes="$classes GlobalSkillsUITests:1"
# kosmos#8959 slice D1b2: AIPoliciesUITests, Settings' AI policies row opening the native list, the confirm before a policy
#   is handed out, and Remove asking once (1 check; lazy arm only). Its own line, as above.
classes="$classes AIPoliciesUITests:1"
# kosmos#8959 slice D1c1: UpdatesUITests, Settings' Updates row opening the native card, Update asking first in the
#   page's words, and what it says once updated (1 check; lazy arm only). Its own line, as above.
classes="$classes UpdatesUITests:1"
# kosmos#8959 slice D1c2a: UsageUITests, Settings' Token usage row opening the native figures, the hero, the model
#   table, By agent and the history (1 check; lazy arm only). Its own line, as above.
classes="$classes UsageUITests:1"
# kosmos#9089: ChatTallOpenUITests, a short chat of tall replies (20 messages) opens on its newest, first time and on
#   coming back, with the one-liner chat as its control (2 checks; #9212's third is below). This lazy-arm run only: the lazy list is the one that
#   opened above the newest (3 of 3 before the fix), the UIKit list already passed. 20 messages, so not the 260-message
#   chat's query limit that keeps ChatOpensAtNewestUITests by hand. Its own line, as above.
# kosmos#9212: plus one check that re-opens that chat 8 times in one launch (the app froze on a re-open about one run in two).
classes="$classes ChatTallOpenUITests:3"
# kosmos#9002: DuoFoldUITests, two panes, a fold with a project's room open, its page opened folded, then an unfold and a chat three pages deep, and an
#   upright phone keeping its tabs out of a project's room, page and task (2 checks).
classes="$classes DuoFoldUITests:2"
# kosmos#9202: BoardGroundUITests, the board page over the tabs (Agents + asks, then opens it) on the board's own ground,
#   never navy, read from the screenshot's pixels in the Close bar row and under the status bar; with a control that the
#   pixel judge sees navy and each exact ground (2 checks). A fresh simulator is light, so CI sees light; dark is by hand
#   (simctl appearance dark, which the sample board follows).
classes="$classes BoardGroundUITests:2"
skip=""
arm="lazy"
if [ "$uikit" = 1 ]; then
  arm="UIKit"
  # kosmos#8221: KeyboardSlideUITests is 9 less its three rebuild checks, left out rather than run as skips, so a green run
  # carries no skip warning that is always there and a new skip still stands out. A renamed rebuild check is no longer
  # left out, skips itself, and the class count (7 of 6) turns the run red: check these names first.
  # kosmos#8221 slice 7: EarlierPagesUITests, earlier messages at the top of the UIKit list (2 checks, this arm only).
  # kosmos#8221 slice 8: LongPressKeyboardUITests (7) and DeleteMessageUITests (3), long press to copy or delete on the UIKit
  #   list; each chat launch asserts the UIKit list drew it (UIKitListArm.assertDrawn). This arm only (by hand on the lazy).
  # kosmos#8221 slice 9: EndPullUITests (6), the pull past the newest message, a message landing during it included.
  # kosmos#8221 slice 10: ChatSearchUITests (1) and ChatDragUITests (1), search and the drag that takes the keyboard down,
  #   each launch now asserting the UIKit list drew it. Neither is in the lazy arm's list (the 260-message chat's blank, above).
  # kosmos#8221 slice 11: A11yScrollUITests (12), a scroll up without a finger is not held at the end: animated and slow, a
  #   scroll that moves nothing, a jump to the newest during one, and three control arms with the fix off; kosmos#8442 adds
  #   five: a slow scroll and an animated one with the main thread stalled, the stall grace alone, its control (both off),
  #   and a record-only animated arm without the grace.
  # kosmos#8283: ChatGapUITests (3), the room between the newest message and the box and the working line's place in it, at
  #   the default and the largest text size, and the line seen from higher up. This arm only (the lazy list keeps its row).
  # kosmos#8221 slice 12: A11yFocusUITests (12), assistive focus on a message off screen, before the newest, brings it on screen and
  #   moves the reader by where the list lands, in either order with VoiceOver's own scroll; one on screen, or the newest, changes nothing; two controls.
  # kosmos#8221 slice 18: A11yFocusUITests (2 more, 14), controls for the on-screen and newest rules (KOSMOS_SAMPLE_FOCUSNOONSCREEN, _FOCUSNONEWEST).
  # kosmos#8221 slice 13: A11yActionsUITests (3), VoiceOver's Message actions opens the sheet (Copy, and Delete on your own message)
  #   from a hosted cell; one control with the opener left out of the cell.
  # kosmos#8221 slice 14: EarlierDroppedUITests (2), a reader up in earlier pages that are dropped (a "moved" read) goes to
  #   the top of what remains; one control with the fix off. Slice 16: the same for a delete that drops them (2 more);
  #   EarlierDoubleAskUITests (2), a page landing is not asked for again before the list says where the top is; one control.
  # kosmos#8221 slice 17: EarlierDeleteShiftUITests (2), after a delete the next page is asked from the window as it is (no
  #   message drawn twice); one control.
  classes="KeyboardSlideUITests:6 StopAddingUITests:2 SendMovesOnceUITests:3 ComposerSendUITests:3 EarlierPagesUITests:2 LongPressKeyboardUITests:7 DeleteMessageUITests:3 EndPullUITests:6 ChatSearchUITests:1 ChatDragUITests:1 A11yScrollUITests:12 ChatGapUITests:3 A11yFocusUITests:14 A11yActionsUITests:3 EarlierDroppedUITests:4 EarlierDoubleAskUITests:2 EarlierDeleteShiftUITests:2"
  for t in testRebuiltListShowsTheNewestMessage testRebuiltShortChatShowsTheNewestMessage testRebuiltAfterTheKeyboardWentDown; do
    skip="$skip -skip-testing:KosmosUITests/KeyboardSlideUITests/$t"
  done
  # kosmos#8958: UnsentDraftUITests (3), the unsent draft's row on the UIKit list too. On its own line, as above.
  classes="$classes UnsentDraftUITests:3"
fi
# kosmos#8453: the UIKit arm in two halves, so each CI job (ios.yml "uikit list (sample board) 1/2" and "2/2") ends well
# inside its limit: the one job took 75 of its 80 minutes on PR #8447. 1/2 is the earlier-pages classes (their pages are
# held back 16 s each, the longest checks) and the two short 260-message ones; 2/2 is every other class. A class is in 2/2
# unless it is named here, so together the halves are always the whole list (ios.ui-sample-shard-8453.test.js checks it).
# Measured per class on main's run 42940677400, BEFORE #8443 doubled the earlier-pages classes' page delay: 1/2 about 27
# min, 2/2 about 26. 1/2 is the longer half now; move a class across if a run shows it near the job's limit.
earlier=" EarlierDroppedUITests EarlierDeleteShiftUITests EarlierPagesUITests EarlierDoubleAskUITests ChatSearchUITests ChatDragUITests StopAddingUITests "
if [ -n "$shard" ]; then
  [ "$uikit" = 1 ] || { echo "ui-sample: --shard is for the UIKit arm (--uikit) only" >&2; exit 2; }
  kept=""
  for c in $classes; do
    case "$earlier" in *" ${c%%:*} "*) half=1/2 ;; *) half=2/2 ;; esac
    [ "$half" = "$shard" ] && kept="$kept $c"
  done
  classes="${kept# }"
  [ -n "$classes" ] || { echo "FAIL  ui-sample: shard $shard holds no class" >&2; exit 1; }
fi
# UI_SAMPLE_PRINT_CLASSES=1: print the classes this run would take and stop (ios.ui-sample-shard-8453.test.js).
if [ "${UI_SAMPLE_PRINT_CLASSES:-}" = 1 ]; then printf '%s\n' $classes; exit 0; fi
# kosmos#8993: build for testing and stop. A generic simulator destination, so the products run on whichever simulator the
# test job makes. The products folder is replaced whole, so a half-written earlier one is never used.
if [ -n "$build_only" ]; then
  [ -z "$products$shard" ] && [ "$uikit" = 0 ] && [ "$keep" = 0 ] || { echo "ui-sample: --build-only takes no other option" >&2; exit 2; }
  # It replaces the folder whole, so only an empty one or a products folder this script made (it holds the marker
  # .ui-sample-products, written only here).
  if [ -e "$build_only" ] && [ -n "$(ls -A "$build_only" 2>/dev/null)" ] && [ ! -f "$build_only/.ui-sample-products" ]; then
    echo "ui-sample: $build_only is not empty and is not a products folder, so nothing was built into it" >&2; exit 2
  fi
  bwork="$(mktemp -d)"
  trap 'rm -rf "${bwork:?}"' EXIT
  trap 'exit 143' TERM; trap 'exit 130' INT HUP
  blog="$bwork/build.log"
  # ARCHS: this Mac's own architecture only, as `xcodebuild test` on one simulator built; a generic destination alone
  # builds every simulator architecture (measured: x86_64 and arm64), twice the work for a slice no simulator here runs.
  if ( cd "$here/.." && xcodebuild build-for-testing -project Kosmos.xcodeproj -scheme Kosmos -configuration Debug \
         -destination 'generic/platform=iOS Simulator' ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=NO -derivedDataPath "$bwork/dd" > "$blog" 2>&1 ); then
    rm -rf "${build_only:?}"; mkdir -p "$build_only" || { echo "FAIL  ui-sample build: could not make $build_only" >&2; exit 1; }
    : > "$build_only/.ui-sample-products"   # first, so a copy cut short can be built into again
    cp -R "$bwork/dd/Build/Products/." "$build_only/" || { echo "FAIL  ui-sample build: the products could not be copied" >&2; exit 1; }
    # The stamp --products compares: this Xcode, this Mac's architecture, and the commit built (named if it differs).
    { xcodebuild -version && uname -m; } > "$build_only/xcode-version" || { echo "FAIL  ui-sample build: no Xcode version" >&2; exit 1; }
    git -C "$here/.." rev-parse HEAD > "$build_only/built-from" 2>/dev/null || :
    run_file="$(find "$build_only" -maxdepth 1 -name '*.xctestrun' | head -1)"
    if [ -z "$run_file" ]; then echo "FAIL  ui-sample build: no .xctestrun in the products" >&2; exit 1; fi
    echo "PASS  ui-sample build: $(basename "$run_file"), $(head -1 "$build_only/xcode-version")"
    exit 0
  fi
  echo "FAIL  ui-sample build: xcodebuild build-for-testing failed; its last lines:" >&2
  tail -40 "$blog" >&2
  exit 1
fi
# kosmos#8993: products from this same Xcode (and architecture) are tested without building; anything else is built here.
run_file=""
if [ -n "$products" ] && [ -d "$products" ]; then products="$(cd "$products" && pwd)"; fi   # xcodebuild runs from ios/
if [ -n "$products" ]; then
  # Exactly one: a scheme with several test plans would leave one per plan, and taking the first found would be a guess.
  cands="$(find "$products" -maxdepth 1 -name '*.xctestrun' 2>/dev/null)"
  cand=""; [ "$(printf '%s\n' "$cands" | grep -c .)" = 1 ] && cand="$cands"
  if [ -z "$cand" ]; then
    echo "ui-sample: not exactly one built test run in $products, so the app is built here"
  elif [ "$(cat "$products/xcode-version" 2>/dev/null)" != "$({ xcodebuild -version && uname -m; } 2>/dev/null)" ]; then
    echo "${GITHUB_ACTIONS:+::warning::}ui-sample: the products were built by another Xcode or for another architecture ($(head -1 "$products/xcode-version" 2>/dev/null || echo unknown)), so the app is built here"
  elif built="$(cat "$products/built-from" 2>/dev/null)"; head_now="$(git -C "$here/.." rev-parse HEAD 2>/dev/null)"; \
       [ -z "$built" ] || [ -z "$head_now" ] || [ "$built" != "$head_now" ] || [ -n "$(git -C "$here/.." status --porcelain -- ios 2>/dev/null)" ]; then
    # Another commit, an unknown one, or uncommitted changes under ios/: testing those products could pass a change
    # they do not contain, so the app is built here. (CI never takes this: uibuild and the UI jobs share one commit.)
    echo "${GITHUB_ACTIONS:+::warning::}ui-sample: the products were not built from this checkout as it is (${built:0:10}), so the app is built here"
  else
    run_file="$cand"
  fi
fi
if [ "$(defaults read com.apple.iphonesimulator ConnectHardwareKeyboard 2>/dev/null)" = 1 ]; then
  echo "FAIL  ui-sample: the Simulator's hardware keyboard is on (ConnectHardwareKeyboard), which hides the on-screen keyboard" >&2
  exit 1
fi
work="$(mktemp -d)"
udid=""
cleanup() {
  [ -n "$udid" ] && { xcrun simctl shutdown "$udid" >/dev/null 2>&1; xcrun simctl delete "$udid" >/dev/null 2>&1; }
  if [ "$keep" = 1 ]; then echo "kept: $work"; else rm -rf "${work:?}"; fi
}
trap cleanup EXIT
trap 'exit 143' TERM; trap 'exit 130' INT HUP
# Review 1: the newest runtime the SELECTED Xcode can run (its simulator SDK), not merely the newest installed: a CI image
# carries several Xcodes, and a runtime newer than the selected one's SDK is refused as a destination.
sdk="$(xcrun --sdk iphonesimulator --show-sdk-version 2>/dev/null)"
[ -n "$sdk" ] || echo "ui-sample: no iOS simulator SDK found; the runtime is not capped" >&2
cap="$(printf '%s' "${sdk:-999}" | tr . -)"
runtime="$(xcrun simctl list runtimes available | sed -n 's/.*\(com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]*\).*/\1/p' \
  | sort -V | awk -v cap="$cap" '{ v = $0; sub(/.*iOS-/, "", v); if (cmp(v, cap) <= 0) last = $0 }
      function cmp(a, b,   x, y, i, n) { n = split(a, x, "-"); split(b, y, "-"); for (i = 1; i <= 3; i++) { if (x[i] + 0 < y[i] + 0) return -1; if (x[i] + 0 > y[i] + 0) return 1 } return 0 }
      END { print last }')"
[ -n "$runtime" ] || { echo "FAIL  ui-sample: no iOS simulator runtime at or below the iphonesimulator SDK ${sdk:-?}" >&2; exit 1; }
# The smallest current phone this Xcode knows: the "e" model if there is one, else the newest plain iPhone.
types="$(xcrun simctl list devicetypes | sed -n 's/.*(\(com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-[0-9]*e\{0,1\}\))$/\1/p' | sort -V)"
dtype="$(printf '%s\n' "$types" | grep -E 'iPhone-[0-9]+e$' | tail -1)"
[ -n "$dtype" ] || dtype="$(printf '%s\n' "$types" | grep -E 'iPhone-[0-9]+$' | tail -1)"
[ -n "$dtype" ] || { echo "FAIL  ui-sample: no iPhone simulator type found" >&2; exit 1; }
udid="$(xcrun simctl create "kosmos-ui-sample-$$" "$dtype" "$runtime")" || { echo "FAIL  ui-sample: no ${dtype##*.} simulator could be made on $runtime" >&2; exit 1; }
xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b >/dev/null || { echo "FAIL  ui-sample: the simulator did not boot" >&2; exit 1; }
echo "ui-sample: ${dtype##*.} on ${runtime##*.}, the $arm chat list"
only=""; want=0
for c in $classes; do only="$only -only-testing:KosmosUITests/${c%%:*}"; want=$((want + ${c##*:})); done
log="$work/xcodebuild.log"
# kosmos#8221 slice 14: on the UIKit run, a test that runs past 7 minutes is stopped (failed by xcodebuild; the tally never
# sees it, so it is named as TIMED OUT below, on a pass as well as a failure). With its retry
# (-retry-tests-on-failure) one hang costs up to 14 minutes, which still fits each half's 75 (kosmos#8453); two hangs may not.
allow=""
if [ "$uikit" = 1 ]; then allow="-test-timeouts-enabled YES -default-test-execution-time-allowance 420 -maximum-test-execution-time-allowance 420"; fi
# shellcheck disable=SC2086  # $only, $skip and $allow are lists of separate arguments
# kosmos#8993: the same test arguments either way; only how the app is had differs (built here, or the shared products).
if [ -n "$run_file" ]; then
  echo "ui-sample: testing the shared build ($(basename "$run_file"))"
  ( cd "$here/.." && TEST_RUNNER_KOSMOS_UI_PLUS=1 TEST_RUNNER_KOSMOS_UI_SAMPLE=1 TEST_RUNNER_KOSMOS_UIKITLIST="$uikit" xcodebuild test-without-building -xctestrun "$run_file" -destination "id=$udid" \
      -retry-tests-on-failure -test-iterations 2 $only $skip $allow -derivedDataPath "$work/dd" -resultBundlePath "$work/result.xcresult" > "$log" 2>&1 )
else
  ( cd "$here/.." && TEST_RUNNER_KOSMOS_UI_PLUS=1 TEST_RUNNER_KOSMOS_UI_SAMPLE=1 TEST_RUNNER_KOSMOS_UIKITLIST="$uikit" xcodebuild test -project Kosmos.xcodeproj -scheme Kosmos -destination "id=$udid" \
      -retry-tests-on-failure -test-iterations 2 $only $skip $allow -derivedDataPath "$work/dd" -resultBundlePath "$work/result.xcresult" > "$log" 2>&1 )
fi
rc=$?
# kosmos#8993: where the tested app is, for the failure notes below (they read its bundle id): the shared products, or
# the folder this run built into.
if [ -n "$run_file" ]; then appdir="$(dirname "$run_file")"; else appdir="$work/dd/Build/Products"; fi
# kosmos#7609: a failed test gets one more try, because this job runs on GitHub's slower runners and waits run out there. So a test
# counts once, by its last result, and one that failed then passed is FLAKY: named below, a warning on the run, and countable across runs.
tally="$("$here/ui-sample-tally.sh" "$log")"
ran="$(printf '%s\n' "$tally" | grep -c -E ' (passed|failed|skipped)$')"
skipped="$(printf '%s\n' "$tally" | grep -c ' skipped$')"   # #7654: a check that says it could not test here
failed="$(printf '%s\n' "$tally" | grep -c ' failed$')"
flaky="$(printf '%s\n' "$tally" | grep ' flaky$' | sed 's/ flaky$//')"
# kosmos#7609: on a red run too: each flake's first-try words, a warning on the run, and a test's own UI-NOTE lines (the log is deleted with the run).
flaky_report() {
  grep -h 'UI-NOTE' "$log" | sort -u | cut -c1-200
  [ -n "$flaky" ] || return 0
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::warning title=ui-sample::FLAKY, failed once: $(printf '%s' "$flaky" | paste -sd ' ' -)"
  printf '%s\n' "$flaky" | while IFS= read -r t; do
    echo "FLAKY $t: $(grep -m1 -F "error: -[KosmosUITests.${t%%.*} ${t##*.}]" "$log" | sed 's/.*\] : //' | cut -c1-200)"
  done
}
# kosmos#8221 slice 14: a test stopped at its time limit (--uikit) prints "exceeded execution time allowance", never "failed"
# (measured 11-10 06:59), so the tally does not count it, and one that then passed on its retry would read as a clean pass.
timedout="$(sed -n "s/^Test Case '-\[KosmosUITests\.\([A-Za-z0-9_]*\) \([A-Za-z0-9_]*\)\]' exceeded execution time allowance.*/\1.\2/p" "$log" | sort -u)"
timedout_report() {
  [ -n "$timedout" ] || return 0
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::warning title=ui-sample::TIMED OUT (stopped at the per-test limit): $(printf '%s' "$timedout" | paste -sd ' ' -)"
  printf '%s\n' "$timedout" | while IFS= read -r t; do
    last="$(printf '%s\n' "$tally" | grep -m1 -E "^${t//./\\.} (passed|failed|skipped|flaky)$" | awk '{print $2}')"
    echo "TIMED OUT $t (last result: ${last:-none})"
  done
}
# Review 1: each class must have run exactly its own number, so one class gaining a test cannot hide another skipping one.
short=""
for c in $classes; do
  n="$(printf '%s\n' "$tally" | grep -c -E "^${c%%:*}\.[A-Za-z0-9_]+ (passed|failed|skipped)$")"
  [ "$n" -eq "${c##*:}" ] || short="$short ${c%%:*}=$n/${c##*:}"
done
if [ "$rc" -eq 0 ] && [ "$ran" -eq "$want" ] && [ "$failed" -eq 0 ] && [ -z "$short" ]; then
  note=""; [ "$skipped" -gt 0 ] && note=" ($skipped of them SKIPPED: a skip tested nothing, named below)"
  # #7654: on GitHub Actions a skip is also an annotation on the run, so a green job that tested less is visible.
  [ "$skipped" -gt 0 ] && [ -n "${GITHUB_ACTIONS:-}" ] && echo "::warning title=ui-sample::$skipped UI check(s) SKIPPED (they tested nothing); named in this step's output"
  [ -n "$flaky" ] && note="$note ($(printf '%s\n' "$flaky" | wc -l | tr -d ' ') FLAKY: failed once, then did not, named below)"
  echo "PASS  ui-sample: $ran of $want UI checks passed on a fresh simulator$note"
  flaky_report
  timedout_report
  # kosmos#7348: name them and why, since the log is deleted with the run.
  sed -n 's/.*-\[KosmosUITests\.\([A-Za-z0-9_]* [A-Za-z0-9_]*\)\] : Test skipped - /SKIPPED \1: /p' "$log" | cut -c1-300
  exit 0
fi
# Only the words of tests that are still failing, once each: a test that passed on its retry is reported by flaky_report.
stillred="$(printf '%s\n' "$tally" | sed -n 's/ failed$//p')"
why=""
[ -n "$stillred" ] && why="$(sed -n 's/.*error: -\[KosmosUITests\.\([A-Za-z0-9_]*\) \([A-Za-z0-9_]*\)\] : /\1.\2: /p' "$log" | grep -F -f <(printf '%s\n' "$stillred" | sed 's/$/:/') | awk -F: '!seen[$1]++' | head -3)"
echo "FAIL  ui-sample: $ran of $want ran, $failed failed (xcodebuild exited $rc)${short:+; per class:$short}"
[ -n "$why" ] && printf '%s\n' "$why"
[ -n "$stillred" ] && printf '%s\n' "$stillred" | sed 's/^/STILLRED /'
timedout_report
flaky_report
# kosmos#7609: as ui-keyboard.sh does, the read-higher-up check's scroll trace, read from the app's own data container
# before cleanup deletes the simulator (--keep keeps the log, not the simulator). The bundle id is the built app's.
# #7690: and the long room's own read-higher-up check, which appends to the same file.
dm_check="KeyboardSlideUITests testReadHigherUpStaysWhereItWas"
room_check="RoomKeyboardUITests testRoomReadHigherUpStaysWhereItWas"
# kosmos#7645: and the room's newest-above-the-box check, which traces too since 11-04.
room_newest="RoomKeyboardUITests testRoomNewestStaysAboveTheBox"
room_drag="RoomKeyboardUITests testRoomReadHigherUpAfterADragStaysWhereItWas"
# kosmos#8221 slice 4: and the long chat's grow check, red on CI's UIKit arm only.
dm_grow="KeyboardSlideUITests testNewestStaysJustAboveTheBoxAsItGrowsAndShrinks"
if grep -q -E "^Test Case '-\[KosmosUITests\.($dm_check|$room_check|$room_newest|$room_drag|$dm_grow)\]' failed" "$log"; then
  app="$(find "$appdir" -maxdepth 2 -name Kosmos.app -type d 2>/dev/null | head -1)"
  bid="$([ -n "$app" ] && /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist" 2>/dev/null)"
  data="$([ -n "$bid" ] && xcrun simctl get_app_container "$udid" "$bid" data 2>/dev/null)"
  if [ -n "$data" ] && [ -s "$data/Documents/trace.txt" ]; then
    # Every check of the two keyboard classes, in the order the log has them, with its result (not all of them trace).
    order="$(grep -o -E "^Test Case '-\[KosmosUITests\.(KeyboardSlideUITests|RoomKeyboardUITests) [A-Za-z0-9_]+\]' (passed|failed|skipped)" "$log" \
      | sed -E "s/^.*\.([A-Za-z0-9_]+) ([A-Za-z0-9_]+)\]' (passed|failed|skipped)$/\1.\2 \3/" | paste -sd ',' - | sed 's/,/, /g')"
    lines="$(wc -l < "$data/Documents/trace.txt" | tr -d ' ')"
    # One file, appended by every traced launch (XCTest runs the classes in name order and each class's checks in name
    # order), so a tail can hold only the checks after the one that failed (#7645 review 1): always the whole file.
    echo "  the app's whole scroll trace, $lines lines, one file for every traced launch; keyboard checks in the order they ran: $order"
    sed 's/^/    /' "$data/Documents/trace.txt"
  else
    echo "  (no scroll trace from the app)"
  fi
fi
# kosmos#7767: a rebuild check's failure says what the check saw when it stopped waiting.
if grep -q -E "^Test Case '-\[KosmosUITests\.KeyboardSlideUITests testRebuilt[A-Za-z]*\]' failed" "$log"; then
  app="$(find "$appdir" -maxdepth 2 -name Kosmos.app -type d 2>/dev/null | head -1)"
  bid="$([ -n "$app" ] && /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist" 2>/dev/null)"
  data="$([ -n "$bid" ] && xcrun simctl get_app_container "$udid" "$bid" data 2>/dev/null)"
  if [ -n "$data" ] && [ -s "$data/Documents/trace.txt" ]; then
    said="$(grep -E 'debug rebuild|diag: empty' "$data/Documents/trace.txt" || true)"
    echo "  the rebuild hook's lines:"
    if [ -n "$said" ]; then printf '%s\n' "$said" | sed 's/^/    /'; else echo "    (none in the trace)"; fi
  else
    echo "  (no trace from the app for the rebuild check)"
  fi
fi
# kosmos#8221 slice 15: an earlier-pages check's failure says how each page ask ended (EarlierDroppedUITests' control
# went red 3 times in 10 on 11-10 with its first page "never landed", then passed 28 times in a row: never caught traced).
# A page that landed and was asked for again by itself (the top still reported showing) and a page that never came read
# the same on screen, so the lines that tell them apart: each ask, each way out of it, each restart, and the top edge.
if grep -q -E "^Test Case '-\[KosmosUITests\.(EarlierDroppedUITests|EarlierPagesUITests|EarlierDoubleAskUITests|EarlierDeleteShiftUITests) [A-Za-z0-9_]+\]' failed" "$log"; then
  app="$(find "$appdir" -maxdepth 2 -name Kosmos.app -type d 2>/dev/null | head -1)"
  bid="$([ -n "$app" ] && /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist" 2>/dev/null)"
  data="$([ -n "$bid" ] && xcrun simctl get_app_container "$udid" "$bid" data 2>/dev/null)"
  if [ -n "$data" ] && [ -s "$data/Documents/trace.txt" ]; then
    said="$(grep -E 'earlier (ask|out|answered|restart)|uikit list: atTop|uikit list: (rows landed above|earlier pages dropped)|debug delete on ask|earlier hold|chat (shown|back)' "$data/Documents/trace.txt" || true)"
    echo "  the earlier pages' lines (every traced launch, oldest first; a chat's first showing in a launch writes \"chat shown\", a later one \"chat back\"):"
    if [ -n "$said" ]; then printf '%s\n' "$said" | sed 's/^/    /'; else echo "    (none in the trace)"; fi
  else
    echo "  (no trace from the app for the earlier-pages check)"
  fi
fi
# kosmos#7609: CI's job sets this, so a red that does not repeat still leaves its result bundle to read.
if [ -n "${UI_SAMPLE_FAILED_RESULT:-}" ] && [ -d "$work/result.xcresult" ]; then
  cp -R "$work/result.xcresult" "$UI_SAMPLE_FAILED_RESULT" && echo "  result kept for CI: $UI_SAMPLE_FAILED_RESULT"
fi
[ "$keep" = 1 ] || echo "  (run again with --keep to keep the log and result)"
exit 1
