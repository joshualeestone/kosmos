'use strict';
/**
 * kosmos#7285 item 2: on a Kosmos cloud machine an unreadable or missing remote.json keeps remote access wanted
 * (the tunnel is the only way in, and the switch that would repair the file is reachable only through it). On any
 * other computer it reads as off, as before. The real settings file, in a sandboxed data root.
 *
 *   node --test engine/remote-cloudkeepson-7285.test.js
 */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cloudkeepson-7285-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const remote = require('./remote');
const cm = require('./cloudmachine');

const FILE = path.join(require('./store').ROOT, 'remote.json');
const realCloud = cm.isCloudMachine;
test.after(() => { cm.isCloudMachine = realCloud; });

test('a cloud machine keeps remote access wanted when remote.json is damaged or gone; a readable off is still off', () => {
  cm.isCloudMachine = () => true;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, '{ not json');
  assert.equal(remote.read().ok, false, 'premise: the damaged file reads as not ok');
  assert.equal(remote.cloudKeepsOn(), true, 'a damaged file on a cloud machine reads as off');
  fs.rmSync(FILE, { force: true });
  assert.equal(remote.cloudKeepsOn(), true, 'a missing file on a cloud machine reads as off');
  // CONTROL: a readable file is the setting, on a cloud machine too (switching off on purpose is refused elsewhere).
  fs.writeFileSync(FILE, JSON.stringify({ on: false }));
  assert.equal(remote.cloudKeepsOn(), false, 'a readable file was overridden');
});

test('review 1: the keep-on survives the next ordinary save (the file is repaired to on), and ensure() uses it', () => {
  cm.isCloudMachine = () => true;
  fs.rmSync(FILE, { force: true });
  assert.equal(remote.cloudKeepsOn(), true);
  assert.equal(remote.read().on, true, 'the missing file was not written again with on');
  // An ordinary save after it (as a standing refresh makes) keeps on.
  remote.fedSetStanding('member');   // a real ordinary save (review 3), the one a status poll makes
  assert.equal(remote.read().standing, 'member', 'premise: the save landed');
  assert.equal(remote.read().on, true, 'an ordinary save wrote off over the repair');
  // Review 2: a file that is there but cannot be read is kept on in memory, never rewritten (its ids would go).
  fs.writeFileSync(FILE, '{ damaged');
  assert.equal(remote.cloudKeepsOn(), true);
  assert.equal(fs.readFileSync(FILE, 'utf8'), '{ damaged', 'a damaged file was rewritten');
  // ensure() decides from it: its wanted line reads cloudKeepsOn (a revert of that line fails here).
  const src = fs.readFileSync(path.join(__dirname, 'remote.js'), 'utf8');
  const body = src.slice(src.indexOf('function ensure(port)'), src.indexOf('function ensure(port)') + 900);
  assert.match(body, /const wanted = !forgetting && \(read\(\)\.on \|\| cloudKeepsOn\(\)\) && enrolled\(\)/, 'ensure() is not wired as decided');
});

test('CONTROL: on a computer that is not a cloud machine a damaged file reads as off, as before', () => {
  cm.isCloudMachine = () => false;
  fs.writeFileSync(FILE, '{ not json');
  assert.equal(remote.cloudKeepsOn(), false);
  assert.equal(remote.read().on, false);
});
