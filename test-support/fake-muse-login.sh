#!/bin/bash
# #3939 slice 3: a stand-in for `muse login` (Muse Code 1.4.0's device-code sign-in), for
# engine/musesignin.test.js. It prints the screens Homer captured on card #3939 in the same words,
# logs what it was sent to $FAKE_MUSE_LOG, and never contacts anything.
#
# FAKE_MUSE_FLOW: "normal" (default), "expire" (the first code expires, r then Enter gets a second),
# "unsaved" (approved but saving failed), "strange" (a screen Kosmos does not know), "quit" (exits early),
# "slowretry" (like expire, but the new code takes 3 s to arrive), "deaf" (the first Enter is not taken).
# Like the real CLI it EXITS after "Logged in." and after a failed save. Timeouts are whole seconds: macOS
# /bin/bash is 3.2, which refuses a fractional read -t.
LOG="${FAKE_MUSE_LOG:-/dev/null}"
say() { printf '%s\n' "$*" >> "$LOG"; }
key() { local k; IFS= read -rsn1 k; [ -z "$k" ] && printf 'Enter' || printf '%s' "$k"; }
say "args:$*"
say "env:${MUSE_LOGIN:-}|${MUSE_NO_AUTO_UPDATE:-}|${MUSE_NO_MODIFY_PATH:-}"
say "home:$HOME"
say "xdg:${XDG_CONFIG_HOME:-unset}"
FLOW="${FAKE_MUSE_FLOW:-normal}"
prompt() {
  printf 'To sign in, open https://auth.meta.com/device?user_code=%s\nand enter the code: %s\nPress Enter to open it in your browser: ' "$1" "$1"
  k=$(key); say "press:$k"
  if [ "$FLOW" = "deaf" ] && [ -z "$DEAF_DONE" ]; then DEAF_DONE=1; k=$(key); say "press-again:$k"; fi
  # Slow to redraw, as a real program can be; any key sent meanwhile is logged as stray.
  sleep 1
  while IFS= read -rsn1 -t 1 x; do say "stray:${x:-Enter}"; done
  printf '\nOpening your browser...\nWaiting for approval... Esc cancel\n'
}
if [ "$FLOW" = "strange" ]; then printf 'Something new that no screen in Kosmos knows about.\n'; sleep 120; exit 0; fi
if [ "$FLOW" = "quit" ]; then printf 'Starting...\n'; sleep 1; exit 1; fi
prompt WXYZ-1234
if [ "$FLOW" = "expire" ] || [ "$FLOW" = "slowretry" ]; then
  sleep 1
  printf 'The login request expired before it was approved. Press r then Enter to try again\n'
  k=$(key); say "retry:$k"; k=$(key); say "retry2:$k"
  [ "$FLOW" = "slowretry" ] && sleep 3
  prompt QRST-5678
fi
sleep 1
if [ "$FLOW" = "unsaved" ]; then printf 'login succeeded but saving failed: failed to write credential file\n'; exit 1; fi
printf 'Logged in. Credential saved.\nModel API access verified.\n'
say "done"
exit 0
