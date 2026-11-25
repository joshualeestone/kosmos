# tallprompt-9001: Kosmos approves a safety prompt whose command only mentions .claude or .git (kosmos#9001 part 1b)

Finished means: Claude Code's own safety prompt ("can't rule out a dangerous removal ... will automatically block this
request") on a Kosmos agent is approved by Kosmos's allow hook when the command only mentions, reads or greps a
protected place (.claude, .claude.json, .git), as Josh ruled on 10-22 and asked again at 21:30 on 11-24. A command that
deletes, moves or (outside a plan file) writes one still waits for a person (Splinter's narrowing, 21:34). Baron's
21:29 command is approved; rm -rf on a .git path stays pending.

## Measured (11-24, Claude Code 2.1.332)
- Baron's 21:30 phone push: his command (33 lines, a python heredoc editing release/whats-new-pool.json and a plan
  under .claude/plans) drew the safety prompt. Reproduced with paths pointed nowhere, at his 80x24: the box's top,
  with its "Bash command" header, is cut ("↑ 47 more lines"), so part 1's screen check (needs that header) read false
  and the push went out. Kept as scratchpad/tall-screen-2.1.332.txt.
- The cause of the prompt reaching anyone: the allow hook stayed silent because the text named .claude. Its rule
  (#5406) covered any string in the request; 8 of the 9 real safety prompts on this Mac named .claude or .git.
- A PermissionRequest hook answering allow still passes the safety prompt on 2.1.332: with it Baron's command ran
  (then failed on the missing path); without it Claude Code refused (`claude -p`, bypass, user settings left out).

## Built
- engine/kosmos-permission-allow.js: for Bash (and PowerShell) only the command decides. It is left to the person
  when it names a protected place AND either deletes or moves (rm, rmdir, unlink, shred, trash, mv and PowerShell's
  Remove-Item, Move-Item, Rename-Item and aliases; find -delete or -exec rm; git clean, rm, mv), or writes one with the
  shell (a redirect or tee into it; cp, ln, install, rsync, ditto, truncate, chmod, chown, sed -i, perl -i on a line
  naming it), a plan file under .claude/plans excepted for writes. File tools keep #5406's rule unchanged.
- engine/permission-mention-9001.test.js: Baron's command (shape kept, paths nowhere) approved; rm -rf on .git not;
  9 mention cases approved, 24 delete/move/write cases not, controls, the real script on stdout. Two mutations
  (approve everything; the old rule) each turn it red.
- engine/agentpermission-5406.test.js: three Bash rows that only mention or read a protected place move to the
  answered list. report-hook-shapeguard-9001.test.js: its "the allow hook steps aside" arm now comes from a command
  that deletes under .git (a description no longer decides); a plan mention now runs.
- install/kosmos-report-hook.sh: one comment sentence brought up to date.

## Rejected
- Fixing part 1's screen check for a cut box (the first idea, Splinter's question): it would hide the prompt and let
  it decline, the opposite of Josh's words. The screen gap stays recorded; a prompt that is left to the person and is
  taller than the window is #8952 slice (d)'s job (it grows the window so the whole box and Allow show; merged, ships
  in 0.8.22).
- Answering every Bash prompt that names a protected place: deleting .git or an agent's .claude has no undo.
- Allowing writes into .claude/settings*.json or .git/hooks: that is an agent rewriting its own config or a git hook.

## Weakest premise
A text heuristic. A delete through a variable still waits when the name is in the text (D=/p/.git; rm -rf "$D": measured,
it waits, because a delete anywhere plus the name anywhere is enough). A path built so the name never appears, or a
script file that deletes .git, is not seen; neither was it before this change, when such a command was approved too.
It is a seatbelt on a prompt Josh asked to have answered, not a sandbox.
