# kosmos#9254: a test browser asked the person for their login keychain password

## What the records say
- securityd, 20:54:39 and 20:54:40 CST: two denied requests for "Chromium Safe Storage" from
  ~/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app (two processes).
- The keychain item has existed since 2026-08-08, so a newer browser build (new code signature) asks again.
- Measured: a Playwright launch of that same app runs with --use-mock-keychain and --password-store=basic and makes no
  keychain request. Every installed Playwright puts both in its default switches.
- The launcher is not covered by any record we hold: no script on disk, no Claude/Codex/Gemini transcript, and the
  agent whose work was underway says it opened no browser.

## Call
A guard (browser-launch-keychain-9254.test.js) reads every launch site in the repo and refuses a launch that turns
Playwright's defaults off (ignoreDefaultArgs: true), drops a keychain switch, or runs a Chrome binary or app
(Contents/MacOS/..., open -a) without --use-mock-keychain. Every rule has a control; the repo scan is red with a bad
line planted in mobile-shots.js.

## Rejected
- Adding the flags by hand to each launch: Playwright already adds them, and a second copy would only drift.
- Asking the person what they opened (Splinter: do not ask Josh).

## Proposed fleet rule (on the card; Splinter takes it into the shared instructions)
Open a browser for a person only through Playwright, or with --use-mock-keychain --password-store=basic, and never
open the Chrome for Testing app directly.

## Weakest premise
That the launcher was a launch site in a repo this guard reads. The guard cannot see a hand-typed command or a tool
outside the repo, which is what the fleet rule is for.

## Review 1 (hardening, all reasonable)
- The repo root's tests and scripts are read too (not recursively; not the guard itself).
- ignoreDefaultArgs: the whole value is read (brackets counted, so multi-line and ternaries), and only a plain list of
  --hide-scrollbars / --enable-automation is allowed; a variable, a spread, true or a quoted key is refused.
  ignoreAllDefaultArgs is refused outright.
- A direct run: case-insensitive, open -a / open -b with a path or bundle id, and a spawn of chrome-headless-shell; the
  switch must be on the same call (that line or the next three), not anywhere in the file.
- The MCP config the repo writes (engine/agentbrowser.js configFor) is asserted: Playwright's chromium at the shell,
  isolated, no profile.
Residual, stated: a Chrome path built entirely from variables is not readable as text.

## Review 2
- ignoreDefaultArgs is safe ONLY as a literal list of safe switches, or a ternary between two such lists; every other
  appearance of the name (a variable arm, a call, shorthand, an assignment, a spread) is refused. Each clause has a
  control; the shape rule removed turns them red.
- The scan reads every tracked source file by git ls-files (.js/.mjs/.cjs/.ts/.sh/.py/.ps1/.swift and the
  extensionless scripts in bin/, install/, tools/), not a folder list.
- The header says what text cannot show: a Chrome path held only in a variable. The card's ask 3 (a launch without the
  flag raising the prompt) is deliberately not run: it would put the dialog in front of the person. The measured arm is
  the fixed one: the flags are on the process and securityd logs nothing.
- ignoreAllDefaultArgs: false is not refused.

## Review 3
A ternary must have both arms, and a value continues past a newline that starts ? : or . (Prettier style). Controls now hold every clause the review mutated (spawn/exec/Sync, org.chromium, Contents/MacOS/Chromium, ignoreAllDefaultArgs =, a safe value ended by ; or a newline). An escaped quote in open -a is read. osascript and a Chrome name held in a variable stay outside what text can show (stated in the header).

## Review 4
A file that only names the option (a comment, shorthand) is reported by name, never a crash; the argv form open, [-a, Chrome] is read; the header names the one direct run text cannot see (agentbrowser.js execP(exe, [--version])); the MCP config is asserted headless.

## Review 5
The header says the original launcher is not covered by any record we hold, so this guard keeps the repo safe and does not prove that launch fixed. open -a Chrome (the short name) is read.

## Review 6
The direct-run rule is scoped to TEST browsers (Chrome for Testing, Chromium, the headless shell): the person's own Chrome already has keychain access, and a mock keychain against their profile would lose their saved logins, so open -a "Google Chrome" <url> is allowed (controls). New arms: open of a .app path with no -a, path.join(..., Contents, MacOS, ...), spawn(chromium.executablePath()). The regex is split into named arms. The MCP-config test is dropped: engine/agentbrowser.test.js pins that config more fully.

## Review 7
open counts as a launch only with -a/-b or a /-rooted .app path, so prose naming Chromium is not flagged (controls). "Chrome for Testing" without Google is read. The header says a .py file is read for direct runs only.
