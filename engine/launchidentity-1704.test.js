'use strict';
/**
 * #1704 / #2828: the launch key -- the ONE derivation of an agent's machine-wide
 * names per Kosmos. The default world must be unchanged byte for byte, and the
 * separator must be unreachable from either side of the key.
 *
 *   node --test engine/launchidentity-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const li = require('./launchidentity');

/* Both rules are module-private literals, so they are read out of the source the
   way name-key.test.js reads NAME_RE: the test guards the rule as written. */
function ruleFrom(file, constName) {
  const src = fs.readFileSync(nodePath.join(__dirname, file), 'utf8');
  const m = src.match(new RegExp('const ' + constName + ' = (\\/.+?\\/);'));
  assert.ok(m, constName + ' in ' + file + ' is gone or no longer a literal, so this test cannot read the rule it guards');
  return eval(m[1]); // eslint-disable-line no-eval -- a regex literal copied from our own source
}

test('#1704 the DEFAULT world keeps the bare name: no existing install is renamed', () => {
  assert.equal(li.launchKey('ava'), 'ava');
  assert.equal(li.launchKey('ava', undefined), 'ava');
  assert.equal(li.launchKey('ava', null), 'ava');
  assert.equal(li.launchKey('ava', ''), 'ava');
  assert.equal(li.launchKey('ava', 'default'), 'ava');
});

test('#1704 a NAMED world keys its agents name+world, and the key parses back', () => {
  assert.equal(li.launchKey('ava', 'client-work'), 'ava+client-work');
  assert.deepEqual(li.parseKey('ava+client-work'), { name: 'ava', worldId: 'client-work' });
  assert.deepEqual(li.parseKey('ava'), { name: 'ava', worldId: 'default' });
});

test('#1704 a key is a member of exactly one world', () => {
  assert.equal(li.nameInWorld('ava', 'default'), 'ava');
  assert.equal(li.nameInWorld('ava', undefined), 'ava');
  assert.equal(li.nameInWorld('ava+test', 'default'), null, 'a named world\'s agent is not the default board\'s');
  assert.equal(li.nameInWorld('ava+test', 'test'), 'ava');
  assert.equal(li.nameInWorld('ava', 'test'), null, 'a default agent is not a named board\'s');
  assert.equal(li.nameInWorld('ava+other', 'test'), null);
});

test('#1704 the current world comes from KOSMOS_WORLD, absent meaning default', () => {
  assert.equal(li.currentWorldId({}), 'default');
  assert.equal(li.currentWorldId({ KOSMOS_WORLD: '' }), 'default');
  assert.equal(li.currentWorldId({ KOSMOS_WORLD: 'default' }), 'default');
  assert.equal(li.currentWorldId({ KOSMOS_WORLD: 'test' }), 'test');
  assert.equal(li.WORLD_ENV_VAR, 'KOSMOS_WORLD');
});

test('#1704 the leaf\'s default id is worlds.js\'s, not a second opinion', () => {
  assert.equal(li.DEFAULT_WORLD_ID, require('./worlds').DEFAULT_ID);
});

test('#1704 THE SEPARATOR CANNOT OCCUR IN AN AGENT NAME OR A WORLD ID', () => {
  /* The whole unambiguity of parseKey rests on this. If either rule is ever
     widened to admit it, `a+b` in one world and `a` in world `b` become the same
     task, and #2828 is back. */
  const NAME_RE = ruleFrom('create.js', 'NAME_RE');
  const CLEAN_ID = ruleFrom('worlds.js', 'CLEAN_ID');
  const sep = li.WORLD_SEPARATOR;
  assert.ok(NAME_RE.test('ava') && CLEAN_ID.test('test'), 'sanity: the rules admit ordinary values');
  for (const legal of ['ava', 'a1', 'sales-bot', 'x_y']) {
    for (let i = 0; i <= legal.length; i++) {
      const withSep = legal.slice(0, i) + sep + legal.slice(i);
      assert.ok(!NAME_RE.test(withSep), JSON.stringify(withSep) + ' would be a legal agent name');
      assert.ok(!CLEAN_ID.test(withSep), JSON.stringify(withSep) + ' would be a legal world id');
    }
  }
});
