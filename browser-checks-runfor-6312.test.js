'use strict';

/**
 * kosmos#6312: the nightly full browser-check run was cut off at its time limit because two checks moved a page clock
 * forward by hours with `clock.runFor`. runFor fires every timer due in that span one by one, and a board page has
 * frequent ones, so seven fake hours took 19 real minutes on the CI runner (about 2.7 seconds a fake minute).
 * `clock.fastForward` jumps and fires each due timer at most once.
 *
 * This holds every `clock.runFor(...)` in docs/browser-checks to MAX_FAKE_MINUTES. An argument it cannot evaluate
 * (anything but numbers, + - * ( ), and H for an hour) fails too, so a new shape is never passed unread.
 *
 *   node --test browser-checks-runfor-6312.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'docs', 'browser-checks');
const MAX_FAKE_MINUTES = 30;

/** Every runFor call's argument text, with its file and line. */
function runForCalls(src) {
  const out = [];
  const re = /\.clock\.runFor\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    out.push({ arg: src.slice(start, i - 1).trim(), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** Fake milliseconds, or null when the argument is not a plain arithmetic expression. */
function msOf(arg) {
  if (!/^[\d\s.e+\-*()H]+$/.test(arg)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = new Function('H', 'return (' + arg + ');')(3600e3);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

test('#6312: the argument reader handles every shape it claims to (controls)', () => {
  assert.equal(msOf('12 * 60e3'), 12 * 60e3);
  assert.equal(msOf('7 * H + 50 * 60e3'), 7 * 3600e3 + 50 * 60e3);
  assert.equal(msOf('waitMs'), null, 'a name it cannot evaluate must not read as a number');
  assert.equal(msOf('process.exit(1)'), null);
  const calls = runForCalls('await p.clock.runFor(7 * H); await q.clock.runFor(\n  2 * (60e3)\n);');
  assert.deepEqual(calls.map((c) => c.arg), ['7 * H', '2 * (60e3)'], 'a multi-line or nested argument is read whole');
});

test('#6312: no browser check runs a page clock forward more than ' + MAX_FAKE_MINUTES + ' fake minutes with runFor', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  let seen = 0;
  const bad = [];
  for (const f of files) {
    for (const c of runForCalls(fs.readFileSync(path.join(DIR, f), 'utf8'))) {
      seen++;
      const ms = msOf(c.arg);
      if (ms === null) bad.push(`${f}:${c.line} runFor(${c.arg}): not a plain number, so its length cannot be checked; write it as one`);
      else if (ms > MAX_FAKE_MINUTES * 60e3) bad.push(`${f}:${c.line} runFor(${c.arg}) is ${(ms / 60e3).toFixed(0)} fake minutes; use clock.fastForward for a jump`);
    }
  }
  // A reader that matched nothing would pass every file: there are dozens of runFor calls today.
  assert.ok(seen >= 20, 'CONTROL: found only ' + seen + ' runFor calls; the reader has stopped matching');
  assert.deepEqual(bad, [], 'long runFor calls:\n  ' + bad.join('\n  '));
});
