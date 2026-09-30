'use strict';
/* #3595 phase 3: a project's goal, read from its BRIEF.md `## Goal` section (the heading
 * engine/projects.js seeds). Plan: .claude/plans/assigner-goals-3595-2026-09-24.md.
 *
 * `goalFrom(text)` is pure. `readGoal(folder)` reads the file safely: lstat first and refuse
 * anything that is not a regular file (so a symlink is refused), refuse a file over MAX_BYTES,
 * and read through the same descriptor it checked. Every failure is "no goal" (null), never a
 * throw: a goal Kosmos could not read is a goal it must not act on.
 */

const fs = require('node:fs');
const path = require('node:path');
const projects = require('./projects');

/* A real brief is a page or two; anything far larger is not a brief, and reading it whole every
   minute would be waste. */
const MAX_BYTES = 64 * 1024;
/* The goal is quoted into an agent's pane, so keep it to a paragraph. */
const GOAL_MAX = 500;

const HEADING = /^##\s+goals?\s*:?\s*$/i;
/* Undefined on win32 (#1732 fs-const-platform-flag): captured here and ORed in undefined-safe. The
   lstat check above the open refuses a symlink on every platform; the kernel flag is a second
   guard where it exists. */
const NOFOLLOW = fs.constants.O_NOFOLLOW;
const NONBLOCK = fs.constants.O_NONBLOCK;
const NEXT_SECTION = /^#{1,2}\s/;

/**
 * The `## Goal` section of a brief's text, or null when there is none worth acting on: no such
 * heading, an empty section, or the seeded placeholder left in place.
 * @param {string} text
 * @returns {string|null}
 */
function goalFrom(text) {
  if (typeof text !== 'string' || !text) return null;
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => HEADING.test(l.trim()));
  if (at === -1) return null;
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (NEXT_SECTION.test(l)) break;
    body.push(l);
  }
  // C0 and C1 control characters become spaces (the pane refuses both; the Assigner also checks
  // the finished line with chat.messageProblem before asking).
  const goal = body.join('\n').replace(/<!--[\s\S]*?-->/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!goal || goal === projects.BRIEF_GOAL_PLACEHOLDER || goal.includes(projects.BRIEF_GOAL_PLACEHOLDER)) return null;
  const chars = Array.from(goal); // by code point, so a trim never splits an emoji
  return chars.length > GOAL_MAX ? chars.slice(0, GOAL_MAX - 1).join('').trimEnd() + '…' : goal;
}

/**
 * The goal in `<folder>/BRIEF.md`, or null (missing, not a regular file, too large, unreadable,
 * or no goal in it).
 * @param {string} folder
 * @returns {string|null}
 */
function readGoal(folder) {
  const text = readBriefText(folder);
  return text === null ? null : goalFrom(text);
}
/* The brief's text, read safely, or null (missing, not a regular file, too large, unreadable). Shared by
   readGoal and readBrief so the two cannot check the file differently. */
function readBriefText(folder) {
  // Absolute only, as projects.briefIsPending / seedBriefStub: a relative path would resolve against
  // the server's working directory.
  if (typeof folder !== 'string' || !folder || !path.isAbsolute(folder)) return null;
  const file = path.join(folder, projects.BRIEF_STUB_FILENAME);
  let fd;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    fd = fs.openSync(file, fs.constants.O_RDONLY | (NOFOLLOW || 0) | (NONBLOCK || 0));
    const fst = fs.fstatSync(fd);
    if (!fst.isFile() || fst.size > MAX_BYTES) return null;
    const buf = Buffer.alloc(fst.size);
    const n = fs.readSync(fd, buf, 0, fst.size, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
}
/* #4581: the brief's "Done looks like" section, as `kosmos project show` prints it. Any `## Done...` heading
   (the seeded "Done looks like", or a person's own "Done when" / "Done"). A section still holding a seeded
   prompt is not an answer: the stub's prompts are one italic line ending "Replace this line." (the done one, since
   #4583, after a bold "Not set yet."; projects.briefStubContent), and the RULE is matched, not one spelling, so a
   reworded prompt stays a prompt. */
/* ONE heading rule for a Done section, shared by every reader and by projects.fillDone (#4583 review). Level 2 only,
   as #4581 read it: widening it to every level (review round 4) let a "# Done Deal" title or a "### Done so far" note
   capture the section. */
const DONE_HEADING = /^##\s+done\b.*$/i;
const THEMATIC_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
/* #4583: a done left blank is seeded as "**Not set yet.** " before that same italic prompt, so the prompt may carry
   that one bold prefix and still be a prompt (else `kosmos project show` printed the placeholder as the done). The bold
   words left on their own (the italic line deleted) are not an answer either. */
const SEEDED_PROMPT = /^(?:\*\*Not set yet\.\*\*(?: _[^_]*Replace this line\.?_)?|_[^_]*Replace this line\.?_)$/;
function sectionFrom(text, heading, dropLines) {
  if (typeof text !== 'string' || !text) return null;
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => heading.test(l.trim()));
  if (at === -1) return null;
  const body = [];
  for (const l of lines.slice(at + 1)) {
    // A horizontal rule ends it too: the seeded stub puts Kosmos's own footer after one, under Done.
    if (NEXT_SECTION.test(l) || THEMATIC_BREAK.test(l)) break;
    // #4583 review: a seeded placeholder left above or below a person's own words is dropped, whole lines only
    // (projects.placeholderLine's rule), so what is printed is what they wrote.
    if (!(dropLines && dropLines.includes(l.trim()))) body.push(l);
  }
  const words = body.join('\n').replace(/<!--[\s\S]*?-->/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!words || SEEDED_PROMPT.test(words)) return null;
  const chars = Array.from(words);
  return chars.length > GOAL_MAX ? chars.slice(0, GOAL_MAX - 1).join('').trimEnd() + '\u2026' : words;
}
function doneFrom(text) { return sectionFrom(text, DONE_HEADING, projects.BRIEF_DONE_PLACEHOLDERS); }
/* #4583 review: THE one rule for "does this brief say what done looks like", so the board's "Done not set" badge, the
   one-time room note, projects.fillDone and `kosmos project show` cannot disagree. With a Done section (DONE_HEADING) it is
   set exactly when doneFrom finds words in it. With none (a person's own brief, or a heading they retitled), it is set
   unless a seeded placeholder is still a whole line somewhere, so a retitled section still holding it reads unset. */
/* The line range [from, to) of the Done section's body in text.split(/\r?\n/), or null: what fillDone may write in. */
function doneSectionRange(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => DONE_HEADING.test(l.trim()));
  if (at === -1) return null;
  let to = at + 1;
  while (to < lines.length && !NEXT_SECTION.test(lines[to]) && !THEMATIC_BREAK.test(lines[to])) to += 1;
  return { heading: at, from: at + 1, to };
}
function doneSectionIn(text) {
  return typeof text === 'string' && text.split(/\r?\n/).some((l) => DONE_HEADING.test(l.trim()));
}
function doneSetFrom(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (doneSectionIn(text)) return doneFrom(text) !== null;
  return !projects.BRIEF_DONE_PLACEHOLDERS.some((ph) => lines.includes(ph));
}
/* Goal and done in one read: { goal, done, found } where `found` says whether a readable brief was there at all
   (so "no brief" and "a brief with both left blank" are said apart). */
function readBrief(folder) {
  const text = readBriefText(folder);
  if (text === null) return { goal: null, done: null, found: false, doneSection: false };
  return { goal: goalFrom(text), done: doneFrom(text), found: true, doneSection: doneSectionIn(text) };
}
module.exports = { goalFrom, readGoal, doneFrom, doneSetFrom, doneSectionIn, doneSectionRange, readBrief, DONE_HEADING, MAX_BYTES, GOAL_MAX };
