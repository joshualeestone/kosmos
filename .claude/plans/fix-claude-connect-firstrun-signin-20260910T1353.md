# fix-claude-connect-firstrun-signin -- Claude first-run Connect wedges (never opens the authorize browser)

## Definition of done (what is TRUE when finished)

An explicit Connect of the Claude (Anthropic) provider -- first-run, add-another, OR reauth --
launches a REAL login (`claude auth login --claudeai`) so the authorize browser opens, and reports
"connected" only on real login-success evidence, never a stale local credential file. A machine
whose Claude credential is present-but-DEAD (the state the 2026-09-10 account migration created)
connects successfully instead of spinning on "Getting the sign-in ready..." forever with a
flash-then-revert. If the sign-in still stalls/bails for any reason, the UI surfaces an ACTIONABLE
error + retry rather than silently clearing the box. Fresh-machine Connect and OpenAI Connect are
unchanged. Regression tests assert the launch argv + strict completion for first-run, with a control
proving fresh-machine / OpenAI are untouched. Needs its own cut (NOT Baron's 0.6.55).

## Root cause (confirmed -- my read + ICK + Josh's symptoms + connect.js's own comments)

- `engine/connect.js:1985` `if (owner.reauth) cmd.push('auth','login','--claudeai')` gates the #1937
  real-login args to REAUTH ONLY. `reauth` = `opts.reauth` (line 966), so first-run / add-another
  Connect launches a BARE `claude`.
- Against a present-but-dead credential, bare `claude` drops into the REPL ("Not logged in - run
  /login"), never prints "Opening browser to sign in...", so the driver never reaches
  `signin-browser-open` and times out to stuck. The #1937 comment (1981-1984) deliberately left
  first-run bare on the assumption it runs on "a machine with no credential"; the migration broke
  that by stranding a dead credential.
- The "flash a checkbox then revert" is the #1560 early-exit at `connect.js:1009`
  (`if (sub.state === CONNECTED && !reauth)`) briefly reading the stale file as CONNECTED before its
  live `claude auth status` check reverts it, then falling into the bare-claude launch that wedges.

## Fix -- Option B was IMPLEMENTED (Option A rejected as too broad)

Option A ("force `auth login --claudeai` for EVERY explicit Connect, incl. add-another and a
genuinely fresh machine") was considered and REJECTED: it would change the fresh-machine and
add-another launch, whose bare-`claude` onboarding the #1937 comment deliberately protects, for no
benefit (those paths have no dead credential to repair). The narrower **Option B** was built and is
what ships:

- **Detect the present-but-dead credential (`connect.js`, the #1560 fall-through)**: set
  `deadCredential = true` only when the file said CONNECTED but the live `claude auth status`
  returns NONE. A genuinely fresh machine has `check()` return NONE, so this block is never entered
  and `deadCredential` stays false -- that is what keeps a fresh machine on the bare path.
- **One signal, five sites**: `owner.needsLogin = reauth || deadCredential`. It drives the launch
  (appends `auth login --claudeai`), the post-install binary-just-installed finish gate, and the
  three in-flow completion gates (each requires `owner.sawLoginDone` before reporting connected,
  killing the false-CONNECTED flash). All five moved together to `needsLogin`, so none is left on the
  old `owner.reauth`.
- **#1922 (added during the fix)**: the tickBody capture-fail path re-checks `subscription.checkLive`
  before declaring "the sign-in window closed" -- a session that closed after the login persisted
  (auth-login writes then exits, closing the pane) now reports connected. `checkLive` is implemented
  identically to a terminal `claude auth status`, so the only cross-process difference is the macOS
  Keychain responsible-process; a Kosmos-driven login writes a token Kosmos can read.
- **Scoping proof**: a genuinely fresh machine (no credential) still launches a bare `claude` -- pinned
  by the `#2645 CONTROL` in server.connect.test.js (asserts NO `auth login --claudeai`), the
  non-vacuous counterpart to the present-but-dead test.

## Secondary (defense-in-depth -- Mona's pinpoint)

The `signin-launching` timeout/bail must surface an ACTIONABLE error + retry, not silently clear the
box. Verify `becomeStuck`'s message actually reaches the UI (painters at `web/index.html` ~40414
`signin-launching` / ~40496 / ~17102-17103); if the painter clears the box on bail instead of showing
the stuck message + a "Try again", fix that so an unforeseen wedge is never a silent dead-end.

## Checklist

- [x] **1.** Read `server.connect.test.js` (esp. the reauth test at :327): how it captures the tmux
      launch argv and drives `/api/connect/start` -- the harness the regression test mirrors.
- [x] **2.** Implement the launch-args change (`connect.js:1985`) so an explicit Connect runs
      `auth login --claudeai` (first-run + add-another + reauth). Keep the tmux argv multi-arg + bare
      (three elements `'auth','login','--claudeai'`), per the #1937 note.
- [x] **3.** Implement the strict-completion change (`connect.js:2117, 2216, 2469`) so an explicit
      Connect requires `sawLoginDone` before reporting CONNECTED (kills the flash-then-revert).
- [x] **4.** Verify/fix the bail-path painter surfaces an actionable error + retry (secondary).
      VERIFIED ALREADY SATISFIED, no code change: the `stuck`-phase painter in web/index.html
      (~40564+) already renders `becomeStuck`'s `because` + `tail` plus a "Try again"
      affordance, so a bail is not a silent clear. (Also, the #1922 fix reduces how often the
      bail fires at all -- a session that closed after a completed login now reports connected
      rather than bailing.) web/index.html is intentionally untouched by this branch.
- [x] **5.** Regression test in `server.connect.test.js` (mirror the reauth harness): first-run
      Connect (`reauth:false`) against a present-but-dead credential (a) pushes `auth login
      --claudeai` in the launch argv and (b) requires login-success before reporting connected.
      CONTROL arms: a fresh machine (no credential) still opens the browser, and the OpenAI path is
      unchanged -- so the fix is scoped, not a blanket behavior swap.
- [x] **6.** Run the full node suite (`bash tools/run-tests.sh`, assert the test count, not just exit
      0) + confirm `docs/browser-checks/live-connect.js` still passes / is unaffected (it sets
      `AGENT_WORKFORCE_CLAUDE_CONFIG_DIR` -> assignment branch, so it may not exercise the login arm).
- [ ] **7.** `/challenge-loop` to convergence (this is a prod-auth change to a heavily-commented
      driver -- the loop is critical), then PR: reviewer `joshualeestone` only, squash, merge on green.
      Flag in the PR that it needs its own cut (not 0.6.55). No em dashes anywhere.

## Notes

- Operator-confirmed reproduction (Josh, live on the Mortals box); not Playwright-reproducible (a
  local-CLI/environment wedge). Verify the fix by re-testing on Mortals after the cut (Josh offered).
- Beta merge-on-green; personal/Kosmos reviewer `joshualeestone` only.
