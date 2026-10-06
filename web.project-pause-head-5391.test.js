'use strict';
/* kosmos#5391: the project page's own Pause / Resume (paintHeadPause) and the Paused badge on the project card
   (pjPillOf), from the page's real functions. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const pjPillOf = new Function('GLYPH', page.liftAll(SCRIPT, ['pjPillOf']) + '\nreturn pjPillOf;')({ paused: '', restarting: '' });

test('#5391: a paused project\'s card says Paused, below Issue and above Working (controls: not paused, archived)', () => {
  assert.equal(pjPillOf({ paused: true, summary: {} }).label, 'Paused');
  assert.equal(pjPillOf({ paused: true, summary: { working: true } }).label, 'Paused', 'above Working');
  assert.equal(pjPillOf({ paused: true, summary: { needsYou: true } }).label, 'Issue', 'below Issue');
  assert.equal(pjPillOf({ paused: false, summary: { working: true } }).label, 'Working', 'CONTROL: not paused');
  assert.equal(pjPillOf({ paused: true, archived: true, summary: {} }).label, '', 'CONTROL: an archived project says nothing');
});

function headRig() {
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, hidden: false, textContent: '', dataset: {}, title: '', _cls: new Set(), _attr: {},
    classList: { toggle(c, on) { if (on) els[id]._cls.add(c); else els[id]._cls.delete(c); } },
    setAttribute(k, v) { this._attr[k] = String(v); },
    querySelector() { return el(id + ':t'); } });
  const paint = new Function('document', 'PJ_READ_FAILED', page.liftAll(SCRIPT, ['paintHeadPause']) + '\nreturn paintHeadPause;')({ getElementById: el }, false);
  return { paint, el };
}

test('#5391: the header button says Pause or Resume, and the Paused line shows only while paused', () => {
  const { paint, el } = headRig();
  paint({ id: 'p1', name: 'Launch', paused: false });
  assert.equal(el('pj-head-pause:t').textContent, 'Pause');
  assert.equal(el('pj-one-paused').hidden, true);
  assert.equal(el('pj-head-pause')._attr['aria-label'], 'Pause Launch');
  paint({ id: 'p1', name: 'Launch', paused: true, pausedByPerson: true });
  assert.equal(el('pj-head-pause:t').textContent, 'Resume');
  assert.equal(el('pj-one-paused').hidden, false);
  assert.match(el('pj-one-paused').textContent, /^Paused: Kosmos is not nudging anyone/);
  paint({ id: 'p1', name: 'Launch', paused: true });
  assert.match(el('pj-one-paused').textContent, /^An agent paused it: Kosmos is not nudging/, 'an agent\'s pause says so, as Settings does');
  paint({ id: 'p1', name: 'Launch', paused: true, archived: true });
  assert.equal(el('pj-head-pause').hidden, true, 'CONTROL: an archived project has no Pause button');
  assert.equal(el('pj-one-paused').hidden, true);
  paint({ id: 'p2', name: 'Next', paused: false });   // review 1: a live project after an archived one gets its button back
  assert.equal(el('pj-head-pause').hidden, false);
  assert.equal(el('pj-one-paused').hidden, true);
});
