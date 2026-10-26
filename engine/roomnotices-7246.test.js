'use strict';
/**
 * #7246 slice 2: a project's own setting for room posts that do not name a member (roomNotices), carried by
 * projects.edit and reported by describe beside the mode it gives now, and the page's select that sets it.
 *
 *   node --test engine/roomnotices-7246.test.js
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-roomnotices-7246-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const roomhold = require('./roomhold');
const page = require('../test-support/page');

const WORK = path.join(SANDBOX, 'work');
fs.mkdirSync(WORK, { recursive: true });
const folder = (name) => { const d = path.join(WORK, name); fs.mkdirSync(d, { recursive: true }); return d; };
const raw = (id) => projects.readAll().find((p) => p.id === id);

test('#7246 s2: edit carries roomNotices; auto clears it; anything else is refused and nothing is written', () => {
  const members = Array.from({ length: 10 }, (_, i) => 'm' + i);
  const p = projects.create({ name: 'Busy', folder: folder('busy'), agents: members });
  assert.equal(projects.get(p.id, []).roomNotices, 'auto', 'a new project is not auto');
  assert.equal(projects.get(p.id, []).roomNoticesNow, 'digest', 'auto on 10 members is not the hourly digest');
  projects.edit(p.id, { roomNotices: 'each' });
  assert.equal(raw(p.id).roomNotices, 'each');
  assert.equal(roomhold.noticeMode(raw(p.id)), 'each', 'the stored setting did not win');
  assert.equal(projects.get(p.id, []).roomNoticesNow, 'each');
  assert.throws(() => projects.edit(p.id, { roomNotices: 'loud' }), /roomNotices must be auto, each, digest or named/);
  assert.equal(raw(p.id).roomNotices, 'each', 'a refused value was written');
  projects.edit(p.id, { roomNotices: 'auto' });
  assert.equal('roomNotices' in raw(p.id), false, 'auto left a stored value');
  assert.equal(projects.get(p.id, []).roomNoticesNow, 'digest');
  // CONTROL: a save naming only roomNotices is a real save, not "nothing here we can change".
  assert.doesNotThrow(() => projects.edit(p.id, { roomNotices: 'named' }));
  assert.equal(projects.get(p.id, []).roomNotices, 'named');
});

test('#7246 s2: the page paints the setting and says what Automatic gives this project now', () => {
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const paint = new Function('document', page.lift(SCRIPT, 'pjPaintNoticesSelect') + '\nreturn pjPaintNoticesSelect;');
  const els = { 'pjs-notices': { value: '' }, 'pjs-notices-hint': { textContent: '' } };
  const fn = paint({ getElementById: (id) => els[id] || null });
  fn({ roomNotices: 'auto', roomNoticesNow: 'digest' });
  assert.equal(els['pjs-notices'].value, 'auto');
  assert.match(els['pjs-notices-hint'].textContent, /For this project now: one summary an hour\./);
  fn({ roomNotices: 'named', roomNoticesNow: 'named' });
  assert.equal(els['pjs-notices'].value, 'named');
  assert.doesNotMatch(els['pjs-notices-hint'].textContent, /For this project now/, 'a chosen mode still explained Automatic');
  fn({ roomNotices: 'weird' });
  assert.equal(els['pjs-notices'].value, 'auto', 'an unknown value was shown as chosen');
});
