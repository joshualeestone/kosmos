# Plan: `kosmos handoff` facts-only prefill (kosmos#6506)

## Goal (what is true when done)
A read-only `kosmos handoff` CLI command exists on both the Mac (`install/kosmos`)
and Windows (`tools/windows/kosmos-cli.js`) commands. Run by an agent whose context
is filling up, it prints the FACTS a handoff otherwise reconstructs by hand, shaped
to paste into the same per-agent handoff file the board's "Write a handoff, then
restart" flow uses. It writes nothing, changes no state, and needs no board.

## Why
From an agent feedback report (2026-10-18): an agent writes its handoff by hand and
the reconstructed facts go stale. A command that prefills the measurable facts lets
the agent spend its judgement on the parts only it can write.

## What it prints (the card's scope ruling, facts only)
1. the agent's live self-report state (engine/selfreport.js), "never reported" when
   absent, never a default "idle";
2. a sha256 for each artifact path the agent names, honest on a missing, directory or
   unreadable path, with a path that contains spaces kept intact;
3. when its instruction file last changed (engine/instructions.js `staleness`), with a
   bad or epoch mtime reading "cannot tell", never 1970;
4. whether the cwd is a git repository, with "not a git repository" kept distinct from
   git being absent and from git erroring.

The handoff CONTRACT is reused verbatim from `engine/autohandoff.js` HANDOFF_CONTENTS,
so there is no second copy to drift. The measuring + rendering live once in
`engine/handoff.js`, called by both CLIs.

Out of scope (card ruling 2, deferred): the assigned-task LIST across projects. There
is no agent-token route for "all my tasks" (`GET /api/tasks` refuses a tokened caller
with no `?project=`; `/api/projects/overview` is unscoped), so the self-report is the
task state this measures. The card stays open for the deferred part (`Addresses #6506`).

## Finished looks like
- `node --test engine/handoff.test.js cli.handoff-6506.test.js` green.
- `cli.help-lines-4785.test.js` and `tools.windows-kosmos-cli-verbs-parity.test.js` green
  (the new verb has a Mac help row, a Windows twin, and matching words).
- A full local `tools/run-tests.sh` green on the PR head (the #6507 exemption only as PM
  described), and CI green by name.
- Raiden's independent review with no blocker.

## Weakest part of my own reasoning
The scope call that "the agent's live tasks and their states" means the self-report
rather than the assigned-task list. I reasoned it from the API shape (no clean
agent-token "my tasks" route) and Raiden's axis 2; the PM accepted it and deferred the
list on the card. If "live tasks" was meant as the task list, this under-delivers, and
the fix is additive (a project arg or the instructions' project ids).
