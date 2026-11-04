# renamefolder-7968: offer to rename a project's folder to match its name

Card: #7968. A project given a real name keeps its starter folder name, so a person browsing their folders cannot recognise it.

## Change
- Project settings shows "Rename the folder" when the project's folder is directly under the Kosmos projects root, its name differs from what the project's name would give, and it is there.
- `PUT /api/project/<id> {renameFolder: true}`: screen only, sent alone. `projects.renameFolderToName` renames in place. Members are told the way the existing folder move tells them (`answerFolderMoved`, the same code).

## Decisions
- **Call: the id never changes.** Agents' membership, open URLs and id-keyed stores all point at it. Rejected: renaming the id as the card's other option, which would mean moving every one of those.
- **Call: an offer, never automatic.** A person may have the folder open or have scripts pointing at it.
- **Call: only folders directly under the projects root.** A folder elsewhere is one the person pointed Kosmos at. A folder the person made under the root and Kosmos adopted is offered too: nothing records who made it, and it is only an offer.
- **Call: refuse unless every member is idle or stopped.** An agent mid-write, or paused mid-turn at a question or a rate limit, could recreate the old folder beside the new one when it resumes. Rejected: renaming anyway and relying on the typed line, which arrives after the write that matters.
- **Call: refuse when an agent's home is this folder or inside it,** which would break its launch job and transcript location, **or when another project is inside it,** whose record would then point nowhere. A home that merely contains the folder is fine.
- **Refuse if the roster cannot be read,** since then neither of those can be checked.

## Weakest premise
"Busy" comes from the board's card state, a reading at one moment. An agent can start working right after it. The typed line and rewritten instructions are then all that tell it, and a stray recreated folder is the worst outcome: visible and harmless to the work already moved.

## Stale paths that stay stale
Past room notes, receipts, undo records and agents' own notes keep the old path. A folder move has the same limit today. Undo flags those files as moved rather than restoring them.

## What would change my mind
A report of a stray old folder after a rename, or of a rename refused for an agent that was not really working.

## Not measured
On Windows, where an open handle should make the rename fail. It is mapped to a refusal, and tested with a stubbed EBUSY only. A running Gemini member keeps its launch-time workspace until restart, as with a folder move today.
