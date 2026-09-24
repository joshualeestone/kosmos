'use strict';

/**
 * #3224: messages.projectOfPost(id) -- the NON-CIRCULAR oracle a reply binds to.
 * It returns the project a POST belongs to (recorded when the post was made,
 * independent of any later reply), or null. sendRoomPostAsAgent uses it to refuse a
 * reply whose target room differs from the room the answered message came from.
 *
 * Seeds the message log directly (same idiom as messages.misroute-digest-3224.test.js)
 * so the id->project facts are explicit.
 */

const os = require('node:os');
const nodePath = require('node:path');
const SANDBOX = nodePath.join(os.tmpdir(), 'kosmos-projectofpost-3224-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const messages = require('./messages');

function postRow(id, project) {
  return { kind: 'post', id, from: 'dana', project, to: ['mara'], text: 'x', outcomes: { mara: 'placed' }, at: new Date().toISOString() };
}
function messageRow(id) {
  // A DIRECT message (kind 'message') has no room; projectOfPost must not answer for it.
  return { kind: 'message', id, from: 'dana', to: 'mara', text: 'dm', at: new Date().toISOString() };
}

function seed(rows) {
  messages.resetForTests();
  try { fs.rmSync(messages.LOG, { force: true, recursive: true }); } catch { /* fresh */ }
  fs.mkdirSync(nodePath.dirname(messages.LOG), { recursive: true });
  fs.writeFileSync(messages.LOG, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  messages.resetForTests();
}

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#3224: projectOfPost returns the project of a post by its id', () => {
  seed([postRow('m1', 'projA'), postRow('m2', 'projB')]);
  assert.equal(messages.projectOfPost('m1'), 'projA');
  assert.equal(messages.projectOfPost('m2'), 'projB', 'a second post in a different room resolves to ITS room, not the first');
});

test('#3224: projectOfPost returns null for an unknown id (an aged-out citation, so the caller falls through)', () => {
  seed([postRow('m1', 'projA')]);
  assert.equal(messages.projectOfPost('m999'), null);
});

test('#3224: projectOfPost returns null for a DIRECT message (kind message) -- only a room post binds a room', () => {
  seed([messageRow('m1')]);
  assert.equal(messages.projectOfPost('m1'), null, 'a direct message has no room; it must not resolve to a project');
});

test('#3224: projectOfPost returns null for an empty/whitespace id, never a stray match', () => {
  seed([postRow('m1', 'projA')]);
  assert.equal(messages.projectOfPost(''), null);
  assert.equal(messages.projectOfPost('   '), null);
  assert.equal(messages.projectOfPost(null), null);
  assert.equal(messages.projectOfPost(undefined), null);
});

test('#3224: projectOfPost trims a padded id so an envelope-copied value with stray space still resolves', () => {
  seed([postRow('m5', 'projA')]);
  assert.equal(messages.projectOfPost(' m5 '), 'projA');
});
