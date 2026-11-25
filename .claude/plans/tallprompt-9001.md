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
- engine/kosmos-permission-allow.js (after review round 1, see below): for Bash and PowerShell only the command
  decides. It is answered when its only protected names are plan files under .claude/plans (a plan path holding ..
  does not count) and no piece of it deletes or moves (rm, rmdir, unlink, shred, trash, mv; Remove-Item, Move-Item,
  Rename-Item; find -delete or -exec; git clean, rm, mv; rmtree, rmSync, os.remove and the like). Any other protected
  name keeps #5406's rule. A piece over 8,000 characters is left to the person. File tools are unchanged.
- engine/permission-mention-9001.test.js: Baron's command (shape kept, paths nowhere) approved; rm -rf on .git not;
  11 plan-file cases approved; 26 left to the person (other protected names including review round 1's bypasses, a
  plan path with .., deletes and moves even of a plan); controls; a timing case; the real script on stdout.
- engine/agentpermission-5406.test.js: unchanged (main's version; its rule still holds for every name but a plan
  file). report-hook-shapeguard-9001.test.js: its "the allow hook steps aside" arm now comes from a command
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

## Round 1 (opus, blind): BLOCKERs, and the design narrowed
- The first rule (approve any mention; refuse a listed delete, move or shell write) was leaky. Approved by it and not
  wanted: a plan path walked out of with .. (> .claude/plans/../settings.json), quoted paths (> /p/".git"/HEAD), >|,
  dd of=, curl -o, tar --remove-files, git config --file .git/config, git --git-dir=.git reset --hard, reflog
  expire, worktree remove, interpreter one-liners (shutil.rmtree, fs.rmSync), PowerShell Set-Content and
  [IO.Directory]::Delete. And its find/git patterns backtracked: about 35 s on a 450 KB command.
- Narrowed instead of patched: only plan files are answered, which is what the evidence is (6 of the 9 real ones
  named only plan files; Baron's 21:29 included). Every probe above is now left to the person (rerun on the
  reviewer's own probe scripts; the ones still answered name no protected place at all, answered before this change
  too, or touch only a plan file). The two other real reads (git diff -- .claude, a transcript under .claude-account-f)
  keep the old rule: a deliberate narrowing of Splinter's "reading is approved".
- Over-catching from round 1 fixed: del (Python) and the PowerShell short aliases (rd, ri, mi, del) no longer count,
  and a delete is judged per piece (split on ; & | and newlines), so a plan read plus a /tmp cleanup on another piece
  still waits only because rm is there (kept: deleting stays a person's call when the command names a plan).
- Mutations: approve all, the old rule, no .. check: each turns permission-mention-9001 red.

## Round 2 (sonnet, blind, whole branch): three BLOCKERs, fixed
- The plan-path pattern swallowed what the shell acts on, so a .git or a .. inside it was erased from the check:
  .claude/plans/x.md$IFS.git/hooks/pre-commit, brace lists ({.claude/plans/a,/p/.git/HEAD}, plans/{a,../x}),
  $(echo ..), $X, '..', .""., .\. and a colon all passed. Now a plan path is plain filename characters only, in
  segments, none made only of dots, and must end cleanly (the end, whitespace, an operator, or a closing quote then one
  of those or a comma or closing bracket, as in a python call). Anything else attached means it is not a plan path.
- A link through the plan folder (ln -sfn ... .claude/plans/l, then a write under it) passed: ln, mklink, symlinks
  and junctions in any form now leave it to the person.
- Over-catch (WARNING) fixed: plain deletes and moves are judged on the command with quoted strings and heredoc bodies
  taken out, so a plan's own words ("- rm the old file", a commit message "rm old step", a PR title) no longer send it
  to the phone. When the command hands text to a shell (sh -c, a heredoc fed to bash, | sh, eval, xargs, source),
  the full text is judged after all, so sh -c "rm -rf .claude/plans" still waits. Interpreter deletes and links are
  always judged on the full text.
- Every probe in both rounds' scripts is now left to the person except plan-only reads and writes; inputs of 1.6 MB
  judge in about 2 ms.
- Mutations: the round 1 pattern back; no shell-runs-text rule; no stripping: each turns permission-mention-9001 red.
- Still over-caught, accepted: a bare rm word as an argument outside quotes (grep -c rm .claude/plans/x.md).

## Round 3 (opus, blind, whole branch): BLOCKERs, fixed; what it is and is not, said plainly
This is a seatbelt against commands that visibly reach .claude or .git, as #5406's rule always was, not a sandbox:
a command that hides the name entirely was answered before this change and still is. Fixed where this change made a
command newly answered:
- A plan path with a protected segment inside (.claude/plans/x/.git/hooks/pre-commit) is not a plan path.
- Links made without ln: os.symlink, pathlib symlink_to/hardlink_to, fs.symlink and fs.link (sync, async, promises),
  link, cp -s or -l, rsync --link-dest. Deletes by other verbs: pathlib .unlink() and .rename(, fs/promises rm,
  File.delete, tar --remove-files, rsync --remove-source-files, truncate, gzip/bzip2/xz in place, zip -m, git stash,
  cmd /c, [IO.File]::Delete and ::Move; git config (core.hooksPath runs code). PowerShell's del, rd, ri, mi and the
  like count for a PowerShell call only (in Python, del is a keyword).
- The stripper (strings and heredoc bodies taken out before the plain delete check) runs only when nothing in the
  command can run text (any interpreter or shell by name or path, system/exec/spawn/popen/subprocess, git -c, alias.,
  env -S, $( or a backtick, eval, xargs, source) and only when it reads the text as the shell would (no escaped quote,
  $'...', <<<, $((, carriage return, a quote left open, a << after a comment mark or only inside quotes, or a heredoc
  tag that is not a whole word). Otherwise the full text is judged.
- A protected name split by quotes or a backslash (.g'i't, .cl\aude) is seen: the text is also checked as the shell
  joins it (PowerShell: backtick escapes, its backslashes are separators).
- Size: a command over 200,000 characters that names a protected place is left to the person, and the per-piece cap
  applies after stripping too. Adversarial inputs of 1.5 MB judge in 2 to 4 ms.
- Left, with reason: a write through a link that an EARLIER command made (making the link now waits for a person);
  cp <plan> ~/.zshrc and other writes that name no protected place (answered before this change).
- Mutations: each of the four fixes (protected segment, joined text, the strip conditions, PowerShell aliases)
  turns permission-mention-9001 red when taken out.
