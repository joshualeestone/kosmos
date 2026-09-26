#!/bin/bash
# #3998: a stand-in for agy's interactive sign-in, for engine/agysignin.test.js. It prints the same
# screens, in the same words, as agy 1.2.11 did on Josh's Mac (2026-09-26), reads keys the way a
# menu does, and writes what it was sent to $FAKE_AGY_LOG so a test can check it. It never contacts
# anything.
#
# FAKE_AGY_FLOW picks a variant: "normal" (default), "strange" (an unknown screen after the menu).
LOG="${FAKE_AGY_LOG:-/dev/null}"
say() { printf '%s\n' "$*" >> "$LOG"; }
clear_screen() { printf '\033[2J\033[H'; }
key() {
  local k rest
  IFS= read -rsn1 k
  if [ "$k" = $'\033' ]; then IFS= read -rsn2 -t 1 rest; k="ESC$rest"; fi
  case "$k" in
    '') printf 'Enter' ;;
    ' ') printf 'Space' ;;
    'ESC[B') printf 'Down' ;;
    'ESC[A') printf 'Up' ;;
    *) printf '%s' "$k" ;;
  esac
}

clear_screen
printf 'Welcome to the Antigravity CLI. You are currently not signed in.\n\nSelect login method:\n> 1. Google OAuth\n  2. Use a Google Cloud project\n\n  up/down Navigate - enter Select\n'
k=$(key); say "menu:$k"
[ "$k" = "Enter" ] || exit 2

if [ "${FAKE_AGY_FLOW:-normal}" = "strange" ]; then
  clear_screen; printf 'Something new that no screen in Kosmos knows about.\n'; sleep 120; exit 0
fi

clear_screen
printf 'Your browser should open automatically. If not:\n\nhttps://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=fake&state=abc\n\nPaste the authorization code:\n'
IFS= read -r code; say "code:$code"

clear_screen
printf 'Choose your color scheme\n> terminal\n  light\n  dark\n'
k=$(key); say "theme:$k"

# Terms: three items, the cursor starts on Previous. Space on the box would tick it.
items=("[ ] Yes, I agree to help improve Antigravity CLI by allowing Google to collect and use my Interactions data" "Previous" "[Done]")
cur=1; ticked=0
draw_terms() {
  clear_screen
  printf 'Terms of Service & Data Use\n\nAI coding agents are known to have certain security risks.\n\n'
  for i in 0 1 2; do
    local label="${items[$i]}"
    [ "$i" = 0 ] && [ "$ticked" = 1 ] && label="${label/\[ \]/[x]}"
    if [ "$i" = "$cur" ]; then printf '> %s\n' "$label"; else printf '  %s\n' "$label"; fi
  done
}
draw_terms
while :; do
  k=$(key); say "terms:$k"
  case "$k" in
    Down) [ $cur -lt 2 ] && cur=$((cur + 1)) ;;
    Up) [ $cur -gt 0 ] && cur=$((cur - 1)) ;;
    Space) [ $cur = 0 ] && ticked=$((1 - ticked)) ;;
    Enter) [ $cur = 2 ] && break; [ $cur = 1 ] && { say "terms:went-back"; exit 3; } ;;
  esac
  draw_terms
done
say "datashare:$ticked"

clear_screen
printf 'Accessing workspace:\n\n%s\n\nDo you trust the contents of this project?\n\n> Yes, I trust this folder\n  No, exit\n' "${FAKE_AGY_TRUST_DIR:-$PWD}"
k=$(key); say "trust:$k"

clear_screen
printf 'joshua@example.com (Antigravity Starter Quota) - Gemini 3.8 Flash (High)\n> \n'
say "ready"
sleep 600
