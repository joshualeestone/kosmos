# tallprompt-9001: a self-declining safety prompt on a plan file is approved, and one left to a person never buzzes the phone (kosmos#9001 part 1b)

Finished means two things (as built after five review rounds; the first design below was narrowed):
1. Claude Code's own safety prompt ("can't rule out a dangerous removal ... will automatically block this request") on
   a Kosmos agent is approved by Kosmos's allow hook when every .claude or .git name in the command is a plan file under
   .claude/plans and the command neither deletes, moves or links anything, walks out with .., copies a tree, nor uses a
   git verb beyond read-or-record (Josh 10-22 and 21:30 on 11-24; Splinter 21:34, and 22:13 for the allowlist: "no
   widening for now"). Baron's 21:29 command is approved; rm -rf on a .git path stays pending. Reading other parts of
   .claude or .git still waits for a person, as before.
2. One that is left to a person, and is taller than the window, is a card line, not a phone push (Splinter 22:13): part
   1 keyed on the box's header, which a tall box cuts off. engine/status.js selfExpiringCutTail reads the cut box (its
   closing rule, the safety reason and timed line below it, Claude Code's own "↑ N more lines", box rows to the top),
   and the report route ties it by length (the hook's copy hit its cap). Residual: two long Bash prompts at once, a real
   one's report kept back until the safety prompt declines (about two minutes).

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
  every review round's bypasses as cases left to the person; plan-only reads and writes answered; PowerShell aliases;
  controls; size caps with verb-free filler; the real script on stdout.
- engine/status.js selfExpiringCutTail, server.js report route, test-support/claude-screens/
  permission-prompt-self-expiring-tall-2.1.332.txt (the real capture), server.selfexpiring-9001.test.js's 1b tests:
  the tall capture reads as the self-declining prompt and as working; a long report is the plain line with no push, a
  short one is kept and pushed; the timed line inside the box, no scroll hint, a row outside the box, or no reason are
  not it. Mutations (no route branch, no cut box in the check, no scroll-hint or box-row requirement): each red.
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

## Round 4 (sonnet, blind, whole branch): BLOCKERs, and the threat model settled
- Found: a walk out after cd into the plan folder (cd .claude/plans/x && echo > ../../settings.json); the stripper
  hiding a delete the shell runs ('rm', r''m, ssh '...', sed's e flag, a heredoc fed to ssh); code deletes not listed
  (perl unlink(, from os import remove, System.IO, (Get-Item).Delete(), rsync --delete); git verbs that change state
  or behaviour (checkout --, reset, branch -D, submodule, remote set-url, GIT_CONFIG_*, --config-env, --exec-path);
  trees extracted or copied into a plan folder; an 11.5 s pattern in the stripper's checks; reads of the plan folder
  or a glob refused.
- Settled what this guards against: an honest agent's command that VISIBLY reaches .claude or .git, as #5406's rule
  always did, not a hostile one. Obfuscation that hides the name or the verb entirely was answered before this change
  and still is. Four rounds showed a spelling list cannot be complete against obfuscation, so the rules were made
  simpler and stricter, not longer:
  - the stripping of strings and heredoc bodies is GONE: every check reads the full text, and the text as the shell
    joins it (quotes out, escapes and backslash-newlines undone). Cost: plan prose that names a delete ("- rm the old
    file", a commit message "rm old step") waits for a person, as it did before this change. None of the six real
    plan-only commands had such a word (measured).
  - any .. segment anywhere in a command that names a plan: waits.
  - git with a plan named: only add, commit, diff, show, log, status, grep, ls-files, rev-parse, blame, push, fetch
    (the real ones used add, commit, diff, show, grep, ls-files, rev-parse, push); git -c, GIT_CONFIG*/GIT_DIR/
    GIT_WORK_TREE/GIT_EXEC_PATH=, --config-env, --exec-path, --git-dir, --work-tree, alias.: wait.
  - code deletes by any call named like one (remove(, unlink(, rename(, move(...), System.IO, [IO.File], .Delete(,
    .MoveTo(); --delete; tar x, unzip, cp -a/-R/-r, ditto, rsync: wait.
  - the plan folder itself and globs under it count as plan mentions (ls .claude/plans, cat .claude/plans/*.md).
  - COMMAND_MAX 100,000; the worst probe of round 4 now judges in 1 ms (no stripper, no quadratic check).
- Left, with reason: .gitattributes writes (not a protected name; a filter needs config, and config waits); a write
  through a link an earlier command made (making it waits); cp <plan> ~/.zshrc (names no protected place).
- Mutations: no .. rule, no git allowlist, no joined text, no protected-segment check, no delete list: each turns
  permission-mention-9001 red.

## Round 5 (opus, blind, whole branch): nothing above WARNING under the round 4 threat model; fixed after it
- WARNING fixed: git's verb is now the first word after any options (-C/p, -p, --bare, --literal-pathspecs hid it).
  -c in any spelling waits.
- WARNING, part fixed, part accepted: plan prose with ordinary words was refused. The bare word link no longer counts
  (only at the start of a piece, where it is the command; ln and mklink anywhere). Measured by the reviewer: of 1,998
  real plan files fed through as heredoc writes, 286 (14%) were refused, mostly by words in the plan text (rm, mv,
  tar, a git verb, ..). Accepted cost: main refuses all of them today, and the stripping that would spare them hid
  real commands twice.
- NITs fixed: size caps now have tests that fail without them (verb-free filler); a protected name split by quotes with
  no plan named waits (tested); a plan segment made only of dots and globs (.?) is not a plan path; the report hook's
  comment and a test label corrected; this plan's title and "Finished means" rewritten to what is built.
- Noted: git push --force and git push origin :main are answered with a plan named; the damage is to the remote, and
  the same commands without a plan were always answered.
- After the fixes: every status and permission suite (117 files): 1,616 pass, 0 fail, 1 skipped (a live test).
