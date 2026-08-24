'use strict';

/**
 * #147: a comment may record what was done and in which PR; it may not
 * assign FUTURE work to a number, because a number in a comment reads as
 * owned and appears on no list. Seven comments once deferred three real
 * features to merged version-bump PRs, and the features sat orphaned for
 * days (one of them a thing Josh had asked for twice).
 *
 * The scan is the card's own re-derive pattern. Matches inside straight
 * double quotes are exempt: a correction that RECORDS a dead clause quotes
 * it verbatim, and the record is the cure, not a recurrence.
 *
 *   node --test comment-deferral.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAT = /(remains|stays with|arrives with|owns|replaces? all of this in|waits on|lands with)\s*#\d+|#\d+\s+(owns|carries|covers|will\b)/g;

function exempt(line, at) {
  /* Two exemptions, both narrow and both stated with their cost.
     (1) Any straight double quote on the line: a correction that RECORDS a
     dead clause quotes it verbatim, and quoted spans wrap lines, which
     defeats parity counting. The cost is a deferral hiding on a line that
     happens to quote something; the benefit is corrections keeping their
     evidence. (2) "from #N covers/carries": naming the PR a shipped
     behaviour CAME from is a record, which the card explicitly allows. */
  if (line.includes('"')) return true;
  const before = line.slice(0, at);
  return /from\s*$/.test(before);
}

function violations(text) {
  const found = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of lines[i].matchAll(PAT)) {
      if (exempt(lines[i], m.index)) continue;
      found.push((i + 1) + ': ' + lines[i].trim().slice(0, 120));
    }
  }
  return found;
}

const FILES = ['web/index.html', 'server.js',
  ...fs.readdirSync('engine').filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => path.join('engine', f))];

test('no comment assigns future work to a number (#147)', () => {
  const all = [];
  for (const f of FILES) {
    const v = violations(fs.readFileSync(f, 'utf8'));
    for (const line of v) all.push(f + ':' + line);
  }
  assert.deepEqual(all, [],
    'a comment defers work to a number, which reads as owned and appears on no list; name the open card or say nothing owns it');
});

test('CONTROL: the scan flags a planted deferral, and the quote exemption is not a hole', () => {
  /* An empty violation list is also what a dead regex produces. */
  const planted = violations('/* the manual toggle stays with #40 */');
  assert.equal(planted.length, 1, 'the scan did not flag a planted deferral, so the zero above proves nothing');
  const recorded = violations('/* the dead clause read "that arrives with #59" and was corrected */');
  assert.equal(recorded.length, 0, 'a quoted record was flagged, so corrections would have to erase their evidence');
  const past = violations('/* the PM briefs on its own (#68) */');
  assert.equal(past.length, 0, 'a past-tense record was flagged; the ban is on future tense only');
  const origin = violations('/* the engine-stale line from #338 covers the disk case */');
  assert.equal(origin.length, 0, 'naming where shipped behaviour came from was flagged; that is a record');
});
