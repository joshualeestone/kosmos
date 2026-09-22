# Plan: #3417 — trust prompt on every fresh agent (config-target follows the pane)

## What "finished" looks like
A brand-new Claude agent created on an install where the Kosmos board runs under a
non-default `CLAUDE_CONFIG_DIR` (Josh's box: `.claude-work1`) comes up with NO
folder-trust prompt, because the folder-trust key is written to the SAME
`.claude.json` the launched pane actually reads. Verified by: the existing
retrust test still passes (clean-server-env default path), a NEW test proving the
server-env-leak case writes trust to the server-global account dir (with a control
that fails without the fix), and the full node suite green. Field bar (Josh):
several fresh creates back-to-back plus one reboot, every one clean.

## Root cause (measured from code + Alexandra's #3417 forensics)
- Kosmos records folder-trust PER CONFIG DIR. For a "default account" agent
  (`accounts.js`: default == `~/.claude`), `create.js` and
  `engine/ensure-launch-trust.js` write the key to `~/.claude.json`
  (`agentDefaultAccount`), because the board's / supervisor's OWN env is clean.
- But `bin/agent-supervisor.sh` launches the pane with `tmux new-session`, which
  INHERITS the tmux SERVER's global environment. The board cold-started that
  server while running under `CLAUDE_CONFIG_DIR=.claude-work1`, so every pane
  inherits `.claude-work1` and Claude Code reads `.claude-work1/.claude.json` —
  which has no entry. Every new agent re-hits the prompt.
- The supervisor ALREADY defends against this exact server-env leak for
  `KOSMOS_WORLD` and the store roots (it re-pushes explicit `-e` overrides, empty
  for the default world), but it does NOT do it for `CLAUDE_CONFIG_DIR`. So the
  trust write and the pane read diverge.
- Same class as #2129 ("write file A, read file B"); the layer #2129 could not
  see is the tmux-server-global env, because #2129 assumed a clean server env.

## Why the fix belongs at launch (supervisor), not create
The supervisor is the ONLY place that can observe the env the pane will actually
inherit (the tmux server global). `create.js` at the board cannot reliably know
it, and forcing a create-time answer reopens the #2129 tension (a used machine
where the pane does NOT inherit the board's CCD). `ensure-launch-trust` already
runs on the Claude arm at BOTH first launch and every restart, so correcting the
value it receives fixes create AND restart at one point, and supersedes any
wrong create-time write on first launch (idempotent, best-effort).

## Auth constraint (do not force the pane to default)
Josh's real Claude login lives in `.claude-work1`. `accounts.js` already warns
that forcing the default account to read `row.dir` reads as not-signed-in. So the
fix makes the TRUST WRITE FOLLOW THE PANE to the effective dir; it must NOT force
the pane to `~/.claude`.

## The change (one file: bin/agent-supervisor.sh) — minimal, fallback-only
The existing PANE_ENV loop already forwards `CLAUDE_CONFIG_DIR` from the
supervisor's OWN env (both runners), which covers a per-account agent. It is left
UNTOUCHED. The bug is the DEFAULT-account agent whose own env is clean but whose
pane inherits the tmux server-global CCD. So:
1. Resolve `EFFECTIVE_CCD` = the config dir the pane will actually read:
   `EFFECTIVE_CCD="${CLAUDE_CONFIG_DIR:-}"` (own env; = what the loop forwarded and
   what a per-account plist sets), then — Claude arm only, and only when that is
   EMPTY — fall back to the tmux server global:
   `"$TMUX_BIN" show-environment -g CLAUDE_CONFIG_DIR` (`CLAUDE_CONFIG_DIR=<val>` →
   val; a `-CLAUDE_CONFIG_DIR` unset line or missing var → empty). The server may
   not be running when THIS supervisor cold-starts it; then it inherits our own
   (clean) env, so empty is correct.
2. When the fallback yields a NON-empty value (the leak case, where the loop pushed
   nothing), PIN it explicitly: `PANE_ENV+=(-e "CLAUDE_CONFIG_DIR=$EFFECTIVE_CCD")`
   — so the pane is deterministic rather than relying on inheritance, with no
   double-push (this branch runs only when the loop forwarded nothing). Empty is
   NOT pushed: leaving CCD unset is what #3383c's HOME re-injection relies on, and
   an empty string would risk "set-but-empty" ≠ "unset" in the CLI and (per ICK's
   fleet reference) strand a real per-account login.
3. Pass `$EFFECTIVE_CCD` (not `${CLAUDE_CONFIG_DIR:-}`) to `ensure-launch-trust.js`
   argv[3], so trust is written to the SAME dir the pane reads.
   Result: pane read == trust write, by construction, on every install.

`ensure-launch-trust.js` and `trust.js` need NO change. The loop, the SET/unset
pane-env tests, and the codex arm are all unchanged (minimal blast radius). This
composes with the existing #3383c HOME fix, which handles a different vector
(HOME leak when CCD is unset).

## Vector-contract safety
No new supervisor ARGUMENT and no reordering, so the "contract with every agent
that already exists" (supervisor header) is preserved. The script is refreshed at
every board start, so the fix reaches every existing agent at its next launch.

## Tests
- Extend the stub-tmux harness (tools/test-supervisor-retrust-2808.sh pattern) with
  a NEW test `tools/test-supervisor-ccd-leak-3417.sh`: stub tmux answers
  `show-environment -g CLAUDE_CONFIG_DIR` with a sandbox account dir; run the
  supervisor with its OWN `CLAUDE_CONFIG_DIR` unset; assert (a) the folder-trust
  key landed in the SERVER-GLOBAL account's `.claude.json` (NOT `~/.claude.json`),
  and (b) `new-session` received `-e CLAUDE_CONFIG_DIR=<server-global>`.
  CONTROL: without the fix the key lands in the default config and the assertion
  fails — run the control arm to prove non-vacuity.
- The existing retrust test must stay green (clean-server-env default path).
- Full node suite green; wire the new test into the runner/allowlist if the suite
  indexes shell tests.

## Weakest premise (name it)
That the leak source is the tmux SERVER global env (vs launchd domain). Alexandra's
forensics (trust in `~/.claude.json` = supervisor env clean, yet pane shows
`.claude-work1`) imply the server-global path, and the supervisor's own comments
confirm the mechanism is real on this codebase. The one probe that pins it on
Josh's box: `tmux show-environment -g CLAUDE_CONFIG_DIR` on the Kosmos tmux server.
If it turns out to be launchd-domain instead, the supervisor's own
`$CLAUDE_CONFIG_DIR` branch already covers that (it would be non-empty), so the fix
is correct either way — the resolution order handles both sources.

## Out of scope
- **#3418** — `restartInner` returning RESTARTED on a silently-failed bootstrap.
  Tracked and built separately.
- **Codex CODEX_HOME sibling leak** (own follow-up card) — the tmux-server-global
  leak is not Claude-specific: a board cold-started under one account's CODEX_HOME
  would leak it into a default-account codex pane the same way, misdirecting where
  codex reads its per-account config. There is no trust-dialog symptom (codex has
  no folder-trust gate), so it is not the reported #3417 defect, but the mechanism
  is identical. A codex CODEX_HOME resolution mirroring the CLAUDE_CONFIG_DIR block
  is a separate card; the supervisor comment now names this gap explicitly rather
  than leaving it implicit in the codex-only exclusion.
