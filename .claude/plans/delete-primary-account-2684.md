# #2684 - allow deleting the PRIMARY/main connection (OpenAI, Anthropic, etc.)

## The ask (Josh, ruled 2026-09-11)

Josh cannot delete the PRIMARY/main account on a connection, only secondary ones. His use case:
"move all my agents over to one of my other accounts and sign in on all of them, then delete the
original Claude connection." He expects to need this. Ruling confirmed the card's parked intent, so
it is unblocked; ship the honest version, he can refine.

## The design decision (mine, per decide-and-build)

The two providers differ in WHERE the primary's identity lives, and that decides the mechanism:

- **Claude**: the primary `~/.claude`'s identity is the `oauthAccount` key in `<HOME>/.claude.json`,
  which sits BESIDE the dir, NOT inside it. The `.claude` dir is Claude Code's home and may hold
  other accounts' history via `prepare()`'s `projects` symlinks. So "remove the primary connection"
  clears ONLY the `oauthAccount` key from `<HOME>/.claude.json` via a JSON round-trip -- every other
  key (MCP servers, project state) and the dir are KEPT. The connection then drops from `list()`
  (identityOf returns null). Because the dir survives, no history is orphaned, so no shared-history
  guard is needed. Both the delete and disconnect doors converge here: with no dir to rename-aside or
  rmSync without collateral loss, clearing the identity is the one safe act.

- **OpenAI**: an account's identity (auth.json) and config live INSIDE its own `.codex` dir, there is
  no cross-account symlink sharing, and disconnect (forgetAccount) already renames the whole default
  dir aside. So deleting the default is the same whole-dir rmSync as deleting a secondary, gated by
  the same running-agents / sign-in-in-flight / arbitrary-path guards.

### What I reject
- rmSync-ing the Claude primary dir (destroys Claude Code's home + shared history, irreversibly).
- A blanket allow with no guards (the running-agents refusal + arbitrary-path defence stay).

### Weakest premise
That Josh wants the connection gone from the LIST (disconnect-the-identity), not the whole `.claude`
dir wiped. His stated use case is satisfied by clearing the identity; if he also wants the dir/creds
physically gone, that is a one-line follow-up. Shipping the honest, non-destructive version.

## Implementation

- **engine/accounts.js**: `clearDefaultIdentity()` helper; `forgetAccount` + `removeAccount` primary
  branches call it (running-agents guard inlined first; refuses on unparseable JSON rather than
  corrupting the file). Returns `wasDefault:true` + `defaultCleared`.
- **engine/openaiaccounts.js**: `removeAccount` drops the default-only refusal; whole-dir rmSync;
  `wasDefault` on the success return.
- **server.js**: default-specific disconnect/delete success messaging ("the main Claude connection is
  removed; the folder and any history in it are kept; sign in again to reconnect"), replacing the
  secondary wording that falsely said history goes with it.
- **web/index.html**: the default row's Disconnect is now a live `data-forget` button (Claude title
  states the folder is kept); the Delete button is exposed on the OpenAI default (whole-dir delete,
  genuinely distinct from its rename-aside disconnect) and stays suppressed on the Claude default
  (its Disconnect already does the identity-clear, so a Delete would be byte-identical). Removed the
  dead aria-disabled default-Disconnect click handler.

## Tests (fixture-only; never touch the real ~/.claude.json or ~/.codex)

accounts.delete-primary-2684 (7), openaiaccounts.delete-primary-2684 (4), and updated
server.disconnect-stop-2570 (33), server.forget-claude-1659 (12); server.remove-2264 (3) and
server.forget-openai-1689 (7) still green. Controls: running-agent refuses + file untouched,
unparseable JSON refuses + byte-identical, no-identity quiet success, secondary still dir-deleted,
stopAgents flow stops then removes, OpenAI default whole-dir delete.

## Browser check

web/index.html changed (the account-row controls), so both browser-check gates apply (#1720 coarse
and #2518 surface-map). The docs/browser-checks/render-accounts-openai.js assertion was updated to the
live-default contract (default Disconnect live, no Claude-default Delete) and both gates pass; the two
other surface-mapped checks carry per-check Browser-check-surface trailers (they seed only non-default
rows). NOTE: the assertion was updated, not re-run against a live browser this session -- the
browser-check suite exercises it in CI. A unit assertion pins the OpenAI-default-Delete render branch.
