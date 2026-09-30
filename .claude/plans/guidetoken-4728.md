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

So, for the `kosmos` command's read of `board.token` in the data folder:

| guide | refused? | source |
|---|---|---|
| Claude, macOS | yes | measured (arm B) |
| Claude, Windows or Linux | no | read from code: the sandbox block is written on `darwin` only. Arm A has that shape but ran on a Mac. Not measured on Windows or Linux. |
| Codex, Gemini, Grok | no | read from code, not measured: the settings file IS written for every guide (`create.js` calls `guardGuideFolder` for the `setup` role with no provider check), but only Claude Code reads it. |

**This is narrower than "the Mac guide cannot get the board token"** (review round 1). The deny rules name
the data folder only. Two other places can hold the same token and are not named: the older data folder
(`boardauth.legacyTokenPath`; boardauth.js records that a box which ran the old mirror may still hold a valid
token there), and a browser's copy of the board's cookie (`boardauth.cookieHeader`, 400 days). Neither was
measured. So the comments no longer call the Mac guide's state a boundary at all: they state the one measured
refusal and what the rules do not cover. Both go on the card as part of the open gap.

The sentence that is false on main is in `engine/setup-assistant.js` above `guideDenyRules` ("the `kosmos`
command it runs reads the board token as its own process", with nothing about the sandbox): it predates the
sandbox added in #3769's review, and the same file says the opposite 60 lines lower. The same comment's "a
Codex, Gemini or Grok guide has no such file" is also not what the code does, and is corrected.

## The change (comments only, no behaviour)
- `engine/setup-assistant.js`: replace the stale sentence with the three rows (each marked measured or not),
  what the rules do not name, and the corrected "Claude only" line.
- `engine/team.js`, above `vetAgentMember`: the guide rule is a cooperative guard; the one measured exception
  (the Mac Claude guide cannot read the data folder) is named, not called a boundary. Points at that comment.
- `install/kosmos`, the reply verb (#3769), and the header of `cli.reply-token-3769.test.js`: the same scope.
- NOT touched: `server.js` (the comment above the agent-token routes) and
  `server.agent-token-gate-4491.test.js`, which both say "an agent that cannot read the board token (the
  sandboxed setup guide)". Decided, review round 2: that sentence is true as written. It names an agent that
  cannot read the token, and one exists (the measured row); the rule it explains (the public feed needs the
  board token as well) does not depend on how many guides are sandboxed. Both sit beside lines Angel's open
  #4491 slice 4 branch changes, so an edit there buys a conflict for no correction.
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
