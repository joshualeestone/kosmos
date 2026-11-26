'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)

/**
 * kosmos#9096 item 3: a project member is taught --no-reply for a post or message that only closes a thread or tests
 * delivery, so it arrives marked no reply requested instead of with the answer command.
 *
 *   node --test engine/fyihint-9096.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fyi-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fyi-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');

const P = [{ id: 'p1', name: 'Henderson lease', folder: '/tmp/henderson', agents: ['writer'] }];
const RULE = 'When a post or message only closes a thread or tests delivery (thanks, nothing needed), put --no-reply first:';

test('a member is taught --no-reply for closing notes, on both post and msg, as a leading flag', () => {
  const text = projects.blockBody(P, 'writer');
  const at = text.indexOf(RULE);
  assert.ok(at >= 0, 'the rule is missing from the member block');
  const rest = text.slice(at, at + 600);
  assert.match(rest, /`\S*kosmos post --no-reply <project-id> \.\.\.`/);
  assert.match(rest, /`\S*kosmos msg --no-reply <agent> \.\.\.`/);
  assert.match(rest, /nobody is asked to answer it, so name only who must see it\./);
});

test('control: a block with no member (no session name) does not carry it, as the other member rules', () => {
  assert.ok(!projects.blockBody(P, '').includes(RULE));
});

test('the taught flag is one both CLIs take as a leading flag on post and msg', () => {
  const root = path.join(__dirname, '..');
  const sh = fs.readFileSync(path.join(root, 'install/kosmos'), 'utf8');
  const win = fs.readFileSync(path.join(root, 'tools/windows/kosmos-cli.js'), 'utf8');
  for (const verb of ['post', 'msg']) {
    assert.ok(sh.includes('Usage: kosmos ' + verb + ' [--no-reply]'), 'install/kosmos ' + verb + ' has no leading --no-reply');
    assert.ok(win.includes('Usage: kosmos ' + verb + ' [--no-reply]'), 'Windows CLI ' + verb + ' has no leading --no-reply');
  }
});

test('no em dash in the new lines', () => {
  const text = projects.blockBody(P, 'writer');
  const at = text.indexOf(RULE);
  assert.ok(at >= 0);
  assert.ok(!/[—]|&mdash;|&#8212;|&#x2014;/i.test(text.slice(at, at + 600)));
});
