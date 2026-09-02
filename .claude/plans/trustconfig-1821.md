# #1821: isolate a QA walk's trust write from the operator's real ~/.claude.json

Follow-up split out of #1780 (Splinter's steer). NOT a regression and NOT urgent
for the morning install. This is the residual against #1780's broader line: a QA
walk must not be able to reconfigure the live fleet.

## The gap

`engine/trust.js` writes trust flags (`hasTrustDialogAccepted`, `projects[...]`)
into a `.claude.json` whose path it resolves via `CONFIG()`:

```
AGENT_WORKFORCE_CLAUDE_CONFIG  (a file path)  ->
CLAUDE_CONFIG_DIR              (a dir)        ->
os.homedir()/.claude.json      (raw fallback)
```

It honours `CLAUDE_CONFIG_DIR` but NOT `AGENT_WORKFORCE_HOME`. So a QA walk in
`tools/browser-checks.sh` that connects a provider or creates an agent while
sandboxing only `AGENT_WORKFORCE_HOME` still falls through to the operator's real
`~/.claude.json` (the 140KB file that holds the fleet's oauthAccount). For a REAL
install this fallback is correct behaviour; the leak is a test-isolation gap.

## The fix (Splinter's steer, and it is the reason this is a harness change)

Do NOT add an `AGENT_WORKFORCE_HOME` seam to trust.js. Its docblock is
account-aware and a second seam would be the "second derivation of one fact"
defect `server.js` documents. Instead, point the seam trust.js ALREADY has at a
disposable per-walk config:

- **`tools/browser-checks.sh`**: set
  `AGENT_WORKFORCE_CLAUDE_CONFIG=<sandbox>/config/.claude.json` at every
  `node ./server.js` walk-boot (all 7 sites). A walk's trust write then lands in
  its own sandbox, or fails safe (trustFolder refuses on an absent target with
  `ok:false` and NEVER falls back to os.homedir()), so it can never reach the
  real file.

## Two seams, said honestly (the card named only one)

trust.js's `CONFIG()` honours BOTH `AGENT_WORKFORCE_CLAUDE_CONFIG` (a file path;
`tools/test-install.sh:245` already uses it, which is why the install harness
does not leak) and `CLAUDE_CONFIG_DIR` (a dir). A walk that sets NEITHER is the
leak. This change uses the file-path seam, matching the install harness.

## The test

`engine/trust.walk-isolation-1821.test.js` (authored by Mona Lisa) codifies the
contract: a red-capable leak arm (default-account write, `configDir:null`,
matching `create.js`'s real call shape) that asserts the write lands in a
redirected-HOME throwaway and goes red if trust.js ever grows the declined
`AGENT_WORKFORCE_HOME` seam; plus arms proving both seams isolate, their
precedence, and an explicit account configDir beating the env seams. A require-
time guard refuses to run if the `$HOME` redirect does not take, so the leak arm
can never touch the real machine.

## One placement subtlety (why the #1573 board's seam sits where it does)

The `#1573` P14/P15 render-connect-skip board deliberately omits
`AGENT_WORKFORCE_DRY_RUN` (so a real subprocess probe is observable) and is
exempt from the wired boot-invariant via its `AGENT_WORKFORCE_CLAUDE_BIN`
stub-launcher marker. `tools.browser-checks-wired.test.js` only scans 12
continuation lines above a boot for that marker. The seam is therefore inserted
ABOVE the marker so the marker→boot distance is unchanged and the exemption scan
still finds it.

## What this does NOT do

- Does not touch `engine/trust.js` (no second seam — Splinter's steer).
- Does not change real-install behaviour (a real install still writes trust to
  the operator's `~/.claude.json`, which is what Josh wants).
- A lapsed/sandboxed walk keeps failing safe rather than leaking.
