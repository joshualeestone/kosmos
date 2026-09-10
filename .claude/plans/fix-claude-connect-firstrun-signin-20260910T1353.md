# fix-claude-connect-firstrun-signin — Claude first-run Connect wedges (never opens the authorize browser)

## Definition of done (what is TRUE when finished)

An explicit Connect of the Claude (Anthropic) provider — first-run, add-another, OR reauth —
launches a REAL login (`claude auth login --claudeai`) so the authorize browser opens, and reports
"connected" only on real login-success evidence, never a stale local credential file. A machine
whose Claude credential is present-but-DEAD (the state the 2026-09-10 account migration created)
connects successfully instead of spinning on "Getting the sign-in ready..." forever with a
flash-then-revert. If the sign-in still stalls/bails for any reason, the UI surfaces an ACTIONABLE
error + retry rather than silently clearing the box. Fresh-machine Connect and OpenAI Connect are
unchanged. Regression tests assert the launch argv + strict completion for first-run, with a control
proving fresh-machine / OpenAI are untouched. Needs its own cut (NOT Baron's 0.6.55).

## Root cause (confirmed — my read + ICK + Josh's symptoms + connect.js's own comments)

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

## Fix — Option A (recommended; decide finally in implementation, document the weakest premise)

Treat an explicit Connect as "always run a real login, always require real success":

- **Launch (`connect.js:1985`)**: run `auth login --claudeai` for every explicit Connect launch, not
  just reauth. Cleanest: since every `launchSignin` path IS an explicit connect, push the login args
  unconditionally there (or gate on a new `owner.forceLogin` set true for first-run + add-another +
  reauth). #1937 already proved the driver's `classifyPane` walks `auth login --claudeai`
  (browser-open -> awaiting-code, no recognizer widening).
- **Completion (`connect.js:2117, 2216, 2469`)**: the `!owner.reauth || owner.sawLoginDone` gates let
  first-run report CONNECTED off a stale file (the flash). Broaden them so an explicit Connect also
  requires `owner.sawLoginDone` (real "Login successful" evidence) before reporting connected. Use
  the same broadened signal as the launch (`forceLogin`) so launch + completion stay consistent.
- **Weakest premise**: `claude auth login --claudeai` on a truly-FRESH machine (no credential at all)
  opens the browser correctly, rather than bare-claude onboarding doing something the driver needs.
  Mitigation: #1937's standing evidence + a fresh-machine control test (step 5). If a fresh-machine
  regression appears, fall back to **Option B**: detect a present-but-dead credential (the #1560 live
  `claude auth status` already distinguishes dead-from-live) and take the reauth-style path ONLY
  then, preserving bare-claude for genuinely fresh machines.

## Secondary (defense-in-depth — Mona's pinpoint)

The `signin-launching` timeout/bail must surface an ACTIONABLE error + retry, not silently clear the
box. Verify `becomeStuck`'s message actually reaches the UI (painters at `web/index.html` ~40414
`signin-launching` / ~40496 / ~17102-17103); if the painter clears the box on bail instead of showing
the stuck message + a "Try again", fix that so an unforeseen wedge is never a silent dead-end.

## Checklist

- [ ] **1.** Read `server.connect.test.js` (esp. the reauth test at :327): how it captures the tmux
      launch argv and drives `/api/connect/start` — the harness the regression test mirrors.
- [ ] **2.** Implement the launch-args change (`connect.js:1985`) so an explicit Connect runs
      `auth login --claudeai` (first-run + add-another + reauth). Keep the tmux argv multi-arg + bare
      (three elements `'auth','login','--claudeai'`), per the #1937 note.
- [ ] **3.** Implement the strict-completion change (`connect.js:2117, 2216, 2469`) so an explicit
      Connect requires `sawLoginDone` before reporting CONNECTED (kills the flash-then-revert).
- [ ] **4.** Verify/fix the bail-path painter surfaces an actionable error + retry (secondary).
- [ ] **5.** Regression test in `server.connect.test.js` (mirror the reauth harness): first-run
      Connect (`reauth:false`) against a present-but-dead credential (a) pushes `auth login
      --claudeai` in the launch argv and (b) requires login-success before reporting connected.
      CONTROL arms: a fresh machine (no credential) still opens the browser, and the OpenAI path is
      unchanged — so the fix is scoped, not a blanket behavior swap.
- [ ] **6.** Run the full node suite (`bash tools/run-tests.sh`, assert the test count, not just exit
      0) + confirm `docs/browser-checks/live-connect.js` still passes / is unaffected (it sets
      `AGENT_WORKFORCE_CLAUDE_CONFIG_DIR` -> assignment branch, so it may not exercise the login arm).
- [ ] **7.** `/challenge-loop` to convergence (this is a prod-auth change to a heavily-commented
      driver — the loop is critical), then PR: reviewer `joshualeestone` only, squash, merge on green.
      Flag in the PR that it needs its own cut (not 0.6.55). No em dashes anywhere.

## Notes

- Operator-confirmed reproduction (Josh, live on the Mortals box); not Playwright-reproducible (a
  local-CLI/environment wedge). Verify the fix by re-testing on Mortals after the cut (Josh offered).
- Beta merge-on-green; personal/Kosmos reviewer `joshualeestone` only.
