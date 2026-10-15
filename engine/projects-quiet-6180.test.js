'use strict';

/**
 * #6180: offWriteIsQuiet decides whether the write that takes an agent off its last project is quiet (no stale
 * triangle on the board). Quiet unless something else is already waiting that Kosmos did not record (a person's edit),
 * which the quiet write would otherwise hide.
 *
 *   node --test engine/projects-quiet-6180.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-quiet6180-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-quiet6180-data-'));
process.on('exit', () => {
  for (const d of [process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_DATA]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
const projects = require('./projects');
const { STALENESS } = require('./instructions');

test('#6180: taken off its last project is quiet when nothing else is waiting', () => {
  const OFF = projects.WROTE_WHY.off;
  assert.equal(projects.offWriteIsQuiet(OFF, null), true, 'no verdict at all');
  assert.equal(projects.offWriteIsQuiet(OFF, { state: STALENESS.CURRENT }), true, 'the agent is current');
});

test('#6180: not quiet when anything is already waiting (a person\'s edit or another Kosmos change), or for any other reason', () => {
  const OFF = projects.WROTE_WHY.off;
  assert.equal(projects.offWriteIsQuiet(OFF, { state: STALENESS.STALE, wroteBy: null }), false,
    'a person\'s pending edit (nobody recorded) would be hidden by a quiet write');
  assert.equal(projects.offWriteIsQuiet(OFF, { state: STALENESS.STALE, wroteBy: { who: 'person' } }), false, 'a recorded person edit too');
  assert.equal(projects.offWriteIsQuiet(OFF, { state: STALENESS.STALE, wroteBy: { who: 'kosmos', because: 'Kosmos changed who it reports to' } }), false,
    'review 3: another Kosmos change still waiting (it gets no told record) would be hidden too');
  assert.equal(projects.offWriteIsQuiet(projects.WROTE_WHY.on('Launch'), null), false, 'being put on a project is never quiet');
  assert.equal(projects.offWriteIsQuiet(projects.WROTE_WHY.colleagues, null), false, 'a colleagues heal is never quiet');
});
