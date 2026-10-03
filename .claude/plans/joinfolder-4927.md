# joinfolder-4927: the join notice never hands an agent a folder that is not there

Card: kosmos#4927 (daily feedback, one install, 09-30 and 10-01): the notice telling an agent it joined a project gave a folder path that did not exist where it worked; the files were under a different mounted path, and mount names can change between sessions.

## The open question, decided (on the card, comment 5945754688)
The "different mounted path" is the agent's own sandbox, not Kosmos. Kosmos launches every agent on the computer itself, in a tmux pane, with real paths; nothing in engine/ remaps a folder. Mount names that change between sessions are the shape of a sandboxed agent that sees this computer's folders through mounts. Kosmos cannot see inside that sandbox, so it cannot show "the folder as the agent will see it".

## Done looks like
- An agent is never handed a project folder that is not on this computer as a place to work: the join line says it is not there and to ask the person.
- An agent is told the paths are this computer's, and a sandboxed agent is told how to find the folder under its own mounts (by its name).

## Change (engine/projects.js)
- `folderSentence(project)`: used by the join line and the "now listed" line, read through the board's one folder check `folderState` (as the project page reads it). READABLE: "Its folder on this computer is `X`." UNREADABLE (it is there, the board may not look in: a locked parent, macOS privacy for the board's process): the path, and "check that you can open it". MISSING or NOT_A_FOLDER: "is not on this computer right now (moved, removed, or on a drive that is not connected), so ask your person".
- "Your projects" (every agent's instructions): "the folder it has recorded for each, on this computer" (not re-checked against the disk on purpose: a drive coming and going would rewrite every agent's file), plus: a sandboxed agent finds the folder by the folder's own name, the last part of its path (it can differ from the project's name).
- engine/projectview.js: `kosmos project show` (Mac and Windows, one renderer) notes a folder that is not there or cannot be looked in, so it does not hand back a path the join line called gone.

## Decisions
- Rejected: asking each agent to report its view of the folder and comparing (a round trip per join, and a sandbox would report its own mount names anyway); resolving mounts on the host (Kosmos does not know the sandbox).
- The check is a plain stat at the moment the line is written; a folder that comes back later is listed normally on the next line or splice.
- Weakest premise: that the report came from a sandboxed agent (the report names no runner or version). A Kosmos-launched agent on a normal install seeing another path would be a real bug, and the decision should be reopened.

## Review
- Round 2: NO BLOCKER or WARNING; nits taken (an unreachable folder is not said to be "on this computer", the payload key named folderStatus, project show says to check it). Converged.
- Round 1: unreadable folder called gone (fixed via folderState), section heading certified an unchecked path (softened), project show unchecked (noted), name vs folder name (reworded), wrapped-sentence test (flattened). Accepted: the one-time rewrite of every agent's file for a wording change (as #4887), and the synchronous stat (as every folderState read).

## Validation
- engine/projects.test.js: a real folder reads "on this computer"; a missing folder and a file in its place read "not on this computer right now" for both the join and the listed line; the section carries both sentences. Each fails with its rule removed (measured).
- The project suites (engine projects*, server and CLI project tests, federation, dmfiles, worldimport) and the file-scanning guards: 587 run, 0 failed (after review 1); the touched suites 211, 0 failed after review 2.
