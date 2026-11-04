# tmuxlink-7981: the Linux installer links its own tmux onto itself when run from the installed CLI

Card: #7981. Found by the verb leg on a real board (run 41917651504). `kosmos update --if-newer --install` aborts and leaves the board stopped, once anything newer is served.

## Change
`setup_linux_tmux` asks whether the tmux it found is already what its own link resolves to (`-ef`), and if so leaves it. Nothing else in the installer changes, and `install/kosmos:299` stays: the CLI needs that PATH for everything else.

## Decisions
- **Call: fix the installer, not the CLI's PATH.** The verb downloads the target build's installer, so a fixed installer reaches boards already on 0.7.89. A CLI fix would not reach them, because the old side's CLI is what runs. Rejected: scrubbing PATH in `cmd_update`, for that reason.
- **Call: `-ef`, not filtering PATH.** My first version filtered PATH by physical folder. Review showed it could not see a link one hop away, ran apt-get and could swap tmux under running agents when its own link was the only one on PATH, and needed globbing, IFS and CDPATH handling. `-ef` needs none of that. dash, bash and busybox have it; POSIX has it since 2024.
- **Trade-off, on purpose:** once Kosmos's link is the first tmux on PATH, an update from the installed CLI does not move it to a different system tmux, until that tmux is gone. A login-shell update still would. Swapping tmux under running agents is what breaks live servers (`install/kosmos`, on another version being unable to read one).
- **Limit:** run from a login shell whose PATH has no tmux, a working link is not consulted, and it refuses or uses apt-get, as it always has. Not this card's path.

## Weakest premise
That a fixed setup.sh in 0.7.90 repairs a 0.7.89 board, since the 0.7.89 CLI still does the running. Read from `cmd_update` and `run-setup`, not measured. Splinter's requirement measures it: a real 0.7.89 board updating to 0.7.90 and coming back up, in that release's checks.

## What would change my mind
That measurement failing. Then 0.7.89 boards need their own way out.

## Measured
tools/test-setup-linux-tmux-7981.sh runs the real function under `sh`. Before the fix it failed with the card's exact error, so the mechanism is reproduced, not only read. It runs on macOS here; CI's Linux shards run it too.

## Not measured
The whole path on Linux with this fix: the served installer is what a real board runs, and this cannot be served before a cut.
