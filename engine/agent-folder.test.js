'use strict';
/**
 * An agent may live in its own folder, and a recorded folder is validated.
 *
 * 🛑 WHY THIS EXISTS. Kosmos derived every agent's folder from its name, so an
 * agent somebody had already built somewhere on their Mac could be SEEN and
 * never MANAGED. Josh, 2026-08-22: "if people already have agents anywhere, we
 * need to be able to find them and bring them into the Kosmos platform."
 *
 * 🔑 AND WHY IT IS THE DANGEROUS CHANGE. Readers pass a root to
 * `workerfile.readWorkerFile`, which refuses anything outside it. They used to
 * pass the SHARED workers directory; they now pass the agent's own folder. A
 * file is always inside its own folder, so that check can no longer catch a NAME
 * that builds a path -- containment moved into `create.workerDir` and this file
 * is what says it arrived.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-folder-'));
const HOME = path.join(SB, 'home');
const WORKERS = path.join(SB, 'workers');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(WORKERS, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const create = require('./create');
const status = require('./status');
const store = require('./store');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

const IDENT = (who) => `You are **${who}**, a copywriter.\n`;

test('an agent with no record lives where its name says', () => {
  /* The control. Without it every assertion below passes on a resolver that
     returns the recorded folder for everything, including agents that have none. */
  fs.mkdirSync(path.join(WORKERS, 'plain'), { recursive: true });
  fs.writeFileSync(path.join(WORKERS, 'plain', 'CLAUDE.md'), IDENT('Plain'));
  assert.equal(create.workerDir('plain'), path.join(WORKERS, 'plain'));
  assert.equal(status.readIdentity('plain').displayName, 'Plain');
});

test('an agent whose folder is recorded is read from THERE, outside the workers root', () => {
  /* 🔑 THE FEATURE. Their folder, their file, nothing copied and nothing moved. */
  const theirs = path.join(SB, 'somewhere', 'else', 'mike');
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(path.join(theirs, 'CLAUDE.md'), IDENT('Mike'));
  store.writeProfile('mike', { dir: theirs });

  assert.equal(create.workerDir('mike'), theirs);
  assert.equal(status.readIdentity('mike').displayName, 'Mike',
    'a connected agent could not be read from its own folder');
});

test('a recorded folder that is a link is refused', () => {
  /**
   * ⚠️ THE ESCAPE THIS MODULE FAMILY HAS SHIPPED SIX TIMES, arriving by a new
   * road. The record is written by our own route, and "ours" is exactly what was
   * assumed every previous time a reader walked out of the root.
   */
  const real = path.join(SB, 'linktarget');
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, 'CLAUDE.md'), IDENT('Linked Victim'));
  const link = path.join(SB, 'linked');
  fs.symlinkSync(real, link);
  fs.mkdirSync(path.join(WORKERS, 'linky'), { recursive: true });
  store.writeProfile('linky', { dir: link });

  assert.equal(create.workerDir('linky'), path.join(WORKERS, 'linky'),
    'a symlinked record was followed instead of refused');
  assert.notEqual(status.readIdentity('linky').displayName, 'Linked Victim');
});

test('a relative record, a missing folder and a file are all refused', () => {
  /* Three shapes of "not an absolute path to a real directory", each of which
     would otherwise become a root that contains whatever it points at. */
  fs.mkdirSync(path.join(WORKERS, 'rel'), { recursive: true });
  store.writeProfile('rel', { dir: '../../etc' });
  assert.equal(create.workerDir('rel'), path.join(WORKERS, 'rel'));

  fs.mkdirSync(path.join(WORKERS, 'gone'), { recursive: true });
  store.writeProfile('gone', { dir: path.join(SB, 'no-such-folder') });
  assert.equal(create.workerDir('gone'), path.join(WORKERS, 'gone'));

  const afile = path.join(SB, 'a-file');
  fs.writeFileSync(afile, 'not a folder');
  fs.mkdirSync(path.join(WORKERS, 'filey'), { recursive: true });
  store.writeProfile('filey', { dir: afile });
  assert.equal(create.workerDir('filey'), path.join(WORKERS, 'filey'));
});

test('a name still cannot build a path of its own', () => {
  /**
   * 🛑 THE ASSERTION THAT REPLACES THE ONE THAT MOVED. While readers passed the
   * shared root, an escaping NAME was caught by containment. Now that the root
   * is the agent's own folder, this is the only thing standing between
   * `readIdentity('../victim')` and a file outside the root -- and the first two
   * sanitisers I tried here were both wrong in ways the suite caught.
   */
  const outside = path.join(SB, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'CLAUDE.md'), IDENT('Outside Victim'));
  const escape = path.relative(WORKERS, outside);
  assert.ok(fs.existsSync(path.join(WORKERS, escape, 'CLAUDE.md')),
    'fixture is wrong: the naive join does not reach the target');

  assert.notEqual(create.workerDir(escape), outside);
  assert.notEqual(status.readIdentity(escape).displayName, 'Outside Victim');
  assert.equal(status.readIdentity(escape).derived, false);
});

test('and an ordinary name keeps its exact spelling', () => {
  /* ⚠️ A sanitiser that TIDIES rather than refuses broke two removal tests: the
     roster admits any tmux session running Claude, so `orch.main`, `has space`,
     `0` and `UPPER` are all real agents somebody may need to manage. */
  for (const odd of ['Casey', 'orch.main', 'has space', '0', 'UPPER']) {
    assert.equal(create.workerDir(odd), path.join(WORKERS, odd), `${odd} lost its spelling`);
  }
});
