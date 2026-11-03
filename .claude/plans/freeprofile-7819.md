# freeprofile-7819: delete what is left takes the agent's profile and picture

Card: joshualeestone/kosmos#7819 (claimed by Renet Tilley, given by Splinter 11-02). Follow-up to #7755.

## Why
`engine/delete-leftover.js` frees a name but left `<data root>/profiles/<key>.json`. `store.writeProfile` keeps a stored
`id` (#170) and every field a patch does not write, so a new agent under the freed name inherited the old `id`, `dir`,
accounts and provider. The picture (`avatars/<key>.<ext>`) is keyed the same way, so it carried over too. And two readers
treat any `profiles/*.json` as live: `register.known()` and `discover.folderHolders` (its `dir` stays held).

## The call
Move the profile and the picture with the files: to the Trash where the folder goes there, deleted for good where not.
- Rejected, retire in place like #4994: a community account is remote and public; a profile is a local file that live
  readers enumerate, so a retired copy left in `profiles/` keeps the agent half alive.
- Rejected, clearing in `create`: worldstarts writes `policyHeld`/`provider` before a held create retries, so create
  cannot tell a stale profile from a deliberate one.
- Order: second in `del`, after the standing reset and before the folder and job, because once those are gone `plan()`
  refuses and a failed later step could never be retried. A failure refuses the whole delete.
- Never another agent's file: keyed by `store.safeKey`, so a live session or an existing folder with the same key keeps
  it, and the step says so.
- `plan()` names it in `loses` ("Its settings[ and picture]: a new agent with this name starts without them").

## Weakest premise
Profiles already stranded with no folder or job (the Windows box's `b55-1.json`) are not reachable: `plan()` refuses a
name with nothing but a profile. Not built here.

## Tests
engine/delete-leftover.test.js, four #7819 tests (the card's done-when: create, remove, delete, create again; new id, no
old field; the picture; a shared stored name kept; an unmovable profile refuses the whole delete and can be retried).
Mutation: no move reds three; no shared-name guard reds the fourth. All 13 test files that use delete-leftover: 570 pass.
