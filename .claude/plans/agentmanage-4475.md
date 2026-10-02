# agentmanage-4475: step 3 of #4475, the board enforces "remove only an agent you created"

Card: kosmos#4475. Stacked on boardkeychain-4491 (#4491, the board token out of a token-only agent's reach), per
Splinter 2026-10-02 17:06: one full run of this branch (the stack's top) validates both; they merge in order.

## Done looks like
On an enforcing board, an agent that presents only its own agent token can remove an agent it created and no other,
and cannot force a removal; the person (the board token) removes any agent exactly as before.

## Change
- `server.js`:
  - `AGENT_TOKEN_ROUTE_PATTERNS` gains `DELETE /api/agent/<name>/removal`, so a token-only agent reaches the route.
    Planning a removal (GET), restore and every other agent route stay behind the board token.
  - The DELETE handler asks `agentTokenOnlyCaller(req)`. For a caller that came through on its token alone: the target
    must be named by its board name (the slug), else 400, because the check matches by slug and the engine acts on the
    name as sent; `?force` (the person's override) is refused; and any target `tokenOnlyMayRemove` does not allow is
    refused (403, in step 1's doctrine words). A caller holding the board token (the person, the page, every
    non-token-only agent) is untouched.
  - `tokenOnlyMayRemove` allows only when the target's newest birth (`agentBirthOf`: `created` or `partial`, newest
    line wins) is `created`, carries `createdByName` equal to the caller's token name exactly, a time and the time
    the creator asked (`askedAt`); and neither identity has ended since (`sendertoken.endedSince`): the target after
    its birth (strictly, since its own creation revokes its name just before the birth is written), the creator at or
    after it asked. A key-only or twin token is refused; so is a name a token already stood for when it was made
    (`tookTokens`), and a target whose key holds a token of another name now (`sendertoken.keyHoldsOthers`).
  - POST /api/team stamps `askedAt` when the request arrives and, on the agent path, reads the caller's exact token
    name; it passes both to the team.
- `engine/sendertoken.js`: a history of ended identities, `ended-agents.jsonl` (append-only: name and time), written
  by `revoke` (`noteEnded`, before the unlink, so a failed revoke still records it) and read by `endedSince(names,
  since, { inclusive })` (slug match, loose on purpose since a match refuses; null when unreadable).
- `engine/create.js` records on each birth the board name the create acted on (`slug`, its returned name), and
  `tookTokens` when a token stood for that board name or the typed name's key as create was asked
  (`sendertoken.holdsTokens`), before create's own revoke clears it.
- `engine/team.js` sets `createdByName` and `askedAt` on every member: the asking agent's token name and its request
  time when an agent (not the setup guide) asked on a named token, else null, so a member cannot set them.
  `engine/create.js` records them on the birth.
- Tests: `server.agent-remove-4475.test.js` (33); `engine/remove.test.js` (a real removal ends the identity in the
  history and a restore does not erase it); `engine/delete-leftover.test.js` (deleting a stopped, never-removed
  agent's leftovers ends it too); `server.team-agent-token-1279.test.js` (the agent path records the exact token name
  and askedAt for a creator whose sessionName differs; the board-token path records none; END TO END: an agent makes
  a member through POST /api/team, removes it with only its own token, and once its identity ends a later agent of
  its name is refused); `engine/team.newrole-4474.test.js`
  (createdByName sorted as a field the team sets, and who gets one); the pins in `server.agent-token-gate-4491.test.js`
  and `server.agent-token-sender-570.test.js` (the route list, and the token-only call-site count now 3).

## Decisions
- Scope, stated as the card's spike did: real enforcement only for a TOKEN-ONLY agent, which cannot present the
  board token (#4491 keeps it unreadable, slice 9 stops it sending one). It also must not present ANOTHER agent's
  token: those are files under `sendertokens/`, readable by the same Mac user, so the token-only guard
  (`setup-assistant.tokenOnlySettingsRules`) now Read-denies that folder under every data root, in the permission
  layer and the macOS sandbox (review 13), and write-denies it and the records the check trusts (created.jsonl,
  ended-agents.jsonl, agent-token-only.json), which only the board and the supervisor write, so it cannot forge a
  birth, erase an end or plant a token (review 14), and Read-denies the supervisor's launch hand-off folders
  (`launch-secrets/`, beside the data root and in the app folder), where a token waits until its pane starts
  (review 15). Its own token comes in its environment from the supervisor. NOT closed: another agent's token in its
  process environment (readable with `ps -E` by the same Mac user, unless Claude Code's sandbox blocks it, not
  measured), and typing into another agent's tmux pane; both need a per-agent OS user to close.
- Accepted cost of that deny (review 17): the Mac CLI's outbox keep (a `kosmos msg`/`reply`/`post` made while another
  Kosmos is the one open, answered 421) resolves the sender by reading `sendertokens/` (engine/outbox.js
  resolveKeepSender), so for a token-only agent that send is refused with a sentence instead of kept. Narrow: the
  token-only pilot (Echo today) in a multi-world moment. Fixing it means the outbox keeping something the board can
  resolve later without the agent reading the store; a follow-up, noted on #4475. The tests
  assert the config written; Seatbelt enforcing a folder deny was measured by hand for board.token's file only. An agent that can still read the board
  token is indistinguishable from the person, so for it this stays advisory (step 1's doctrine). It widens as
  token-only becomes the default.
- The target is matched by the board name its create acted on (`slug` on the birth), never by the typed `name`,
  which the birth log cuts to 120 characters: a member named "Helper" + 200 spaces + "Zed" is made as `helper-zed`
  while its cut name slugs to `helper` (review 15). A birth with no `slug` (older format) is not honoured.
- The creator is matched by its EXACT token name, recorded on the birth (`createdByName`). `createdBy` is not used:
  it is the card's sessionName, a slug with a pane and a lossy store key without one, so any comparison with it is
  either too loose (dr-kip and drkip) or too strict (an adopted "Casey"). Reviews 2 and 3.
- The person's paths record no `createdByName`. They do record fixed creator words ("operator" from the org-chart
  import, "kosmos" for the setup guide) in `createdBy`, and an agent can take either as its name; without this rule
  an agent named "operator" could remove everything the person imported (review 1).
- The setup guide's creations are the person's: it makes agents on the person's behalf, so its births carry no name
  and it cannot remove them. Rejected: letting it, as any other creator.
- **Ownership ends the first time the target's or the creator's identity ends after the birth** (reviews 7 and 9).
  It is recorded in `sendertoken.revoke`, because every path that ends an agent revokes it first: removing it,
  deleting what is left of it (#514, which also frees a stopped agent that was never removed, review 9), and
  creating an agent of the name (create revokes a name before making it). A later agent under either name, however
  it arrives (made, adopted, a remote token), is then never the one the birth is about. Rejected: the profile id
  (reviews 5 and 6), which survives removal and is carried to a new agent of the same name, so it did not tell
  incarnations apart; its tests deleted the profile by hand and so assumed what they tested. Rejected: a removal-only
  history (review 7's fix), which missed a name freed by deleting a stopped agent's leftovers.
- A live remote agent holds no folder, job or pane, so create can take its name and its revoke clears that agent's
  tokens (a pre-existing gap in create, review 11). This change would have turned that into a removal of the remote
  agent's name; `tookTokens` refuses it. Rejected for this card: making create refuse such a name, a change to
  create's own behaviour that belongs on its own card.
- Removal revokes the whole key (#4844), so removing a made "drkip" would also end a remote "Dr.Kip" issued later
  under the same key. A token-only removal is refused while the key holds a token of any other name (review 12).
- History times are compared as strings, which is right only in toISOString's fixed form; a line or a birth time in
  any other form refuses.
- #4845's refusal on the remote-token route fails open when the created list cannot be read (and off macOS), so the
  person could issue a remote token under exactly a made agent's name after its birth; a creator's removal would
  then revoke it with the rest of the key. Narrow, rests on #4845's documented fail-open, accepted.
- A remote token the person issues again under a name (POST /api/agent-token) mints without revoking, so it carries
  that name's identity on: a remote creator re-issued its name keeps what it made. That is the person's act and is
  taken as the same identity.
- The creator is checked from when it asked (`askedAt`, stamped as the request arrives), not from the birth, which is
  written after the create returns: a creator removed while its request ran is caught (review 9).
- Ownership does not come back on restore: the history is not erased by it. The person can remove a restored agent.
- A newer `partial` birth of the name ends the older agent-made one's ownership; a `partial` creation is never
  removable by its creator. Agents made before this change (no `createdByName`), and creators whose token carries no
  name (before #4792), cannot remove; the person can.
- A history that cannot be read refuses. A failed append is logged; it is caught by nothing else, so the residual is
  an agent ended on a full disk.
- Accepted premise: the wall clock orders an end after the birth it ends (both are ISO times from it). A backward
  clock step between the two, and a name reused inside that window, would keep ownership. Rejected: a shared sequence
  number across the birth log and the removal history, more machinery than that window warrants.
- Rejected: refusing every agent-token removal (today's behaviour): it keeps "PM, build me a team" from tidying up
  its own team, which #1279 made possible; and a general permission grid now (no asked-for need beyond this boundary).
- Not done: a `kosmos` verb for removal. The doctrine tells agents to use a command or ask the person; with no verb,
  the person still removes from the board. A verb is a follow-up if a PM agent needs it.
- Not bounded: `ended-agents.jsonl` is append-only, written on creates and removals only (not restarts), and read
  whole on each token-only removal. Low volume today; a follow-up if it grows.
- Not atomic: create reads `tookTokens` before its own revoke, unlocked; a remote token issued for the name inside
  that window is revoked by the create without the flag. Narrow (the person issuing a remote token for a name an
  agent is creating at that moment), accepted.
- Weakest premise: that every way an agent's identity ends goes through `sendertoken.revoke`. True for removal,
  deleting what is left, and create (the token module's own header requires it of any caller that recreates or
  deletes an agent). A person deleting an agent's files by hand outside Kosmos, then adopting a new agent of that
  name (adopt mints without revoking), is not seen.

## Validation
- `engine/boardkeychain-4491.test.js` 20/20 (the sender-token folder read- and write-denied, the trusted records write-denied), `server.agent-remove-4475.test.js` 33/33, `server.team-agent-token-1279.test.js` 25/25, `engine/remove.test.js` 93/93,
  `engine/delete-leftover.test.js` 15/15, `engine/team.newrole-4474.test.js` 22/22,
  `server.agent-token-gate-4491.test.js` 25/25, `server.agent-token-sender-570.test.js` 7/7.
- Mutants, each failing only its own cases: revoke not writing the history (the delete-leftover and end-to-end tests),
  the creator checked from the birth instead of askedAt, the target check removed, the creator check removed, an
  unreadable history read as none, the target's end counted at the birth's exact time, the removal route ignoring
  `tookTokens`, create not recording it, the shared-key check removed, a malformed history time skipped, a malformed
  birth time accepted, the birth's `slug` ignored, the `slug === target` check removed, `tookTokens` checking only the
  typed name's key, the launch hand-off deny removed, an empty name set read as nothing ended, an unreadable token
  file read as no other name, plus (re-run on this code at
  b54ebe022) the createdByName presence check, the key-only refusal, the board-name check, a slug comparison of the
  creator, and the team route recording the sessionName in place of the token name.
