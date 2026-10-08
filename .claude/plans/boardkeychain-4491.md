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
- `filesystem.denyWrite`: the agent's own `.claude` DIR (no runtime state there) plus the specific
  settings FILES under each config home (NOT the whole `~/.claude` dir, which holds Claude Code's own
  runtime state). This is what stops a shell `printf > settings.json` / self-plant that the permission
  Edit-deny alone does not (measured arm 3). See the "Token-root coverage" section for the full set.

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
- A dir-RENAME self-plant: a file-level denyWrite on ~/.claude/settings.json blocks creating that file,
  but not `mv ~/.claude ~/.claude.old` then recreating the dir with a fresh settings.json, UNLESS
  Seatbelt blocks the ancestor move. Not measured, not assumed. Same reasoned bucket as the hardlink
  vector; the durable close is the parked managed-settings step.
- A ~/.claude-* account home created AFTER board start is covered only by the permission-layer Edit glob
  (not a concrete sandbox denyWrite), and whether Seatbelt translates an Edit-glob to a subprocess write
  is unmeasured. refreshTokenOnlyGuards re-enumerates at each board start, so such a home becomes
  concrete on the next restart.
- Turning the switch on for any NEW agent beyond echo (echo is the one pilot, slice 9's decision).

## A note on the warning sink
refreshTokenOnlyGuards writes the managed-belt-absent warning to STDERR; the board captures its agents'
stderr to its log, so it surfaces there. "board log" in the code comment is that path, not a dedicated
logger.

## After the review rounds (2026-10-04)
- A world created MID-SESSION: its token path is covered for the file tools at once (the world-store glob), but for
  the agent's SHELL only by the sandbox write scope (the shell can write its own folder and temp only) until the
  agent's next start rewrites the concrete denies. Do not widen that write scope to the Kosmos store, the worlds
  base or the home (a note sits by the sandbox block).
- Gate-side hardening (accept other worlds' tokens only from the board's start-time snapshot, or refuse them for
  agent-marked requests) was follow-up card #5247, which has since landed on main.

## Post-rebase review, 2026-10-07 (after rebasing 986 commits onto main)
A board-side route added to main after this was approved (#5153 slice 4, the undo copier: an agent-token route that
reads a path the caller names and stores a copy in <store>/undo) could copy board.token to a readable place.
Fixed both ways: undo.keep refuses the board's credentials (board.token by name and temp names, a hard link to it by
device and inode, the sender tokens folder, the token-only list), from one list shared with this guard
(setup-assistant.boardCredentialPaths), failing closed; and the guard read-denies <root>/undo and <root>/undo-saved in
the permission layer and the sandbox. Tested: refused with no bytes or blob name left in the store, with an
ordinary-file control; the guard test asserts both layers.
**The class, named so the next route is checked:** any route in AGENT_TOKEN_ROUTES or its patterns that reads a path
the caller supplies is a way around this guard. A new such route must refuse boardCredentialPaths() (or the guard must
read-deny where it writes). Nothing ties the two together automatically yet.
Residuals: the relay sign-in key (#5422, signin-device.key) is a person-held secret this guard does not deny; it does
not reach this board as the person. #5247 (the gate's start-time world-token snapshot) has landed on main.
Second post-rebase review (sonnet) found four gaps in that fix, all closed:
- keep checked the path, then read it again by path later (a swap race). It now refuses a link, opens ONCE without
  following a final link, and runs every check (credential identity, regular file, size) and the read on that open
  file. O_NOFOLLOW/O_NONBLOCK are undefined on Windows (#1732 inventory rows added): there the lstat refusal and the
  identity check on the opened file still refuse.
- The sender-tokens check was case-sensitive (macOS disks are not) and had no identity check: paths are now compared
  without case and with realpath.native, every file in every root's sender tokens folder is compared by device and
  inode, and the name check is case-insensitive.
- The undo stores were read-denied but not write-denied, so a forged record could make restore write a file (an agent
  settings file, a credential). The guard now write-denies them in both layers, and plan/apply refuse a credential or
  a Claude settings file (.claude or .claude-<label>) as "protected", whatever the record says (shown to fail with the
  refusals removed).
Reasoned, not measured: that the sandbox's denyRead/denyWrite of the undo folders stops a subprocess (the same as the
existing token rules). Accepted: isCredential runs boardCredentialPaths on every keep (a folder listing per root;
small). The secrets this list names are the board's own; other person-held secrets rely on the undo store being
read-denied.
Third post-rebase review (opus), all fixed:
- The protected set was a hand-kept subset. boardCredentialPaths now lists what the guard protects: board.token and its
  temp copies in every root, the token-only list, the worlds registry and its temp and lock names, the account config
  homes' settings files, the sender tokens folder in every root, and every Kosmos agent's own .claude folder (the
  guard write-denies the whole folder). The agent list must be readable, else it throws and isCredential refuses.
- A folder is judged on its REAL path, so a link of another name to an agent's .claude does not get past (also caught
  by identity, since every file in a protected folder is in the identity list; disabling both routes turns the test
  red). A code repo's own .claude/settings.json is no longer refused (only Kosmos agents' .claude folders are).
- apply re-checks with the file's identity at the write (lstat), not only its name.
- keep refuses a link or a non-file BEFORE opening it; a drive reporting inode 0 gets name and place checks only.
- The guard test now asserts the undo stores are write-denied in both layers.
Residual: a hard link made between apply's last check and its copy would put the token's bytes into undo-saved,
which the agent cannot read or write.
Fourth post-rebase review (sonnet), all fixed:
- Too broad: every agent's .claude was refused, so ordinary agents silently lost undo copies of their skills, plans
  and hooks. Now only TOKEN-ONLY agents' .claude folders (the only ones the guard write-denies), read from the
  token-only list itself (a missing list means none; an unreadable or garbled one cannot be checked).
- A failure to work out the set read as "protected" for every file: it is now 'cannot-check' ("Kosmos could not check
  whether it may change this file") in keep, plan and apply.
- The set was rebuilt per file in plan and apply: now once per call.
- A registry temp or lock name, or an account home's settings file, made after the list was built is caught by name
  and place. The comment no longer claims the two sets are equal: undo also refuses the sender tokens (never undo
  material), which the guard does not read-deny.
Fifth post-rebase review (opus), fixed:
- apply checks the target's real folder (still the recorded one, and not protected) BEFORE anything is written or
  saved aside, and again right before the rename (review 6 moved the first check ahead of the temp write, so no
  restored bytes are written into a guarded folder). The reason is in the API answer as 'protected', 'cannot-check' or
  'moved' (and on the page for a reason found while planning; a refusal during the undo itself shows on the page only
  as part of "N files were left as they were"). A test swaps the folder for a link into a token-only agent's .claude at exactly that point (a tests-only
  hook) and goes red with both checks removed. Residual, named: the window between the last check and the rename
  syscall itself. Narrow; the next board start's guard refresh rewrites the settings.
- A garbled token-only list (or any failure to work out the set) stops every undo copy: the board log says so when it
  starts and again when it ends (review 6), without claiming a cause it cannot know.
- Tests: an account home and a registry temp name made AFTER the set was built are caught by name and place (the set
  built first, so an exact path cannot pass them); plan flags cannot-check and apply leaves the file alone.
- The person's word for 'protected' is now "a protected settings or key file". Every agent (not only token-only ones)
  loses undo copies of ~/.claude and ~/.claude-*/settings*.json: accepted, those are the person's own settings.
Seventh post-rebase review (opus), fixed: the check right before the rename is pinned on its own (a second tests-only
hook point after the temp is written) and move-aside is tested; undo's own stores are in the protected folders, so a
record cannot move or replace undo's own files; a temp is removed by its real path. Residuals, named: a folder RENAMED
while the temp is in it takes the temp along (it stays in the agent's own folder, holding the agent's own earlier
content); move-aside across disks (copy, then unlink by path) has a wider window than a rename.
Eighth post-rebase review (sonnet): no way around the guard found. Fixed: undo's own stores are protected by place
only (never listed, so the cost does not grow with undo-saved) and a test pins them as protected; folders are skipped
when building the identity list. Residual wording corrected: the window between apply's last check and its copy
allows any link swap (hard or symbolic), not only a hard link; either way the bytes land in undo-saved, which the agent
cannot read or write.
Ninth review (opus, the whole branch), decided:
- Fixed: settings keys already in a token-only agent's file that undo the guard (sandbox.excludedCommands, and
  filesystem allowRead / allowWrite) are dropped at every write and refresh; a test plants them. allowUnixSockets is
  kept (a socket is not a file read; pinned by a test).
- Fixed: the "one parse site" claim (boardCredentialPaths is a deliberate second reader of the token-only list).
- Residual, filed as a follow-up card: other agent-writable configuration Claude Code reads at the next start, which
  can start processes outside the sandbox. Not denied here: denying it needs measuring what that breaks in Claude
  Code itself, and main has no guard at all today, so shipping this is still strictly better.
Tenth review (sonnet): fixed: a dropped key is logged (it may have been the person's own, such as a repo the agent
writes to); the stale "one parse site" and #5247 lines. Residual, added to #5516's scope: the guard keeps every other
key already in the token-only agent's own settings file (hooks, env, apiKeyHelper, statusLine, enabledPlugins,
mcpServers, allowAllUnixSockets, enableWeakerNestedSandbox), some of which run processes outside the sandbox. Not
dropped here: what else legitimately writes that file is not yet measured, and dropping blind could break agents.
Eleventh review (opus), fixed:
- BLOCKER: the board-start refresh guarded every listed name, creating <name>/.claude for a name with no agent yet (or
  one removed but still listed); an existing folder refuses creating that name. It now guards only agents whose folder
  exists, and reports the rest as unguarded ("no agent folder yet"). Creation still guards at create time.
- settings.local.json (higher precedence than settings.json) gets the same guard-undoing keys removed (sandbox switched
  off, unsandboxed commands, excludedCommands, allowRead/allowWrite), logged; a file that does not parse is left alone.
- create.js: a throw from tokenOnlyFor now fails closed (it tries to guard) instead of creating unguarded.
Twelfth review (sonnet), no security hole; fixed: the protected set is reused for 2 s (keyed on the token-only list's
size, time and inode, so a list change is seen at once; a failure is never cached); a listed name with no folder is a
note, not a guard failure; the create catch is described as defensive only (tokenOnlyFor never throws today);
cleanLocalSettings failing makes the guard report not ok on purpose. Residuals named: any file named like board.token
(any case) is refused by undo, an over-refusal kept for safety; keep's reasons let a token-only agent learn that a path
is a protected file (existence only, never content). The create wiring is checked by source text, not by a behavioural
create (a real create needs a full sandboxed agent; noted, not built).
Thirteenth review (opus): one WARNING fixed (a test that the cached set sees a token-only list change at once and never caches a failure; red with the key check removed); the cache key includes the list's path; the comment says the cached folder lists can be up to 2 s old; the managed-belt warning counts only guarded agents.
Fourteenth review (sonnet), no security hole: a token-only rule whose path has a pattern character (the guide's #4752 RULE_SYNTAX) is now dropped and said on the board log, never written to misparse (the sandbox keeps the concrete path); test wording fixed.
Fifteenth review (opus), fixed: my round-14 rule filter tested raw rules, so on Windows every rule (backslashes) was dropped; it now converts the separator first like the guide (ruleHasPatternChar, tested with Windows separators). Off macOS the board log says the agent gets permission rules only (no sandbox). Other agents' sender tokens are now read- and write-denied (a token-only agent's own token comes from KOSMOS_AGENT_TOKEN; only the board reads that folder), and undo's switch file is write-denied. The managed-settings check is described as existence only. Stale comments corrected.
Sixteenth review (sonnet), no security hole; fixed: a board.token Read rule dropped by the pattern-character filter (a Kosmos folder path with ( [ { ...) now makes the guard NOT ok, so creation refuses and the refresh lists the agent unguarded; the off-macOS permission-only note is written by the guard itself, so at create time too. Helper moved above its neighbour's doc comment.
Seventeenth review (opus): fail-closed widened: ANY rule the pattern-character filter drops makes the guard NOT ok (a dropped settings Edit deny would let the file tools edit the guard away; an agent name or recorded folder like 'x (y)' or '~/Projects (old)' can carry such a character). Cost, accepted: a token-only agent under such a path cannot be created or guarded until the folder is renamed or moved; the reason says so. The review-14 test now expects not ok.
Eighteenth review (sonnet), no security hole; fixed: an existing settings.json that does not parse is kept as a dated
copy (settings.json.unreadable-<time>) and the board log says so before the guard is written. Stated plainly: a
token-only agent's SHELL can no longer create anything in its own .claude (skills, plans, hooks), because the sandbox
write-denies the whole folder; that is deliberate (the folder is its guard's). Reviewer names removed from code comments.
