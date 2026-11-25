'use strict';

/**
 * kosmos#9087: the board's compact and clear buttons (memoryCommand) said "Asked it to compact." for a refusal that
 * carries no delivery: the old 404 "no agent by that name", and now the 409 "unreadable" a roster outage answers. The
 * real function is lifted from the page and run against each answer.
 *
 *   node --test web.memorycommand-refusal-9087.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const SRC = page.lift(SCRIPT, 'memoryCommand');

async function press(status, body) {
  const msg = { textContent: '' };
  const said = [];
  const document = { getElementById: (id) => (id === 'd-compact-msg' ? msg : null) };
  const fetch = async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const CURRENT = { sessionName: 'raph' };
  const run = new Function('document', 'fetch', 'CURRENT', 'return (' + SRC + ');')(document, fetch, CURRENT);
  await run('compact', (s, ok) => said.push({ s, ok }));
  return { text: msg.textContent, said };
}

test('#9087 a 409 unreadable is shown as the route\'s words and as not done, never "Asked it to compact."', async () => {
  const r = await press(409, { error: 'we could not check which agents are running, so nothing was sent. Try again in a moment.', because: 'unreadable', retry: true });
  assert.match(r.text, /could not check which agents are running/);
  assert.doesNotMatch(r.text, /Asked it to/);
  assert.equal(r.said[0].ok, false);
});

test('#9087 a 404 "no agent by that name" is shown as a refusal too', async () => {
  const r = await press(404, { error: 'no agent by that name' });
  assert.equal(r.text, 'no agent by that name');
  assert.equal(r.said[0].ok, false);
});

test('#9087 CONTROL: a placed delivery still reads "Asked it to compact."', async () => {
  const r = await press(200, { command: 'compact', delivery: { state: 'placed', paneNote: 'It is between tasks.' } });
  assert.equal(r.text, 'Asked it to compact. It is between tasks.');
  assert.equal(r.said[0].ok, true);
});

test('#9087 CONTROL: a could_not delivery keeps its own reason', async () => {
  const r = await press(409, { command: 'compact', delivery: { state: 'could_not', because: 'its window is scrolled back' } });
  assert.equal(r.text, 'its window is scrolled back');
  assert.equal(r.said[0].ok, false);
});
