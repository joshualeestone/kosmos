# boardkeychain-4491 - keep board.token unreadable by a token-only agent's shell (per-agent layer)

Card: kosmos#4491. Follow-on to slice 9 (#4864, merged): slice 9 stops a token-only agent
from SENDING board.token; this stops it READING board.token.

## What finished looks like
- A new function in `engine/setup-assistant.js` writes a token-only agent's
  `<folder>/.claude/settings.json` so a sandboxed shell in that agent cannot read
  `board.token` and cannot turn its own sandbox off, while its normal work (its own
  data folder, the loopback board, the network) still works.
- `engine/create.js` calls it at creation for an agent that `sendertoken.tokenOnlyFor(name)`
  lists, before the agent can start (gated like the guide's guardGuideFolder).
- A board-start refresh applies it to an ALREADY-listed token-only agent (echo), so the
  pilot does not need a re-create, and WARNS (board log) when the managed-settings belt is absent.
- Unit tests assert the written config (the deny set, the sandbox block, merge/idempotency,
  safe refusal) - NOT Seatbelt enforcement itself, which is Claude Code's job and was measured
  by hand in the spike (card comments 10:55, three arms).

## The config written (mirrors guardGuideFolder, narrower + self-edit protection)
`permissions.deny` (merged with any existing, deduped):
- `Read(//<board.token abs path>)`  - the secret
- `Edit(//<agent>/.claude/settings.json)`, `Edit(//<agent>/.claude/settings.local.json)` - stop the
  agent editing away its own guard (Edit rules cover all file-editing tools)
- `Edit(//<HOME>/.claude/settings.json)`, `Edit(//<HOME>/.claude/settings.local.json)` - stop the
  self-plant into the shared user settings the adversarial pass found (hole 1)

`sandbox` (macOS only, mirrors the guide + a filesystem block the guide lacks):
- `enabled: true`, `autoAllowBashIfSandboxed: true`, `allowUnsandboxedCommands: false`
  (so a refused command cannot be re-run with dangerouslyDisableSandbox under
  --dangerously-skip-permissions), `network.allowLocalBinding: true` (the loopback board)
- `filesystem.denyRead: [<board.token>]` (belt-and-suspenders with the permission Read-deny;
  both measured in the spike)
- `filesystem.denyWrite: [<agent>/.claude, <HOME>/.claude]` - this is what stops a shell
  `printf > settings.json` / self-plant that the permission Edit-deny alone does not (measured arm 3)

## Proven vs reasoned (from the spike, card comments)
- PROVEN (spike arm 3, measured by hand): with the agent-folder denies + sandbox, Write/Edit/printf
  of the agent's own settings, a direct cat/Read of board.token, and a launchctl copy-out were ALL
  refused; the control file stayed readable; loopback + network worked.
- REASONED (adversarial pass, NOT re-measured here, flagged on the card): the `~/.claude` denies
  (hole 1), and that the HARDLINK vector (hole 2) and a fully-durable lock are closed only by
  root-owned MANAGED settings - a one-time admin step that is needs-operator and parked.
- Therefore this per-agent layer is DEFENSE-IN-DEPTH, honestly labelled; the board-start warn makes
  the missing managed belt visible. The card stays open for the managed-settings step.

## Steps
1. `guardTokenOnlyFolder(dir, agentName, deps)` in setup-assistant.js - mirror guardGuideFolder's
   read-merge-write (preserve existing settings, idempotent, never throw, tmp+rename), with the
   narrower deny set above. Resolve board.token via the same store root logic the guide uses.
2. Wire into create.js where guardGuideFolder is called: additionally, for any role, if
   `sendertoken.tokenOnlyFor(name)`, call guardTokenOnlyFolder (gated - a failure refuses creation,
   same as the guide, because an unguarded token-only agent is the thing the card forbids).
3. `refreshTokenOnlyGuards()` (board start, like refreshGuideGuards): for each name in
   agent-token-only.json, guardTokenOnlyFolder its folder; warn to the board log if the managed
   belt file is absent.
4. Tests: engine/boardkeychain-4491.test.js - the deny set is present, the sandbox block is correct
   on darwin and absent elsewhere, merge preserves a person's own rules, idempotent on re-run,
   returns {ok:false,because} on a bad folder.

## Token-root coverage (corrected after iteration 2)
An earlier draft said "the same store root logic the guide uses", which over-claimed. The guard denies
board.token (and its temp copy) in the current store, each pre-#2439 legacy root, AND the default
world's base when the agent is in a named world, all as concrete paths, derived defensively (a worlds
resolution throw degrades to current-store coverage rather than failing agent creation). The settings
self-plant denies cover the agent's own folder, ~/.claude, and the ~/.claude-* account variants
(CLAUDE_CONFIG_DIR, e.g. ~/.claude-account-f) via an Edit glob. The sandbox filesystem block denies the
agent's own .claude DIR but only the specific settings FILES under ~/.claude (not the whole dir, which
holds Claude Code's own runtime state), and realOr's its paths so a symlinked root still matches.

## Out of scope / residuals (stated)
- The root-owned managed-settings install (needs-operator, parked on the card) - the durable close.
- A content-based credentials deny for the hardlink vector (unverified setting; not inventing it).
- The guide's version-dependent mid-path glob for EVERY named world's store (cross-world board.token).
  Not mirrored: it is Claude-Code-version-dependent and the exotic case; a token-only agent lives in one
  world. On this default-world fleet the extra roots are usually empty anyway.
- Turning the switch on for any NEW agent beyond echo (echo is the one pilot, slice 9's decision).
