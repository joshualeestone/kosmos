# oldjob-8294: connect warns once when another login job looks like it starts this agent

Found by the #8290 throwaway test: with the old `com.<name>.discord` job loaded, two Claudes ran in one folder and the board showed one row.

## Change
engine/register.js foreignStarter, built on that file's existing LaunchAgents reader (plistKeys, scriptText, protectedPath, mentionsFolder): the first login job outside Kosmos that starts by itself, names this agent's program, and is tied to this folder. connect then refuses once, naming the job and its file. Pressing Add again goes ahead (`anyway`).

## Why a warning the person can override
Seven review rounds each found a new shell-script shape my text matching got wrong, in both directions, and a hard refusal made a wrong match cost someone a working job. A script cannot be read reliably, so the decision moved to the person, and the code reuses the survey's reader rather than a third parser. Rejected: more parsing; unloading the job from the board.

## Measured
On this Mac: finds 17 of 17 fleet agents, nothing for the repo checkout or six worker folders with no job.

## Weakest premise
Heuristic in both directions. A miss is today's behaviour; a false match costs one more press. A plist in binary form past the reader's four-per-call conversion budget is not examined.

## Not covered
Mac only: the check reads the LaunchAgents folder, so on Linux and Windows it always answers none.
The card's second ask, the board noticing two copies, is not built here. A job added after connecting can still start a second copy. A folder with no instructions file is registered without a job, so it starts nothing.
