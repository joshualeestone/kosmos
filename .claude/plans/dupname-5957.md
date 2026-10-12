# #5957 slice 1: no two agents share a display name

**Branch:** `dupname-5957` · **Card:** kosmos#5957 (slice 1 of 3; slices 2 and 3 are the version-behind flag and the
archive offer for long-idle agents).

## The defect

Josh's Windows QA (10-12): two agents on one computer are both shown as "Gemini". Today nothing compares DISPLAY
names. Session names (the slug) are checked at create, import and restore; the display name (`profile.displayName`,
or the `You are **X**` line) is never compared, on any path. `@gemini` in a room then names two members, and
`mentionedMembers` (engine/messages.js) already treats that as ambiguous and asks nobody.

## The rule

A name is taken when its KEY equals the key of another agent's display name OR session name. The key is the one
@-mentions already use (`mentionKey` in `mentionedMembers`): NFKD, lower-case, letters and digits only. Using the SAME
key is the point: Kosmos refuses exactly the names that would make an @-word mean two agents, no more, no fewer.
"Gemini", "gemini", "GEMINI " and "Ge-mini" all clash. A key shorter than 2 is never a clash (mentions ignore it too).

Moving `mentionKey` into the new module and having `mentionedMembers` call it keeps the two from drifting. The page's
own resolver is held to `mentionedMembers` by web.mention-parity-4642.test.js, so behaviour there is unchanged.

## Where the fleet comes from

`engine/agentnames.js` holds `nameKey`, `clashFor(wanted, { except, agents })` and a `setFleetSource(fn)` seam, the
same shape as `status.setCreatedSource`. The board wires it to every agent the board shows: `safeRoster()` rows that
are ours (sessionName + display name) plus `status.createdKeys()` (created agents, running or not, including stopped
ones like the idle Gemini), named through `status.readIdentity`. Removed agents are left out here; slice 1's restore
path is not changed (see "Not in this slice").

With no source wired (unit tests, a context without a board) `clashFor` answers "no clash": the session-name checks
that exist today still run, so this is purely additive. With a source that THROWS, a create or rename is refused with
"we could not check the names already in use", fail closed, the same posture as create's own roster check.

## The paths that set a display name, and what each does now

| path | change |
|---|---|
| `createAgentInner` (POST /api/agents, POST /api/team, the setup guide) | refuse 400, `field: 'name'`, before anything is written |
| `PUT /api/agent/:name/profile` with `displayName` | refuse 400, `field: 'displayName'`; the agent's OWN names never clash (`except`) |
| `PUT /api/agent/:name/instructions` changing the `You are **X**` line | the file save still succeeds (it is the person's text); the display-name follow is skipped and the reply says why |
| `POST /api/connect-agent` (discover.connect) | refuse, as create |

The sentence: `there is already an agent called Gemini (@gemini). Pick another name, or rename that one first.`
It names the other agent by display name and handle, as `ambiguousNote` does, so the person can find it.

## Not in this slice, said on the card

- Restore of a removed agent whose name is now taken, and copying agents into another Kosmos (worldimport): both keep
  today's session-name checks. Follow-up if wanted.
- Existing duplicates (Josh's two Geminis) are not renamed. Slice 1 stops NEW ones; the board shows the duplicate as it
  is, and renaming either one now works only to a free name.

## Tests

- `engine/agentnames.test.js`: the key (case, spaces, punctuation, NFKD, length under 2), `except`, a session-name clash,
  a display-name clash, no source = no clash, a throwing source = refuse.
- A create refusal and a profile rename refusal through the server, plus the instructions follow being skipped with the
  file still saved. Each with a control that the free name still works.
- The existing mention tests must stay green (same key).
- Mutants: break the key (case-sensitive), drop `except`, and make the create check a no-op; each must turn a named test red.

## As built (changes from the plan above)

- **The fleet source is wired in `start()`, not beside `setCreatedSource`.** That one sits under
  `require.main === module`, so a board started by a test (or any caller of `start()`) never had it, and the first run
  of the server test showed every refusal passing. `start()` is what every board, real or test, runs. It is ONE line
  after the file-preview sweep, calling `nameCheckFleet()` (module level, exported for its tests): an earlier version
  put the whole block at the top of `start()` and broke two structural tests (#5247 wants `snapshotWorlds()` first,
  #5254 wants the sweep within 400 characters).
- **"Could not check" is untagged** (no `field`), as #2606 asks for system refusals: the name may be fine.
- **The create test calls `create.createAgent`** with the board's wiring live. Through POST /api/agents the sandbox
  refuses first for having no Claude account signed in, which says nothing about names.
- **Connect checks both** the display name its instructions give and the handle.
- Measured at the first build (the counts have grown since; the PR states the final ones): engine/agentnames.test.js 6/6, server.dupname-5957.test.js 5/5. Mutants, each restored by
  `git checkout` on a clean tree: a case-sensitive key 5 fail, no `except` 4 fail, a no-op create check 1 fail. The
  nearest existing files (mentions, create, rename x3, connect, team x3, setup guide, CLI create, inline errors,
  messages): 538 tests, 0 fail. **That set was too narrow:** it missed three guards a full run found red (the two
  start() structure tests above, and windows-tests-1777, which flags a test that branches on a win32 host). Only the
  full suite on Mortals counts as the regression check.

## Accepted, deliberately (review iteration 2)

- **Create checks the display name, not the handle separately.** A handle must match NAME_RE (ASCII letters, digits,
  `_` and `-`) and is the typed name lower-cased with spaces and dots hyphenated, so its key always equals the
  display name's key. Connect does check both, because there the handle comes from a folder name and need not derive
  from the display name.
- **Check-then-write is not atomic.** Two renames to one name in the same instant could both pass. A board is
  driven by one person, and the result is a duplicate this check would then refuse to make worse; a lock across
  create, rename and connect is not worth its cost here.
- **Names written only in non-Latin letters are not compared.** Their key is empty, as it is for @-mentions, which
  ignore them too. Known gap, said on the card.
- **An unchanged name is not re-checked** on the profile route, so an agent that already shares its name (Josh's two
  Geminis, made before this check) can still save a role. Renaming either one now works only to a free name.

## Windows (review iteration 5)

The defect was reported on Windows, where the roster lists only LIVE sessions and there is no created list. So the
fleet also reads Kosmos's Windows session record (engine/win32sessions.js), which keeps every agent Kosmos made there
whether or not it runs. Tested by calling `nameCheckFleet('win32')` with a recorded, stopped agent. The created list on
a Mac or Linux is read strictly (`status.createdKeysStrict`): a source that fails refuses the check rather than reading
as "no stopped agents". `win32sessions.read()` answers {} for an unreadable record rather than throwing, so on Windows
that one source fails open; the roster arm still fails closed.
