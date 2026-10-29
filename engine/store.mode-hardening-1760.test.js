'use strict';

/**
 * #1760: the data root is owner-only (0700) and the message log is owner-only (0600), so a data root outside
 * ~/Library is not readable by other local accounts. POSIX modes only, so skipped on Windows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'storemode-1760-')));
process.env.AGENT_WORKFORCE_DATA = SB;
delete process.env.AGENT_WORKFORCE_HOME;
test.after(() => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* temp */ } });

const store = require('./store');
const messages = require('./messages');
const skip = process.platform === 'win32';
const modeOf = (p) => fs.statSync(p).mode & 0o777;

test('#1760: a store write (writeProfile -> ensure) tightens a loose data root to 0700', { skip }, () => {
  // The precondition is set here (0755), so the result does not depend on the ambient umask.
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.chmodSync(store.ROOT, 0o755);
  assert.equal(modeOf(store.ROOT), 0o755, 'precondition: the root starts at 0755');
  store.writeProfile('modeprobe', { dir: path.join(SB, 'work', 'modeprobe'), provider: 'anthropic' });
  assert.equal(modeOf(store.ROOT), 0o700, `ensure() did not tighten the root (got ${modeOf(store.ROOT).toString(8)})`);
});

test('#1760: secureRoot (the board-start call) tightens a loose root every time, and returns the mode', { skip }, () => {
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.chmodSync(store.ROOT, 0o755);   // loosened again after the test above already secured this root
  assert.equal(store.secureRoot(), 0o700);
  assert.equal(modeOf(store.ROOT), 0o700);
});

test('#1760: the message log is created owner-only (0600), whatever the umask', { skip }, () => {
  assert.ok(messages.LOG.startsWith(SB), 'the message log is not in this test\'s sandbox: ' + messages.LOG);
  try { fs.unlinkSync(messages.LOG); } catch { /* fresh */ }
  const was = process.umask(0o022);
  try { messages.logHeldDropped({ id: 'm1', from: 'a', to: 'b' }); } finally { process.umask(was); }
  assert.equal(modeOf(messages.LOG), 0o600, `the log was created ${modeOf(messages.LOG).toString(8)}`);
});

test('#1760: an existing 0644 log (an upgraded install) is tightened by secureLog, and a link is left alone', { skip }, () => {
  fs.writeFileSync(messages.LOG, '{}\n');
  fs.chmodSync(messages.LOG, 0o644);
  messages.secureLog();
  assert.equal(modeOf(messages.LOG), 0o600, 'secureLog did not tighten the existing log');
  const target = path.join(SB, 'elsewhere.jsonl');
  fs.writeFileSync(target, '{}\n');
  fs.chmodSync(target, 0o644);
  fs.unlinkSync(messages.LOG);
  fs.symlinkSync(target, messages.LOG);
  messages.secureLog();
  assert.equal(modeOf(target), 0o644, 'secureLog followed a link to a file it does not own');
});

test('#1760: the board calls secureRoot and secureLog at start, for a real board', () => {
  // A source check: the call sits in the board-start block, gated like removal.reapplyAtBoardStart.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('removal.reapplyAtBoardStart({ enforcing: boardAuthState.on });');
  assert.ok(at > 0, 'the board-start block moved');
  const after = src.slice(at, at + 1500);
  assert.match(after, /if \(boardAuthState\.on\) \{\s*try \{[\s\S]*store\.secureRoot\(\)[\s\S]*\.secureLog\(\)[\s\S]*\} catch/);
});
