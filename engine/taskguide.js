'use strict';

/*
 * kosmos#8735 slice 2: how to use the task commands for one situation each, printed by `kosmos task --how` (both CLIs),
 * in a module that requires nothing, as engine/communityguide.js and engine/connectionsguide.js are. The working rules
 * (engine/defaults.js, "Put the work on a task first") keep the rule and the everyday commands (add, list, done-when,
 * check, built) and one line naming these situations; this is the rest, moved word for word: fixing a task's words,
 * listing across projects, a file's fingerprint, a code fix's commit, and a task that repeats on a schedule, and (slice 5) moving an unmet check's part to another task
 * (--moved-to). Two "as
 * above" pointers now say "as your working rules say", since the text they pointed at stayed there.
 * Why: a new agent's instructions were over Claude Code's 40,000-character warning (kosmos#8735).
 */

function guideText() {
  return [
    'How to use the task commands for one situation each. The rule and the everyday commands are in your instructions,',
    'under "How you work, whatever the job", in "Put the work on a task first" ("your working rules" below).',
    '',
  // Put the work on a task first: the parts for one situation each, word for word from the working rules.
  "**If a task's title or detail stops matching the work, fix it:**",
  '`kosmos task edit <project-id> <task-number> --title "<new title>"`',
  '(or `--detail "<new detail>"`, or `--clear-detail`). A task the person wrote, or whose',
  'words they changed, is theirs and the edit is refused: say what changed in its',
  'conversation instead, with `kosmos task message <project-id> <task-number> "<what changed>"`.',
  '',
  '**Moving part of an unmet check to another task** (`kosmos task check ... unmet`):',
  "When an unmet check's part goes to another task, add `--moved-to <that task's number>`",
  'after the words, so both tasks show where it went.',
  '',
  '**To see what is still open across every project,** run `kosmos task list --all`',
  '(one line each, the project first). `kosmos task list --all --stale` keeps the open',
  'tasks with no activity for a week, quietest first (`--stale 14` for two weeks; or',
  'name one project in place of `--all`). `kosmos task list --mine` is the same list',
  'kept to the tasks you hold, in every project you are on.',
  '',
  'If the work is a file, add `--file <path>`: the next agents are sent its fingerprint',
  'to check their copy with `kosmos fingerprint <file>`. For a PDF it leaves out the',
  "PDF's own dates and ID, so two renders of one source match, but it is no byte-for-byte",
  'proof (and a PDF over 64 MB is hashed as plain bytes). Any other file gets the plain',
  'sha256: `shasum -a 256 <file>` on a Mac, `(Get-FileHash <file>).Hash` on Windows (case',
  'does not matter). A PDF marked before this may carry a plain sha256: if `kosmos',
  'fingerprint` does not match it, check it as above. If you change the file, mark it',
  'again with `--file`: your own mark without it drops the fingerprint.',
  '',
  'If the work is a code fix, commit it, then mark it built with `--commit HEAD` (or the',
  'commit it landed as), run in the repository the fix is in. The task keeps that commit',
  'after it closes, so a fix that was checked but never committed shows up. Push it too:',
  'until a remote has it, the task says it is only on this computer.',
  '',
  '**Work that comes back on a schedule is one task that repeats,** not a new task',
  'each time: a report every morning, a check every hour. Add it as your working rules say (or use',
  'the task you were given), with checks for what each run should find, then set',
  'when it is due:',
  '',
  '`kosmos task repeat <project-id> <task-number> daily --at 09:00`',
  '',
  '(or `hourly`, or `weekly --on mon --at 09:00`). **Kosmos shows when each run is',
  'due; it does not start the run for you.** Run it when it is due, and if nothing',
  'will bring you back at that time, tell the person so. **Record each run while',
  'more than 15 minutes remain before the next one is due** (or a quarter of the',
  'time between runs, if that is shorter; a reminder from Kosmos names the time):',
  'if a run (a retry included) is still going then, stop it, record it as it',
  'stands with what stopped it, and start the next run, so one slow run never',
  'holds up the ones after it. After each run, record',
  'what it found and how the checks went:',
  '',
  '`kosmos task ran <project-id> <task-number> "what this run found"`',
  '',
  '**If a run found nothing new, say so with `--unchanged`, and do not post about',
  'it on your own:** the task folds such runs together so the ones that matter',
  'stand out. If someone asks, answer as usual. When a run finds something, tell',
  'whoever asked for the check, where they asked: in the room, or in your reply to',
  'the person; if nobody is asking right now, post it in the room the task belongs',
  'to. A run that could not check is not unchanged: record what stopped it,',
  'without `--unchanged`, and report it (`kosmos report blocked --on "<what',
  'stopped it>"`, or `needs_you`, as your working rules say, if only the person can fix it). When a',
  'later run checks again, `kosmos report clear`; the task keeps its schedule.',
  '',
  '`kosmos task ran <project-id> <task-number> --unchanged "what it checked"`',
  '',
  'A repeating task is never marked built; it stops when someone closes it.',
  ].join('\n');
}

module.exports = { guideText };
