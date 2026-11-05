# sandboxlogin-8050: a browser check's board never reads this Mac's real keychain

Card: kosmos#8050. Owner: Ice Cream Kitty. Started 2026-11-05 12:5x CST, during the 0.7.92 cut's hold.

## Why
render-accounts-openai's "every box says Signed in" read the login date of whoever is really signed in on the Mac running
it, through the default Claude row. That stopped the 0.7.92 cut after 106 minutes for a reason unrelated to the code.

## What changes
- `engine/loginexpiry.js`: with KOSMOS_BC_LOGIN_UNTIL_MS set, the bare entry answers that date and every other entry
  answers nothing, and `security` is not run. A value that is not a number answers nothing.
- `tools/browser-checks.sh`: exports it beside the other no-board-may switches, so it covers every board the script boots.

## Decisions (mine, reversible in a commit)
- **The seam sits in the two keychain readers,** the only places the engine runs `security`, read 11-05 by grep. So the
  card's question about other sandboxes has one answer: this covers them all. Rejected: a seam in claudeloginlive only,
  which leaves the status snapshot's read.
- **A fixed date, 2100-01-01,** so a page or a screenshot cannot change with the calendar.
- **Other accounts answer nothing,** as they do now: their entries are named from a sandbox path, so none exists.
- The checks that test dates inject their own (render-claude-login-green-3997 uses setReaderForTests, the other two stub
  /api/accounts), so this takes nothing from them. Read, not run.

## Weakest premise
That a production board never has this variable. It is named for the browser checks and set nowhere else; a board that
had it would show a false "Signed in" date. It would still need `claude auth status` to say signed in.

## Steps
1. The seam, the export, engine/loginexpiry-sandbox-8050.test.js.
2. Review, then validation after the 0.7.92 cut (Mortals stays quiet until then).
3. Seen working: render-accounts-openai green with a board that cannot read the keychain. It lands with the next cut.
