'use strict';
/**
 * kosmos#7210: the project settings' notification choice (All / Mentions only / Muted), run from the shipped page.
 *   - a choice paints at once and is saved; the board's answer is what the page keeps;
 *   - a refusal puts back what the board holds and says why under the choice;
 *   - an earlier answer arriving after a later choice never repaints over it;
 *   - the new-message sound rings only for a project on All.
 *
 *   node --test web.projmute-7210.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, lift } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

function el(attrs = {}) {
  return { hidden: false, textContent: '', tabIndex: 0, dataset: {}, attrs: { ...attrs },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; } };
}

/** The page's functions over a fake DOM and a fetch the test answers by hand. */
function load(project) {
  const radios = ['all', 'mentions', 'muted'].map((v) => { const b = el(); b.dataset.notify = v; return b; });
  const els = {
    'pjs-notify': { querySelectorAll: () => radios },
    'pjs-notify-hint': el(), 'pjs-notify-msg': el(), 'pj-head-notify': el(), 'pj-head-notify-t': el(),
  };
  const pending = [];
  const fetch = (url, opts) => new Promise((resolve) => pending.push({ url, body: JSON.parse(opts.body), resolve }));
  const list = [project];
  const src = [
    'let PJ_CURRENT = ' + JSON.stringify(project.id) + ';',
    'const pjById = (id) => LIST.find((p) => p.id === id);',
    'const pjSentence = (s) => String(s);',
    lift(SCRIPT, 'pjNotifyLevel'),
    SCRIPT.slice(SCRIPT.indexOf('const PJ_NOTIFY_HINT = {'), SCRIPT.indexOf('function pjNotifyPaint(')),
    lift(SCRIPT, 'pjNotifyPaint'),
    lift(SCRIPT, 'pjHeadNotifyPaint'),
    'let PJ_NOTIFY_SEQ = 0;',
    'let PJ_NOTIFY_INFLIGHT = 0;',
    lift(SCRIPT, 'pjNotifyChoose'),
    'return { pjNotifyChoose, pjNotifyPaint, pjHeadNotifyPaint, pjNotifyLevel };',
  ].join('\n');
  const api = new Function('document', 'fetch', 'LIST', src)({ getElementById: (id) => els[id] || null }, fetch, list);
  const checked = () => radios.find((b) => b.attrs['aria-checked'] === 'true').dataset.notify;
  const answer = (i, ok, json) => pending[i].resolve({ ok, json: async () => json });
  return { api, els, pending, checked, answer, project };
}
const tick = () => new Promise((r) => setImmediate(r));

test('#7210: a choice paints at once, is sent, and the board\'s answer is kept, title label included', async () => {
  const t = load({ id: 'p1', name: 'P' });
  const done = t.api.pjNotifyChoose('muted');
  assert.equal(t.checked(), 'muted', 'the choice did not paint before the answer');
  assert.deepEqual(t.pending[0].body, { notify: 'muted' });
  assert.match(t.pending[0].url, /^\/api\/project\/p1$/);
  t.answer(0, true, { project: { notify: 'muted' } });
  await done;
  assert.equal(t.project.notify, 'muted', 'the page did not keep the saved level');
  assert.equal(t.els['pjs-notify-msg'].textContent, 'Saved.');
  assert.equal(t.els['pj-head-notify'].hidden, false, 'the title label did not show for a muted project');
  assert.equal(t.els['pj-head-notify-t'].textContent, 'Muted');
  assert.match(t.els['pjs-notify-hint'].textContent, /unread count still shows/);
});

test('#7210: a refusal puts back what the board holds and says why', async () => {
  const t = load({ id: 'p2', name: 'P', notify: 'mentions' });
  const done = t.api.pjNotifyChoose('muted');
  t.answer(0, false, { error: 'a project\'s notifications are the person\'s to set' });
  await done;
  assert.equal(t.checked(), 'mentions', 'a refused choice stayed painted');
  assert.equal(t.project.notify, 'mentions', 'a refused choice was kept');
  assert.match(t.els['pjs-notify-msg'].textContent, /^Not saved: a project's notifications/);
});

test('#7210: an earlier answer arriving after a later choice never repaints over it', async () => {
  const t = load({ id: 'p3', name: 'P' });
  const first = t.api.pjNotifyChoose('muted');
  const second = t.api.pjNotifyChoose('mentions');
  t.answer(1, true, { project: { notify: 'mentions' } });
  await second;
  t.answer(0, false, { error: 'late' });
  await first;
  await tick();
  assert.equal(t.checked(), 'mentions', 'the late answer to the first choice repainted over the second');
  assert.equal(t.els['pjs-notify-msg'].textContent, 'Saved.', 'the late refusal replaced the later save\'s words');
});

test('#7210: choosing the level already held sends nothing', async () => {
  const t = load({ id: 'p4', name: 'P' });
  await t.api.pjNotifyChoose('all');
  assert.equal(t.pending.length, 0);
});

test('#7210: the new-message sound rings only for a project on All (the unread count still moves)', () => {
  const at = SCRIPT.indexOf('/* #7210: a project set to Mentions only or Muted makes no new-message sound');
  assert.ok(at > 0, 'the sound gate comment is gone');
  const line = SCRIPT.slice(at, SCRIPT.indexOf('\n', SCRIPT.indexOf('\n', at) + 1));
  assert.match(line, /projectSoundOn\(p\.id\) && pjNotifyLevel\(p\) === 'all'\) burst = true;/, 'the sound no longer asks the level');
  const { api } = load({ id: 'p5', name: 'P' });
  assert.equal(api.pjNotifyLevel({ notify: 'muted' }), 'muted');
  assert.equal(api.pjNotifyLevel({ notify: 'mentions' }), 'mentions');
  for (const odd of [{}, { notify: 'loud' }, null]) assert.equal(api.pjNotifyLevel(odd), 'all', JSON.stringify(odd));
});

test('#7210 review 1: a save answered after a later choice is still kept, so a later refusal puts back the saved level', async () => {
  const t = load({ id: 'p6', name: 'P' });
  const first = t.api.pjNotifyChoose('muted');
  const second = t.api.pjNotifyChoose('mentions');
  t.answer(0, true, { project: { notify: 'muted' } });
  await first;
  t.answer(1, false, { error: 'refused' });
  await second;
  assert.equal(t.project.notify, 'muted', 'the board saved muted, but the page forgot it');
  assert.equal(t.checked(), 'muted', 'the refusal put back an older level than the board holds');
});

test('#7210 review 2: going back to the held level while a save is on its way is sent, so the board ends where the choice shows', async () => {
  const t = load({ id: 'p7', name: 'P' });
  const first = t.api.pjNotifyChoose('muted');
  const back = t.api.pjNotifyChoose('all');   // the cache still says all: before review 2 this sent nothing
  assert.equal(t.pending.length, 2, 'going back to All while Muted was being saved sent nothing');
  assert.deepEqual(t.pending[1].body, { notify: 'all' });
  t.answer(0, true, { project: { notify: 'muted' } });
  await first;
  t.answer(1, true, { project: { notify: 'all' } });
  await back;
  assert.equal(t.project.notify, 'all');
  assert.equal(t.checked(), 'all');
});
