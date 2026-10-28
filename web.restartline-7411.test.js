'use strict';
/* kosmos#7411 step 4: the page's restart line (paintRestartLine and its words), with Mona Lisa's design review: what they
   get and what a restart costs, once; Restart all and Show who on the line; each agent's Restart only in the list; Not
   now. The clicks are covered in docs/browser-checks/render-restart-line-7411.js; the board's side in
   server.restartline-7411.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function page() {
  const slot = { innerHTML: '', dataset: {}, contains: () => false };
  const document = { getElementById: (id) => (id === 'rline-slot' ? slot : null), activeElement: null };
  const start = PAGE.indexOf('let RLINE = ');
  const end = PAGE.indexOf('\n}\n', PAGE.indexOf('function paintRestartLine()')) + 2;
  assert.ok(start > 0 && end > start, 'the restart line block is not in the page');
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // The page's own asSentence (with no cloudWords in this sandbox it uses the words as given).
  const at = PAGE.indexOf('function asSentence(s) {');
  const asSentence = new Function(PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2) + '\nreturn asSentence;')();
  const api = new Function('document', 'esc', 'rebootFocusAway', 'asSentence', PAGE.slice(start, end) + '\nreturn { RLINE, rlineNames, rlineHead, paintRestartLine };')(document, esc, () => {}, asSentence);
  return { api, slot };
}
const agents = (...labels) => labels.map((l) => ({ name: l.toLowerCase(), label: l }));
const fix = (title) => ({ version: '0.7.73', title });

test('#7411: the line says who and what they get, with the right verb for one agent', () => {
  const { api } = page();
  assert.equal(api.rlineHead({ notes: [fix('Hooks fix')], agents: agents('Ada') }), 'Ada needs a restart to get: Hooks fix.');
  assert.equal(api.rlineHead({ notes: [fix('Hooks fix')], agents: agents('Ada', 'Kai') }), 'Ada and Kai need a restart to get: Hooks fix.');
  assert.equal(api.rlineHead({ notes: [fix('Hooks fix')], agents: agents('Ada', 'Kai', 'Lee') }), 'Ada, Kai and Lee need a restart to get: Hooks fix.');
  assert.equal(api.rlineHead({ notes: [fix('A'), fix('B')], agents: agents('Ada', 'Kai', 'Lee', 'Mo', 'Ty') }),
    'Ada, Kai and <button type="button" class="rlmore" data-rl-who aria-expanded="false" aria-controls="rl-who">3 more</button> need a restart to get 2 fixes in this update.');
  // Names and titles are escaped.
  assert.equal(api.rlineHead({ notes: [fix('<b>x</b>')], agents: agents('<i>') }), '&lt;i&gt; needs a restart to get: &lt;b&gt;x&lt;/b&gt;.');
});

test('#7411: the cost is said once; Restart all, Show who and Not now are on the line; per-agent Restart only in the list', () => {
  const { api, slot } = page();
  api.RLINE.line = { version: '0.7.73', notes: [fix('A'), fix('B')], agents: agents('Ada', 'Kai', 'Lee', 'Mo') };
  api.paintRestartLine();
  const h = slot.innerHTML;
  assert.equal((h.match(/Restarting stops what they are doing now\./g) || []).length, 1);
  assert.match(h, /<small class="rlfix">A<\/small><small class="rlfix">B<\/small>/, 'two fixes are not listed under the line');
  assert.match(h, /<button type="button" class="uprime" data-rl-all>Restart all<\/button>/);
  assert.match(h, /<button type="button" data-rl-who aria-expanded="false" aria-controls="rl-who">Show who<\/button>/);
  assert.match(h, /<button type="button" data-rl-later>Not now<\/button>/);
  assert.doesNotMatch(h, /data-rl-one/, 'per-agent buttons are on the line before Show who');

  api.RLINE.open = true;
  api.paintRestartLine();
  assert.equal((slot.innerHTML.match(/data-rl-one="/g) || []).length, 4, 'the list does not hold every agent');
  assert.match(slot.innerHTML, /<li class="rlrow"><span>Kai<\/span><button type="button" data-rl-one="kai" aria-label="Restart Kai">Restart<\/button><\/li>/);
  assert.match(slot.innerHTML, /aria-expanded="true" aria-controls="rl-who">Hide who</);
});

test('#7411: one agent gets one button named for it and no list; no line paints nothing', () => {
  const { api, slot } = page();
  api.RLINE.line = { version: '0.7.73', notes: [fix('A')], agents: agents('Ada') };
  api.paintRestartLine();
  assert.match(slot.innerHTML, /data-rl-all>Restart Ada<\/button>/);
  assert.doesNotMatch(slot.innerHTML, /data-rl-who|Restart all/);
  api.RLINE.line = null;
  api.paintRestartLine();
  assert.equal(slot.innerHTML, '');
});

test('#7411: after restarts the wake result is said on the line, or in its place with a close button once the line goes', () => {
  const { api, slot } = page();
  api.RLINE.woke = { said: ['Ada'], manual: ['Kai', 'Lee'], held: [], missed: [] };
  api.RLINE.line = { version: '0.7.73', notes: [fix('A')], agents: agents('Mo', 'Ty') };
  api.paintRestartLine();
  assert.match(slot.innerHTML, /<small class="rlwoke">Restarted Ada, and said hello to wake them\. Say hello to Kai and Lee to wake them\.<\/small>/);
  api.RLINE.line = null;
  api.paintRestartLine();
  assert.match(slot.innerHTML, /class="utoast rline rldone"/);
  assert.match(slot.innerHTML, /<b>Restarted Ada, and said hello to wake them\. Say hello to Kai and Lee to wake them\.<\/b>/);
  assert.match(slot.innerHTML, /data-rl-close aria-label="Close this notice"/);
  assert.doesNotMatch(slot.innerHTML, /data-rl-all|data-rl-later/, 'Restart buttons are left with nobody to restart');
  api.RLINE.woke = { said: [], manual: [], held: [], missed: [] };
  api.paintRestartLine();
  assert.equal(slot.innerHTML, '', 'nothing left to say still painted a note');
});

test('#7411: a held hello keeps its reason; a failed restart keeps the engine\'s; one agent\'s progress names it', () => {
  const { api, slot } = page();
  api.RLINE.line = null;
  api.RLINE.woke = { said: [], manual: [], held: [{ label: 'Kai', why: ' It is waiting for an answer on its screen, so Kosmos sent nothing.' }],
    missed: [{ label: 'Lee', why: 'kosmos could not find its window' }] };
  api.paintRestartLine();
  assert.match(slot.innerHTML, /<b>Say hello to Kai to wake them\. It is waiting for an answer on its screen, so Kosmos sent nothing\. Lee did not restart: Kosmos could not find its window\.<\/b>/);
  api.RLINE.woke = { said: [], manual: [], held: [], missed: [] };
  api.RLINE.line = { version: '0.7.73', notes: [fix('A')], agents: agents('Ada') };
  api.RLINE.progress = { key: 'all', text: 'Restarting Ada' };
  api.paintRestartLine();
  assert.match(slot.innerHTML, /data-rl-all aria-disabled="true">Restarting Ada<\/button>/);
  api.RLINE.line = { version: '0.7.73', notes: [fix('A')], agents: agents('Ada', 'Kai') };
  api.RLINE.open = true;
  api.RLINE.progress = { key: 'kai', text: 'Restarting Kai' };
  api.paintRestartLine();
  assert.match(slot.innerHTML, /data-rl-one="kai" aria-label="Restart Kai" aria-disabled="true">Restarting<\/button>/);
});
