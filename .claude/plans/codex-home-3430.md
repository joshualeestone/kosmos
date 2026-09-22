# Plan: #3430 - codex CODEX_HOME has the same tmux-server-global leak as CLAUDE_CONFIG_DIR

## What "finished" looks like
A default-account codex agent's pane reads the CODEX_HOME its account was set up in
(so it finds the right $CODEX_HOME/auth.json and runs AUTHENTICATED), even on an
install where the Kosmos board cold-started the tmux server under a non-default
CODEX_HOME. Verified by a test proving the codex pane is launched with
`-e CODEX_HOME=<server-global>` (with a discriminating control that a claude agent
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

## The change (bin/agent-supervisor.sh, codex arm only)
Mirror the #3417 CLAUDE_CONFIG_DIR seam for CODEX_HOME:
1. Resolve `EFFECTIVE_CODEX_HOME` = own env when set (the loop already forwarded it,
   and a per-account plist sets it), else, on the codex arm and only when own env is
   empty, the tmux server-global CODEX_HOME (`show-environment -g CODEX_HOME`).
2. Pin it in the pane env when non-empty (so the pane is deterministic instead of
   relying on inheritance). Empty stays empty (not pushed), same "set-but-empty vs
   unset" caution as the CLAUDE_CONFIG_DIR block. No double-push with the loop (the
   block only fires when own env is empty).
3. Hand the SAME value to the codex-dismiss shim (was `${CODEX_HOME:-}`), so the
   update-notice dismissal targets the same home the pane reads.

The existing CODEX_HOME entry in the pane-env forwarding loop is left in place (it
forwards own-env CODEX_HOME); the new block adds the server-global fallback, exactly
as #3417 did for CLAUDE_CONFIG_DIR.

## Split (same as #3417)
Ice Cream Kitty owns config-dir/investigation (she established the auth-in-auth.json
functional finding); I own the supervisor edit. Branch dropped on #3430 for her review.

## Why launch-side and not create
The pane inherits at launch, and the supervisor is the only place that can observe
the server-global env the pane will inherit. Same reasoning as #3417.

## Tests
- NEW tools/test-supervisor-codexhome-leak-3430.sh: stub tmux answers
  `show-environment -g CODEX_HOME` with a sandbox home; run the supervisor's CODEX
  arm (7th arg = codex) with own CODEX_HOME unset; assert the pane was launched with
  `-e CODEX_HOME=<server-global>` and it is the codex arm (bypass flag), with a
  discriminating control that a CLAUDE agent is NOT pinned. Wired into test:shell.
- Non-vacuity measured against origin/main (the pane is not pinned without the fix).

## Weakest premise (name it)
That the tmux server-global CODEX_HOME the pane inherits is the home where the
account's auth.json lives (i.e. the board runs under the connected codex account).
This is the same premise #3417 relied on for CLAUDE_CONFIG_DIR and holds for the
same reason: the leak IS the account the board was started under. If a future
install runs the board under a codex home that differs from where an agent's
account was provisioned, the create-time codex account write (openaiaccounts /
trustCodexFolder) would need the same effective-home treatment; that create-side
consistency is ICK's investigation half.

## Out of scope
- #3419 (send-truncation) - separate card, in progress.
- The create-side codex account/auth provisioning targeting (ICK's investigation
  half); this card is the launch-side pane + dismiss consistency.
