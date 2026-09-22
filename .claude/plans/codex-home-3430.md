# Plan: #3430 - codex CODEX_HOME has the same tmux-server-global leak as CLAUDE_CONFIG_DIR

## What "finished" looks like
A default-account codex agent's pane reads the DEFAULT codex home ($HOME/.codex, where
its auth.json actually lives) and runs AUTHENTICATED, even on an install where the Kosmos
board cold-started the tmux server under a stray CODEX_HOME (which the pane would otherwise
inherit). Verified by a test proving the codex pane is pinned to the DEFAULT home and does
NOT read the leaked server-global home (with a discriminating control that a claude agent
is NOT pinned), non-vacuity against origin/main, and the full suite green.

## Root cause (sibling of #3417; ICK's investigation)
Same tmux-server-global-env leak class as #3417, on CODEX_HOME. `tmux new-session`
inherits the server GLOBAL env, so a default-account codex pane (own env clean, no
plist CODEX_HOME) silently inherits the server-global CODEX_HOME. Because codex
stores its AUTH in `$CODEX_HOME/auth.json` (ICK), a pane pointed at the wrong home
reads the wrong (or no) auth and runs UNAUTHENTICATED, silently, with NO prompt
(codex has no folder-trust dialog). This is FUNCTIONAL, not cosmetic: it breaks the
OpenAI/ChatGPT client on shared-account installs, and Josh wants both clients
working.

## The change (bin/agent-supervisor.sh, codex arm only), the MIRROR of #3417, not a copy
🛑 CORRECTED after PigeonPete + ICK review of #3432-v1 (which wrongly pinned the leak).
Claude and codex need OPPOSITE fixes because Josh's account lives in a different
place per provider:
- Claude's login IS the server-global (.claude-work1), so #3417 PINS it and realigns
  the trust WRITE there (ensure-launch-trust). Read == write == account.
- Codex's login is the DEFAULT home ($HOME/.codex): default signin leaves auth.json
  there (verified: $HOME/.codex/auth.json exists on this box), and create.js writes
  default-account codex trust via defaultAgentCodexHome()=$HOME/.codex, deliberately
  skipping the engine/server CODEX_HOME. Codex has NO launch-time write-realign
  (ensure-launch-trust is Claude-only; auth is the user's login Kosmos never writes).

So pinning the leaked server-global (v1) just makes the wrong read explicit (the pane
already inherited it) and leaves the agent unauthenticated. The fix must point the READ
at where auth already is:
1. `EFFECTIVE_CODEX_HOME` = own env when set (a per-account codex agent, plist CODEX_HOME;
   left to the forwarding loop), else, for a DEFAULT codex agent (own env empty),
   `defaultAgentCodexHome()` = `${AGENT_WORKFORCE_CODEX_HOME:-$HOME/.codex}`, NOT the
   server-global.
2. Pin that concrete default path into the pane, OVERRIDING whatever the leak would have
   supplied (mirroring #3406's HOME re-injection for a default claude agent). A concrete
   path, so no "set-but-empty vs unset" ambiguity; idempotent on a clean box; defeats the
   leak on a board cold-started under a stray CODEX_HOME.
3. Hand the SAME value to the codex-dismiss shim (was `${CODEX_HOME:-}`), so the dismiss
   targets the home the pane reads.

The forwarding loop's CODEX_HOME entry is left in place (it forwards a per-account
plist's own-env CODEX_HOME); the block fires only for a default agent (own env empty).

## Split (same as #3417)
Ice Cream Kitty owns config-dir/investigation (she established the auth-in-auth.json
functional finding); I own the supervisor edit. Branch dropped on #3430 for her review.

## Why launch-side and not create
The pane inherits at launch, and the supervisor is the only place that can observe
the server-global env the pane will inherit. Same reasoning as #3417.

## Tests
- NEW tools/test-supervisor-codexhome-leak-3430.sh: run the supervisor's CODEX arm
  (7th arg = codex) with own CODEX_HOME unset, the default home pointed at a sandbox
  dir (AGENT_WORKFORCE_CODEX_HOME seam), and the tmux server-global leak set to a
  DIFFERENT dir; assert the pane is pinned to the DEFAULT home AND does NOT read the
  leaked server-global home (the v1-bug guard, Pete/ICK), and it is the codex arm
  (bypass flag), with a discriminating control that a CLAUDE agent is NOT pinned.
  Wired into test:shell.
- Non-vacuity measured against origin/main (the pane is not pinned to the default
  home without the fix).

## Premise, VERIFIED (was the v1 bug)
v1 assumed the leaked server-global CODEX_HOME is where the account's auth lives (a
copy of #3417's premise). That is FALSE for codex, and it was the bug: codex auth
lives in the DEFAULT $HOME/.codex (default signin; create.js defaultAgentCodexHome
deliberately skips the engine CODEX_HOME), verified on this box ($HOME/.codex/auth.json
present) and by ICK on hers, confirmed by PigeonPete's code reading. Codex has no
launch-time write-realign, so unlike #3417 the read cannot follow the leak; it must
point at the default home. Remaining premise: that a per-account codex agent's plist
sets its own CODEX_HOME (so the own-env-set branch is left to the loop and only a
default agent hits the override) - true per create.js's accountEnvVar(codex)=CODEX_HOME.

## Out of scope
- #3419 (send-truncation) - separate card, in progress.
- The create-side codex account/auth provisioning targeting (ICK's investigation
  half); this card is the launch-side pane + dismiss consistency.
