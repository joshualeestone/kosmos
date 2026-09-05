# Fix #2192 - OpenAI/codex agent never comes online (runner activation)

## What "done" looks like
The board's agent-detection recognizes a **running native codex agent** (whose pane fronts as
`codex`) as a live agent session, so:
- the creation watch clears the gold "It was set up, but nothing is running under that name yet"
  box (`boardCanSeeIt` → true), and
- the typing route accepts the pane (`isAgentPane` → true, chat.js can type into it).

Both symptoms of #2192 resolve with a **server-side** change to `engine/status.js` only. No
`web/index.html` (render) change → per Baron's 6.31 cut-readiness flag, no OpenAI browser-check
re-audit needed.

## Root cause (CONFIRMED, measured - see the #2192 handoff)
The board's agent-detection is Claude-only. A Kosmos-created OpenAI agent runs the **managed
native codex binary** (a Mach-O arm64 executable - verified by `file` on the pinned vendor
tarball), so its pane fronts as `pane_current_command == codex`.

- `isFleetSession(pane)` → **true** for a Kosmos codex agent (the `isNamedOurs` claim arm:
  `@kosmos_agent == name`). So restart already works; membership is not the gap.
- `isAgentSession(pane)` = `isFleetSession(pane) && isClaudeCommand(pane.command)`. `isClaudeCommand`
  accepts a native-Claude version / `claude` / `claude.exe` / `node` - **not `codex`**. So a native
  codex pane returns **false** here. This is the ONLY failing term feeding `boardCanSeeIt`
  (web/index.html reads the server-computed `a.isAgentSession`) and `isAgentPane` (the typing route).
- `classify()` (state) is ALREADY codex-aware (`pane.runner === 'codex' || isCodexCommand(...)`),
  so state reads unknown/idle, never stopped. The asymmetry is the smoking gun: the supervisor and
  `classify()` were made codex-aware (#245), but `isClaudeCommand`/`isAgentSession`/`rank` never were.

### Why a node-fronting codex already worked (Renet's dev-box observation, reconciled)
`/opt/homebrew/bin/codex` is a `#!/usr/bin/env node` launcher → fronts as `node` → `isClaudeCommand`
already accepts `node` → passes today. #2192 is a **fresh-install** report (user "heather"): no
homebrew codex, so Kosmos uses the managed **native** binary → fronts as `codex` → the gap fires.
Both observations are correct for their environment.

## The fix (additive, fronting-appropriate, crash-preserving)

Two edits in `engine/status.js`, both reusing the single existing `isCodexCommand` source (the
file's one-derivation ethos - no new duplicated command rule):

1. **`isAgentSession`** - accept a running codex command:
   `return isClaudeCommand(pane.command) || isCodexCommand(pane.command);`

2. **`rank`** - a running `codex`/`codex.exe` is unambiguous exactly like `claude`, so it must reach
   `RANK_NAMED_RUNNING`, not fall to `RANK_NAMED_LEGACY`:
   `if (isUnambiguousClaude(pane.command) || isCodexCommand(pane.command)) return RANK_NAMED_RUNNING + byClaimOnly;`

### The design decision - key on COMMAND, not `pane.runner` (rejected alternative)
The handoff floated preferring `pane.runner === 'codex'` because it is fronting-independent. **Rejected.**
`isAgentSession` is the LIVE-PROCESS tier (its header: "AND Claude is actually running"), distinct from
`isFleetSession` (membership, survives a crash). `pane.runner` is a tmux marker (`@kosmos_runner`) set
at creation that **persists past a crash**, so it is a fleet/runner-type signal, not a running-process
signal. Using it in `isAgentSession` would mark a **crashed** codex agent (command fell back to a shell,
runner still `codex`) as a running agent - the exact "too loose" hazard the three-tier header warns
against. Keying on `pane.command` (`isCodexCommand`) preserves the crash distinction perfectly and is the
exact parallel of the Claude path.

**Weakest premise:** the additive fix is proven by unit test + the measured fronting, but the FINAL
confirmation that #2192 is resolved on a real fresh install is a LIVE check (create an OpenAI agent on
a fresh macOS user, confirm its pane fronts as `codex`, the board shows it online, and it is typeable).
That live check needs the shared box / a fresh Mac and is the closing check - "merged ≠ working" holds
for the headline. Ship with challenge-loop rigor; flag the live check to the operator.

## One fix closes THREE cards (dedupe)
- **#2099** (six-green-nonworking OpenAI): same root when the pane is a live-but-undetected codex.
- **#2100 defect-2** (can't message/type a running codex): SAME root (`isAgentPane`→`isAgentSession`).
- **#2093** (codex auth_failed): DIFFERENT layer (liveness/state) - leave it.

## Tests (engine/status.test.js)
- A native codex agent (`command:'codex'`, claim==name, `runner:'codex'`, inMode 0):
  `isAgentSession` true, `isAgentPane` true. FAILS today.
- **Control that MUST stay red:** a crashed codex agent (`command:'zsh'`, claim==name,
  `runner:'codex'`): `isFleetSession` true (restartable), `isAgentSession` false. This is the
  discriminator proving the fix keys on command, not the persistent runner marker.
- **rank/collision:** a session with a crashed shell pane AND a running native-codex pane - the
  running codex pane must win `onePanePerSession` (parallel to the existing claude "agent pane wins
  even when the shell is listed first" test). Without the rank edit the shell wins (RANK_NAMED_CRASHED
  1 < RANK_NAMED_LEGACY 2).

## Verification / rigor
- status.js is engine (no web/ change) → no browser-check gate chain. Run full status.test.js.
- Full rigor: build → challenge-loop to convergence → perturbation-verify → suite → proof → PR →
  merge on green (Kosmos beta: no reviewer). No em dashes (sweep the diff, 5 spellings).
