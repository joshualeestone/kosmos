# grok-comes-up-3953: a running Grok agent on a Mac is seen as running

Card: joshualeestone/kosmos#3953. Josh, 0.6.96, 2026-09-26 08:07: his first Grok agent ("elon"), right after his
first Grok subscription sign-in, ended on "Elon has not come up / nothing is running under that name yet".

## Measured (this Mac, grok 1.0.41)
- The exact pane line the supervisor runs (`env -u XAI_API_KEY grok --permission-mode bypassPermissions
  --always-approve --trust -m grok-4.6`, GROK_HOME set) comes up and STAYS up in a real tmux pane, both on a real
  subscription sign-in (the Grok prompt) and on an empty home (the device sign-in screen). So grok itself is fine.
- tmux reports that pane's command as `grok-native`, launched through the npm symlink AND directly. The managed Mac
  install is a `grok` symlink to `pkg/bin/grok-native` (runners.js), and tmux names a pane after the target.

## Root cause (two halves, both in engine/status.js)
1. `isAgentSession` allowed Claude, Codex and Antigravity commands only, so a `grok-native` pane was never a running
   agent session.
2. `classify` ran the Claude running check on it, which called it STOPPED ("Claude is not running for this one").
The create screen's `boardCanSeeIt` needs isAgentSession true and state not stopped, so it waited 30 seconds and gave up.
The #3391 comments and a chat fixture said grok "fronts as node"; that premise was never measured and is wrong.

## Fix
- `isGrokCommand`: `grok-native`, `grok`, `grok.exe` (strict literals, like `isCodexCommand`). Used in
  `isAgentSession`, the named-running rank, and the Claude-login-advisory exclusion.
- `classify`: a Grok pane (runner tag or command) whose command is not grok is STOPPED "Grok is not running for this
  one"; a running one skips the Claude running check and goes on to the existing screen read.
- The false "fronts as node" comment is removed; the chat fixture uses `grok-native`.

- Third copy of the rule: `bin/agent-supervisor.sh`'s live-agent allowlist had no Grok names either, so any
  supervisor re-run against a live Grok agent killed it as crashed (review iteration 2). Grok names added;
  `supervisor.adopt-grok-3953.test.js` runs the real script over every name isGrokCommand accepts, with a crashed
  control. The snapshot's isGrokPane and the card's `runner` also fall back to the command, as agy's do.

## Decided
- Keep the screen read for a running Grok pane rather than returning UNKNOWN (as Antigravity does): the chat tests
  rely on an idle Grok pane, and Grok's own reports (grok-report-bridge) override the screen anyway.
- Membership is unchanged: an unclaimed `grok-native` pane is never ours (isFleetSession gates first).
- The 30-second creation wait is not changed; with the fix a Grok agent is seen within a poll or two.

## Rejected
- Keying "running" on the `@kosmos_runner` tag: it survives a crash back to a shell (#2192's reasoning).

## Weakest premise
- That Josh's grok stayed up. If it did not, the screen still says "has not come up", but the board now says
  "Grok is not running for this one" instead of blaming Claude. Only a served build on a Mac with a Grok sign-in shows it.

- Grok screens now reach the Claude screen read for the first time. Two real grok 1.0.41 screens (idle prompt,
  device sign-in) classify unknown, not stopped / auth_failed / needs_you, and a test pins that; other Grok screens
  (a rate limit, an error) have not been captured.

## Checks
- engine/status.test.js #3953 (isAgentSession both names, crashed, stray, rank); server.test.js #3953 (a real
  /api/status card through the page's boardCanSeeIt, with a crashed control). Each half perturbed: red.
