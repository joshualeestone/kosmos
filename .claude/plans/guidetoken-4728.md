# guidetoken-4728: say where the setup guide can and cannot read the board token

Card: kosmos#4728 (found by Angel while building #4491 slice 4). Branch `guidetoken-4728`, off origin/main e17db79f7.

## The finding, as corrected by measurement
The card says three comments are wrong to say the guide cannot read the board token. Its measurement used a
project with only the Read deny rule. The guide's folder gets more than that: on macOS
`engine/setup-assistant.js` `guardGuideFolder` also writes a `sandbox` block (`enabled: true`,
`allowUnsandboxedCommands: false`), which applies the deny paths to every subprocess.

Measured 2026-09-30 09:32 CDT, Claude Code 2.1.285, two throwaway folders written by the real
`guardGuideFolder` from e17db79f7, a canary `board.token` in a stand-in data folder, a script that reads the
file itself, `claude -p --dangerously-skip-permissions` told to run `bash reader.sh`:

| arm | settings | result |
|---|---|---|
| A (control) | the guards with the `sandbox` block deleted | printed the canary (Angel's result, reproduced) |
| B | the guards as written on a Mac | `Operation not permitted`, exit 1 (run twice) |

So:

| guide | can a command it runs read the board token? | source |
|---|---|---|
| Claude, macOS | no | measured (arm B) |
| Claude, Windows or Linux | yes | the sandbox block is written on `darwin` only (code); arm A is that shape |
| Codex, Gemini, Grok | yes | no settings file at all (code, setup-assistant.js) |

The sentence that is false on main is in `engine/setup-assistant.js` above `guideDenyRules` ("the `kosmos`
command it runs reads the board token as its own process"): it predates the sandbox added in #3769's review,
and the same file says the opposite 60 lines lower. The three comments the card names are right for the first
row and too broad for the other two.

## The change (comments only, no behaviour)
- `engine/setup-assistant.js`: replace the stale sentence with the three-row table and the rule that follows
  from it (only the first row is a boundary; code that must hold for every guide cannot count on it).
- `engine/team.js`, above `vetAgentMember`: the guide rule is a real boundary only for a Claude guide on macOS,
  a cooperative guard for every other guide and agent. Points at the table.
- `install/kosmos`, the reply verb (#3769), and the header of `cli.reply-token-3769.test.js`: the same scope.
- NOT touched: `server.js` and `server.agent-token-gate-4491.test.js` (Angel's #4491 slice 4 branch rewrites
  those comments; told her by message and on the card that her new wording needs the same correction), and the
  lines of `install/kosmos` her branch changes (2560 and below; mine is at 1557).
- No rule changes: `fromGuide` and `vetAgentMember` stay as they are.

## Decisions
- **Call:** correct the comments to the measured scope. **Rejected:** (1) my own first call on the card, "the
  rule does not hold", which rested on the measurement without the sandbox; (2) leaving the broad sentence,
  since a Windows or Codex guide is where it would be trusted wrongly; (3) a test that runs a real sandboxed
  session in CI: it needs a signed-in Claude Code and costs a model call per run. The existing
  `server.guide-secrets-3769.test.js` already pins that the block is written on darwin and not on win32.
- **Weakest premise:** that Claude Code turns a Read deny rule into an operating-system deny inside its
  sandbox on every version people run. True on 2.1.285.
- **Not measured:** the `dangerouslyDisableSandbox` retry (the nested session declined to try; #3769 records
  it), the real `kosmos` command in a real guide session, and the two "yes" rows (read from code).

## Tests
Comment-only. Ran the non-server tests for the touched files (team, team.newrole-4474, setup-assistant.*,
cli.reply-token-3769, guidestate, hostedguide): 117 tests, 117 pass, exit 0. `bash -n install/kosmos` and
`node --check` on both engine files pass. Full suite: PR CI.
