# kosmos#1957: `kosmos open` was silence-plus-exit-0

## The defect
`kosmos open` with no argument produced no output and exited 0 (measured by lilsheila on a
Kosmos-only Mac, 0.6.22). `cmd_open` ran `exec /usr/bin/open "$URL"`, and `/usr/bin/open`
prints nothing on success; on a Mac with no display it exits 0 while nothing visibly opens.
From the CLI a working open and a broken one were indistinguishable, which is the one response
that teaches the user nothing and costs support time ("I ran kosmos open and nothing happened").

## The fix (install/kosmos, cmd_open)
1. **Say what it is doing, with the URL.** `say "Opening the dashboard at $URL ... If it does not
   open, go there yourself."` A person with no browser now has the URL and knows it tried.
2. **Check the opener's result instead of exec-ing it.** `"${KOSMOS_OPEN_BIN:-/usr/bin/open}"
   "$_open_url" || die "Could not open a browser. Go to the dashboard yourself: $URL"`. A real
   failure is now named with a non-zero exit, not swallowed. `exec` could not report a failure at
   all; a plain call can. `KOSMOS_OPEN_BIN` is a test seam so the opener can be stubbed.
3. The message shows the plain `$URL` (not the token URL) so a token never lands in a person's
   view or a support log; the actual open still uses the #1946 token URL when the board enforces.

## Also fixed: a latent #1946 set -e abort
The #1946 line `local _bt; _bt="$(board_token)"` aborts under the script's `set -euo pipefail`
when `board_token` returns non-zero, which it does on a NON-ENFORCING board (no board.token) --
so `kosmos open` on a non-enforcing board was itself exit-1-with-no-output, contradicting the
comment's "Empty on a non-enforcing board -> plain URL, unchanged." (A combined `local x=$(...)`
masks the failure because `local` returns 0; the separate form does not.) Changed to
`_bt="$(board_token || true)"` so it degrades to the plain URL as the comment intends.

## Test: cli.open-1957.test.js
A fake board (page body contains "Kosmos") so `healthy()` passes and `cmd_open` skips `cmd_start`,
plus a stub opener via `KOSMOS_OPEN_BIN`, so nothing real launches. Three arms:
- success: announces the dashboard URL, exits 0, the opener was handed the board URL;
- failure: names the failure, gives the URL, exits non-zero;
- CONTROL: neither arm reproduces silence-plus-exit-0 (the reported defect).

## Verification
- Full node suite green: 3974 tests, 3974 pass, 0 fail; new test 3/3.
- Red-capable: reverting cmd_open to origin/main (git checkout) fails arms 1 and 2.
- Bash 3.2 / macOS target; set -euo pipefail respected.

## Not done here (needs a screen, out of scope for the CLI fix)
Whether a browser tab actually appears on a machine WITH a display is unmeasured (the reporter has
no screen). The CLI-observable defect -- silence plus exit 0 -- is what this closes; a visual
confirmation on a display is a separate check.
