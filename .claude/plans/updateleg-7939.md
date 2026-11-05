# updateleg-7939: the Linux promote check's update leg reads #7939's manual command

The 0.7.92 promote check (run 42104565121) failed its update leg with "the prod board's own check does not offer
0.7.92". The board was right: since #7939 (in 0.7.91) a Linux board, which cannot replace itself (#7935), answers
`manual: { version, command }` instead of an `offer`. The leg still required `offer`, so it stopped before the
part it exists for (the served installer over a prod install, keeping its project).

Change: the leg accepts the staged version as an `offer` or as the `manual` command; anything else still fails.
Weakest premise: nothing tests the legs script itself; the proof is a workflow run from this branch.
