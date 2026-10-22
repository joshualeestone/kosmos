'use strict';
/* #6719: the person's starred agents, kept on the board. A set of session names; an unreadable file reads as no stars
 * with ok false and is never overwritten from that reading. Sandboxed data root before the require. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-stars-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const stars = require('./stars');

test.afterEach(() => { fs.rmSync(stars.file(), { force: true }); });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('sandbox: the stars file is inside this test\'s temp dir', () => {
  assert.ok(nodePath.resolve(stars.file()).startsWith(nodePath.resolve(SANDBOX) + nodePath.sep), stars.file());
});

test('no file is no stars, and a clean read', () => {
  assert.deepEqual(stars.read(), { names: [], ok: true });
});

test('star, star another, unstar the first: the set follows, and it survives a fresh read from disk', () => {
  assert.deepEqual(stars.set('renet', true), { names: ['renet'], ok: true });
  assert.deepEqual(stars.set('angel', true), { names: ['renet', 'angel'], ok: true });
  assert.deepEqual(stars.set('renet', false), { names: ['angel'], ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(stars.file(), 'utf8')), { names: ['angel'] }, 'what is on disk is the set');
});

test('starring a starred agent, or unstarring one that is not, changes nothing and is not an error', () => {
  stars.set('renet', true);
  assert.deepEqual(stars.set('renet', true), { names: ['renet'], ok: true });
  assert.deepEqual(stars.set('nobody', false), { names: ['renet'], ok: true });
});

test('a name that is not one, or an on that is not a boolean, is refused and nothing is written', () => {
  for (const [name, on] of [['', true], ['a/b', true], ['a\\b', true], ['x\ny', true], ['x'.repeat(129), true],
    [42, true], [null, true], ['renet', 'yes'], ['renet', 1], ['renet', undefined]]) {
    const r = stars.set(name, on);
    assert.ok(r.refused, `accepted ${JSON.stringify([name, on])}`);
  }
  assert.equal(fs.existsSync(stars.file()), false, 'a refusal wrote the file');
  // CONTROL: the longest allowed name is taken, so the length refusal above is the limit and not a broken matcher.
  assert.deepEqual(stars.set('x'.repeat(128), true), { names: ['x'.repeat(128)], ok: true });
});

test('a file that cannot be read is no stars with ok false, and a star is not written over it', () => {
  fs.mkdirSync(nodePath.dirname(stars.file()), { recursive: true });
  fs.writeFileSync(stars.file(), '{not json');
  assert.deepEqual(stars.read(), { names: [], ok: false });
  assert.deepEqual(stars.set('renet', true), { names: [], ok: false });
  assert.equal(fs.readFileSync(stars.file(), 'utf8'), '{not json', 'the unreadable file was overwritten, dropping every star it held');
});

test('a well-formed file with bad entries keeps only the good names, once each', () => {
  fs.mkdirSync(nodePath.dirname(stars.file()), { recursive: true });
  fs.writeFileSync(stars.file(), JSON.stringify({ names: ['renet', 7, 'a/b', 'renet', 'angel'] }));
  assert.deepEqual(stars.read(), { names: ['renet', 'angel'], ok: true });
});

test('stars stop at the cap; one more is refused and the set is unchanged', () => {
  fs.mkdirSync(nodePath.dirname(stars.file()), { recursive: true });
  const full = Array.from({ length: stars.MAX_STARS }, (_, i) => 'agent' + i);
  fs.writeFileSync(stars.file(), JSON.stringify({ names: full }));
  assert.ok(stars.set('onemore', true).refused, 'a star past the cap was taken');
  assert.equal(stars.read().names.length, stars.MAX_STARS);
  // CONTROL: unstarring at the cap still works, and then a star fits again.
  assert.equal(stars.set('agent0', false).names.length, stars.MAX_STARS - 1);
  assert.equal(stars.set('onemore', true).names.length, stars.MAX_STARS);
});
