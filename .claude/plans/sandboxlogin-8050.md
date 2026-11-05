# sandboxlogin-8050: a browser check's board never reads this Mac's real keychain

Card: kosmos#8050. Owner: Ice Cream Kitty. Started 2026-11-05 12:5x CST, during the 0.7.92 cut's hold.

## Why
render-accounts-openai's "every box says Signed in" read the login date of whoever is really signed in on the Mac running
it, through the default Claude row. That stopped the 0.7.92 cut after 106 minutes for a reason unrelated to the code.

## What changes
- `engine/loginexpiry.js`: with KOSMOS_BC_LOGIN_UNTIL_MS set, the bare entry answers that date and every other entry
  answers nothing, and `security` is not run. A value that is not a whole number, or a board with no sandbox home, answers
  nothing.
- `tools/browser-checks.sh`: exports it beside the other no-board-may switches, so it covers every board the script boots.

## Decisions (mine, reversible in a commit)
- **The seam sits in the two keychain readers,** the only places the engine runs `security`, read 11-05 by grep, and every
  board browser-checks.sh boots has the variable. Rejected: a seam in claudeloginlive only, which leaves the status
  snapshot's read.
- **A fixed date, noon UTC on 2100-01-01,** so a page or a screenshot cannot change with the calendar, or with the
  timezones the fleet's Macs are in.
- **Other accounts answer nothing,** as they do now: their entries are named from a sandbox path, so none exists.
- The checks that test dates inject their own (render-claude-login-green-3997 uses setReaderForTests, the other two stub
  /api/accounts), so this takes nothing from them. Read, not run.

## What this does not cover
- A board that runs the host's real `claude`: `claude auth status` reads the login itself. sb4, the board that failed,
  has a fake one, so this card's failure is closed. Other boards have no pinned binary, but the engine looks for `claude`
  under the sandbox home (runners.resolveBin), where none is seeded, so they should not reach the host's. Read, not run.
- Boards started outside this script: tools/test-install.sh and the other tools/test-*.sh harnesses, mobile-shots.js run
  alone, and a check run by hand. I know of none that has failed this way; add the export where one does.

## Weakest premise
That every board this script boots has a sandbox home, which the seam now also requires. The script sets one for the run
(read, not run). A board without it reads no date, which an existing check would show. Asked of a real board, the variable
then does nothing false: production has no sandbox home, so a leak gives no date, not a made-up one.

## Steps
1. The seam, the export, engine/loginexpiry-sandbox-8050.test.js.
2. Review, then validation after the 0.7.92 cut (Mortals stays quiet until then).
3. Seen working, after the cut: "render-accounts-openai green" alone proves nothing, because it also passes without this
   on a Mac with a fresh login. So run sb4 with a fake `security` on PATH answering a past date: red on "Login expired"
   with the variable unset, green with it set. Then it lands with the next cut.
