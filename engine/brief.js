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
    return goalFrom(buf.subarray(0, n).toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
}

module.exports = { goalFrom, readGoal, MAX_BYTES, GOAL_MAX };
