# oldjob-8294: connect refuses while another launch job would start a second copy

Found by the #8290 throwaway test: with the old `com.<name>.discord` job loaded, two Claudes ran in one folder and the board showed one row.

## Change
engine/discover.js otherJobFor reads the LaunchAgents folder and connect refuses, naming the job and what to do, when a job starts by itself (RunAtLoad or KeepAlive), is not disabled, starts this agent's own program, and is tied to this folder by WorkingDirectory, a path argument, or text in its arguments or launch script. The Found row already shows the refusal.

## Measured
On this Mac: finds 17 of 17 fleet agents (4 of them only through the launch script, which my first version missed), and nothing for the repo checkout or a shorter folder-name prefix.

## Decided
- Refuse rather than warn and offer to turn it off. Turning off someone's job from a board button is a bigger act, and the refusal is one step to clear. Rejected: unloading it ourselves.
- Any plist on disk counts, loaded or not: launchd loads it at the next login, which is the case that was measured.
- Mac only: Linux and Windows have no such folder, so the answer there is none.

## Weakest premise
Only plain-text plists are read (89 of 89 here are). A script called by a script is not followed, a folder spelled through a variable other than HOME is missed, and a job that starts the agent some other way reads as none: those keep today's behaviour.

## Not covered
The card's second ask, the board noticing two copies, is not built here: connect is the only door this closes. A job added after connecting can still start a second copy.
