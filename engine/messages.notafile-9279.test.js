'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9279: messages.record() treats anything in the log's place that is not a regular file as UNREADABLE (ok:
 * false), never as an empty log. Found on Windows, where a folder's size reads 0 and opening it succeeds, so the read
 * found no bytes and answered an empty, readable log. On a Mac a folder fails closed anyway (open throws EISDIR), so
 * the Mac arm that shows the Windows shape is a link to /dev/null: size 0, and opening it succeeds, as a folder does
 * on Windows.
 */

const os = require('node:os');
const nodePath = require('node:path');
const SANDBOX = nodePath.join(os.tmpdir(), 'kosmos-notafile-9279-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const messages = require('./messages');

function clear() {
  messages.resetForTests();
  try { fs.rmSync(messages.LOG, { force: true, recursive: true }); } catch { /* fresh */ }
  fs.mkdirSync(nodePath.dirname(messages.LOG), { recursive: true });
}

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#9279: a folder in the log place is unreadable, not an empty log', () => {
  clear();
  fs.mkdirSync(messages.LOG);
  messages.resetForTests();
  const r = messages.record();
  assert.equal(r.ok, false, 'a folder read as a readable log');
  assert.deepEqual(r.rows, []);
});

test('#9279: a non-file whose open succeeds and reads nothing (the Windows folder shape) is unreadable', { skip: process.platform === 'win32' ? 'a link to /dev/null needs a POSIX system; the folder arm above is the Windows case' : false }, () => {
  clear();
  fs.symlinkSync('/dev/null', messages.LOG);
  assert.equal(fs.statSync(messages.LOG).size, 0, 'fixture: the stand-in must read size 0, as a Windows folder does');
  assert.equal(fs.statSync(messages.LOG).isFile(), false, 'fixture: the stand-in must not be a regular file');
  messages.resetForTests();
  const r = messages.record();
  assert.equal(r.ok, false, 'a size-0 non-file read as an empty, readable log');
});

test('#9279 CONTROLS: an empty regular file is a readable empty log, and no log at all is too', () => {
  clear();
  fs.writeFileSync(messages.LOG, '');
  messages.resetForTests();
  const empty = messages.record();
  assert.equal(empty.ok, true, 'an empty file is readable');
  assert.deepEqual(empty.rows, []);

  clear();
  messages.resetForTests();
  assert.equal(messages.record().ok, true, 'no log yet reads as an empty, readable log (#7367)');
});

test('#9279 CONTROL: a regular file with a row still reads it', () => {
  clear();
  const row = { kind: 'message', id: 'm1', from: 'dana', to: 'mara', text: 'hi', at: new Date().toISOString() };
  fs.writeFileSync(messages.LOG, JSON.stringify(row) + '\n');
  messages.resetForTests();
  const r = messages.record();
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
});
