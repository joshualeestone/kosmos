# #3939 slice 3c-3a: an agent can run on Meta Muse (engine, behind the flag)

Card: https://github.com/joshualeestone/kosmos/issues/3939
Branch: muse-create-3939 (off origin/main 065984f)

## Finished looks like

With AGENT_WORKFORCE_MUSE=1 on a Mac, `POST /api/agents` with `provider: "meta"` creates an agent whose
launchd job starts a tmux pane running Kosmos's Muse front. A message delivered to that agent by the
normal chat path (tmux paste + Enter) runs ONE `muse exec` turn through `engine/muserun.runTurn` on the
agent's own session id, the answer is printed in the pane, and the board hears working / idle. With the
flag off, `provider: "meta"` is refused exactly as today.

## Why the split (decided 2026-09-28 01:50, Angel)

The survey found Meta refused at four layers (form markup, form branches, engine create, no runner) and
NO turn-based runner on a Mac (the only one, win32codexsup, is Windows only). 3c-2 took 13 review rounds
on a web-only diff. So 3c-3 is split:
- **3c-3a (this branch): engine.** Create accepts `meta`, the runner exists, a message runs a turn.
- **3c-3b (next): the Create Agent form** (the Meta option, its own create branch per plan
  muse-acct-3939 round-1 N5, vendorPicksModel, fillCreateAccounts), the Connections box counting Muse,
  and engine/connections.js's agent-facing text (it says Meta is "coming soon"; it changes in 3b,
  the slice a person can actually pick it in, so the text is never ahead of the screen).
Rejected: one slice for both (review surface too big); a Windows-style channel runner on the Mac
(new delivery path in chat.js, new presence path: far more surface than a pane front).

## Design: a pane front, not a new delivery path

Meta's guidance on the card (and the spike) is to drive `muse exec --json --session-id <per-agent uuid>`
per turn, codex-style; Muse's TUI cannot be read from outside. So the tmux pane runs a small Kosmos
program, `engine/musefront.js`, instead of a vendor TUI. Everything else (paste delivery, restart, stop,
logs, the supervisor loop) is reused unchanged.

- **Input:** raw mode on stdin. chat.js guarantees the wire is ONE line (whitespace flattened, #3419) and
  submits with a separate Enter, so one CR = one message. Raw mode, not cooked: macOS cooked mode caps a
  line at MAX_CANON (1024 bytes) and a Kosmos message can be longer. Echo typed bytes; handle backspace
  and Ctrl+U minimally; Ctrl+C clears the unsent line (does not kill the front).
- **A turn:** `runTurn({ workspace: WORKDIR, sessionId, prompt, approvalMode: 'never' })`. `never` because
  every other Kosmos runner is launched auto-approving (claude/agy skip-permissions, grok always-approve)
  and a headless turn has no one to ask; `--user-input-auto-resolve` is already passed by muserun.
- **One at a time:** messages arriving while a turn runs are queued and run in order (muserun refuses a
  second concurrent turn on one session anyway).
- **Session id:** a UUID created once and kept at `<WORKDIR>/.kosmos/muse-session` (mode 600), so context
  carries across turns and across a restart of the front. Unreadable/invalid file -> a new one, said in
  the pane.
- **Brief:** Muse reads AGENTS.md in a trusted workspace at session start (spike step 6); runTurn passes
  --trust-workspace. So briefFilename('muse') = 'AGENTS.md'.
- **Model:** Muse picks its own (`muse-spark-1.3-contributor` reported). No model is sent; a model on
  create is refused, like antigravity's account.
- **Account:** none. Muse's sign-in is one Keychain credential per macOS user (card: Mortals run).
  An `account` on create is refused with a sentence saying so.
- **Status:** at turn start the front reports `working`, at turn end `idle`, by running
  bin/agy-report-bridge.js as a child with `PreInvocation` / `Stop` (same POST, same throttle, same
  headers, same "never break the agent" contract). Reused rather than copied; the bridge's map is
  event -> state and needs nothing agy-specific for these two events. (Verify in build: reportFor with an
  empty payload.)
- **Output in the pane:** the answer text; on failure `because` in one line. Never raw JSONL.

## Engine touchpoints (mirror #3568 antigravity)

- engine/create.js: providerRunner/runnerProvider/isNonClaudeRunner/providerLabel ('Meta Muse'),
  briefFilename, the provider guard in createAgentInner and setProvider (`meta` only when
  musestatus.enabled()), a `museEnabled` re-export or direct musestatus call, runner bin (the muse
  binary, found by musestatus/runners), account and model refusals, runner label.
- bin/agent-supervisor.sh: `muse` branch: `"$NODE_BIN" "$_eng/musefront.js" "$WORKDIR"` in tmux, the
  muse binary passed through env for runTurn.
- engine/status.js: runner normalisation (967, 7500) knows 'muse'; a `node` pane with @kosmos_runner
  muse is an agent pane (node is already an accepted agent command).
- engine/chat.js: nothing required; the enter-gap floor list is not extended (the front does not
  swallow an Enter riding a paste; raw-mode read).
- engine/discover.js, register.js, worldstarts.js, server.js: wherever antigravity is special-cased for
  recognition or restart, add muse, gated on the flag for setup paths only.

## Tests

- musefront: line assembly (chunked bytes, CR, backspace, Ctrl+U, Ctrl+C), queueing (second message
  waits), session id create/reuse/invalid, report child args. runTurn stubbed via muserun.setForTests.
- create: meta refused with flag off, accepted with flag on (darwin), account refused, model refused,
  brief file is AGENTS.md, plist runner arg is muse.
- supervisor: the muse branch launches node + musefront (supervisor.muse-launch-3939.test.js: launch arm,
  a refusal with no engine beside the script, a claude control). Proven able to fail: with the muse arm
  renamed, 2 of its 3 tests go red.
- Controls: each new refusal/acceptance test goes red with its guard removed.

## Not in this slice

The Create Agent form option and its create branch, the Connections box, connections.js text (3c-3b);
the first-run Meta row; a real signed-in turn (the Mortals-Mac run, Josh approves the device code).

## Status (2026-09-28 02:10, Angel)

Built. Touched tests 414/414; full tools/run-tests.sh exit 0. Checked in build: the supervisor's adopt
allowlist already accepts `node`, so a live Muse pane is adopted, not killed; agy-report-bridge.reportFor
maps PreInvocation/Stop with the front's `{}` payload to working/idle. Next: challenge loop, PR.

## Weakest premise

That a node front in a tmux pane is classified as an agent pane for delivery exactly like a real CLI.
verifyAtSend accepts `node` today (legacy npm claude); if status decides a pane's kind from the pane's
command before @kosmos_runner, the muse pane may be read as a Claude pane and scraped for Claude screens.
Checked first in the build; if wrong, status gets an explicit muse arm.
