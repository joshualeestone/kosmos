# linux-promote-ci-verb-7941: measure the update verb on a real Linux board

Card: #7941. Needed by #7981: Splinter's requirement for 0.7.90 is that a 0.7.89 board updates to 0.7.90 and comes back up, measured.

## Change
A `verb` leg in `tools/promote-check-legs-7933.sh` and a `verb` job in `linux-promote-check-7933.yml`.
- `VERB_OLD=<version>`, from the dispatch input `old_version`: installs that build with `KOSMOS_PINNED_VERSION`, then runs the installed CLI's `update --if-newer --install` and requires `updated <staged>`, a new systemd MainPID that owns the listener, the staged version loaded, the project kept, the channel still staging, and app/ read-only again.
- Unset: on the staged build alone, `current`, then stamped older to reach the install path.

## Decisions
- **Call: the job runs only when asked, or on a linux-promote-ci-* push.** The #7942 gate requires a run that concluded success, so a verb job in every promote check would turn an ordinary check red for a verb nobody asked about, and block a promote. Rejected: making it part of `all` and `record`.
- **Call: a red verb run on a dispatch with old_version also fails that run's gate lookup.** Accepted: if someone asked and the update path is broken, a promote from that run should not pass. A dispatch without the input records as before.
- **Rejected:** `curl /setup` to reach the old side, which installs prod, not the previous cut.

## Weakest premise
The old side's app and CLI are that build's, but the installer that lays them down is today's. So this does not prove an install made by 0.7.89's own installer updates. Nothing in that installer's output should differ for this path, read and not measured.

## What would change my mind
A real 0.7.89 install differing from a pinned one in anything the update reads.

## Measured
On branch runs: run 41917651504 reached the install path stamped and showed #7981. On the current staged installer the stamped run is expected to stay red until a cut carries that fix.

## Not measured
The VERB_OLD mode: nothing older with the verb exists until 0.7.90 is staged.
