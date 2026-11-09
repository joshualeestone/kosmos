# oldjob-8294: connect refuses while another launch job would start a second copy

Found by the #8290 throwaway test: with the old `com.<name>.discord` job loaded, two Claudes ran in one folder and the board showed one row.

## Change
engine/discover.js otherJobFor reads the LaunchAgents folder and connect refuses, naming the job and what to do, when a job starts by itself (RunAtLoad or KeepAlive), is not disabled, starts this agent's own program, and runs it in this folder: by WorkingDirectory, or because the last cd or tmux -c before the start names the folder or a variable holding it. A `<name>-discord` session still up is refused by connect's existing running check, which reads that spelling as the same agent. The refusal appears when Add is pressed, through the row's existing failure arm (`said.textContent = out.because`).

## Measured
On this Mac: finds 17 of 17 fleet agents (4 of them only through the launch script, which my first version missed), and nothing for the repo checkout or a shorter folder-name prefix.

## Decided
- Refuse rather than warn and offer to turn it off. Turning off someone's job from a board button is a bigger act. The refusal names the job and its file; clearing it takes someone who can stop a job. Rejected: unloading it ourselves.
- Any plist on disk counts, loaded or not: launchd loads it at the next login, which is the case that was measured.
- Mac only: Linux and Windows have no such folder, so the answer there is none.

## Weakest premise
Only plain-text plists are read (89 of 89 here are). A script called by a script is not followed, a folder spelled through a variable other than HOME is missed, and a job that starts the agent some other way reads as none (npx or node on the claude-code package, a backslash-escaped space in a path, an Antigravity job whose program is agy): those keep today's behaviour.

A read that fails, or a binary plist, counts as no job: today's behaviour, not a refusal, because a refusal could not be cleared by anyone who cannot see what we could not read.

## Not covered
A folder with no instructions file is registered without a job, so it starts nothing and is outside this.
The card's second ask, the board noticing two copies, is not built here: connect is the only door this closes. A job added after connecting can still start a second copy.
