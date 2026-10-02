# joinfolder-4927: the join notice never hands an agent a folder that is not there

Card: kosmos#4927 (daily feedback, one install, 09-30 and 10-01): the notice telling an agent it joined a project gave a folder path that did not exist where it worked; the files were under a different mounted path, and mount names can change between sessions.

## The open question, decided (on the card, comment 5945754688)
The "different mounted path" is the agent's own sandbox, not Kosmos. Kosmos launches every agent on the computer itself, in a tmux pane, with real paths; nothing in engine/ remaps a folder. Mount names that change between sessions are the shape of a sandboxed agent that sees this computer's folders through mounts. Kosmos cannot see inside that sandbox, so it cannot show "the folder as the agent will see it".

## Done looks like
- An agent is never handed a project folder that is not on this computer as a place to work: the join line says it is not there and to ask the person.
- An agent is told the paths are this computer's, and a sandboxed agent is told how to find the folder under its own mounts (by its name).

## Change (engine/projects.js)
- `folderSentence(project)`: used by the join line and the "now listed" line. A directory at the path: "Its folder on this computer is `X`." Otherwise (missing, a file, unreadable): "Its folder `X` is not on this computer right now (moved, removed, or on a drive that is not connected), so ask your person where it is before you work in it."
- "Your projects" (every agent's instructions): "this is where their folders are on this computer", plus one sentence: a sandboxed agent finds a project's folder there by its name, the last part of its path.

## Decisions
- Rejected: asking each agent to report its view of the folder and comparing (a round trip per join, and a sandbox would report its own mount names anyway); resolving mounts on the host (Kosmos does not know the sandbox).
- The check is a plain stat at the moment the line is written; a folder that comes back later is listed normally on the next line or splice.
- Weakest premise: that the report came from a sandboxed agent (the report names no runner or version). A Kosmos-launched agent on a normal install seeing another path would be a real bug, and the decision should be reopened.

## Validation
- engine/projects.test.js: a real folder reads "on this computer"; a missing folder and a file in its place read "not on this computer right now" for both the join and the listed line; the section carries both sentences. Each fails with its rule removed (measured).
- The project suites (engine projects*, server and CLI project tests, federation, dmfiles, worldimport) and the file-scanning guards: 559 run, 0 failed.
