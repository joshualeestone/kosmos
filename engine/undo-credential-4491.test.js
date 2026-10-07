'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #4491 post-rebase review: the undo copier (#5153) reads a file FOR an agent on the agent's own token, so it must never
 * keep a copy of the board's own credentials: board.token (by name, by its temp names, by a hard link under another
 * name) or a sender token. A refused file leaves no copy of its bytes in the undo store. Control: an ordinary file in
 * the agent's own folder is still kept.
 *   node --test engine/undo-credential-4491.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ud4491-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, '.claude');
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
for (const d of ['data', 'workers', '.claude/projects']) fs.mkdirSync(path.join(SB, d), { recursive: true });

const undo = require('./undo');
const store = require('./store');
const sendertoken = require('./sendertoken');

function worker(name) {
  const d = path.join(SB, 'workers', name);
  fs.mkdirSync(d, { recursive: true });
  store.writeProfile(name, { displayName: name });
  undo.resetForTests();
  return d;
}
const SECRET = 'board-secret-' + crypto.randomBytes(8).toString('hex');
const secretHash = crypto.createHash('sha256').update(SECRET).digest('hex');
/* Every byte the undo store holds, so a refusal can be checked to have left no copy behind. */
function storeHolds(text) {
  const root = path.join(store.ROOT, 'undo');
  const walk = (d) => { let out = []; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) out = out.concat(e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); } catch { /* none */ } return out; };
  return walk(root).some((f) => { try { return fs.readFileSync(f, 'utf8').includes(text); } catch { return false; } });
}

test('#4491: the undo copier never keeps a copy of the board token or a sender token', () => {
  const me = worker('ud-me');
  undo.setOn(true);
  fs.mkdirSync(store.ROOT, { recursive: true });
  const token = path.join(store.ROOT, 'board.token');
  fs.writeFileSync(token, SECRET, { mode: 0o600 });

  assert.deepEqual(undo.keep(token, { cwd: me }), { kept: false, because: 'credential' }, 'board.token was copied');
  const tmp = path.join(store.ROOT, '.board.token.123.tmp');
  fs.writeFileSync(tmp, SECRET);
  assert.equal(undo.keep(tmp, { cwd: me }).because, 'credential', 'a temp copy of the token was copied');
  fs.mkdirSync(sendertoken.DIR, { recursive: true });
  const st = path.join(sendertoken.DIR, 'someone');
  fs.writeFileSync(st, SECRET);
  assert.equal(undo.keep(st, { cwd: me }).because, 'credential', 'a sender token was copied');
  const link = path.join(me, 'notes.txt');
  let linked = true;
  try { fs.linkSync(token, link); } catch { linked = false; }
  if (linked) assert.equal(undo.keep(link, { cwd: me }).because, 'credential', 'a hard link to board.token under another name was copied');
  assert.equal(undo.keep(path.join(store.ROOT, 'board.token.gone'), { cwd: me }).because, 'credential', 'a not-yet-existing token name was recorded');
  assert.equal(storeHolds(SECRET), false, 'the undo store holds the token bytes');
  assert.equal(storeHolds(secretHash), false, 'the undo store names the token blob');

  // CONTROL: an ordinary file in the agent's own folder is still kept, so the refusals above are not "keep is off".
  const plain = path.join(me, 'plain.txt');
  fs.writeFileSync(plain, 'ordinary words');
  assert.deepEqual(undo.keep(plain, { cwd: me }), { kept: true });
  assert.equal(storeHolds('ordinary words'), true, 'CONTROL: the ordinary copy did not reach the store');
});
