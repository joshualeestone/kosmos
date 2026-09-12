'use strict';
/**
 * #1704 / #2827 / #2828 (Mac): an agent's launchd label, plist path and tmux
 * session are keyed by its Kosmos, and the DEFAULT world is unchanged byte for
 * byte so no existing install is renamed.
 *
 *   node --test engine/world-mac-identity-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const create = require('./create');
const launchidentity = require('./launchidentity');

/* Run `body` with this process in `world` (undefined = the default world), then
   restore -- currentWorldId reads process.env.KOSMOS_WORLD. */
function inWorld(world, body) {
  const saved = process.env.KOSMOS_WORLD;
  if (world === undefined) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = world;
  try { return body(); } finally {
    if (saved === undefined) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = saved;
  }
}

test('#1704 the DEFAULT world keeps the bare label and plist path (no existing install is renamed)', () => {
  inWorld(undefined, () => {
    assert.equal(create.serviceLabel('ava'), 'com.kosmos.agent.ava');
    assert.ok(create.plistPath('ava').endsWith('com.kosmos.agent.ava.plist'));
  });
  // An explicit default world is the same as none.
  assert.equal(create.serviceLabel('ava', 'default'), 'com.kosmos.agent.ava');
});

test('#1704 a NAMED world keys the label and plist by <name>+<world>', () => {
  inWorld('client-work', () => {
    assert.equal(create.serviceLabel('ava'), 'com.kosmos.agent.ava+client-work');
    assert.ok(create.plistPath('ava').endsWith('com.kosmos.agent.ava+client-work.plist'));
  });
  // An explicit world wins over the process world.
  assert.equal(create.serviceLabel('ava', 'test'), 'com.kosmos.agent.ava+test');
});

test('#1704 parseServiceLabel is the inverse, and null for a foreign label', () => {
  assert.deepEqual(create.parseServiceLabel('com.kosmos.agent.ava'), { name: 'ava', worldId: 'default' });
  assert.deepEqual(create.parseServiceLabel('com.kosmos.agent.ava+test'), { name: 'ava', worldId: 'test' });
  assert.equal(create.parseServiceLabel('com.apple.something'), null);
  assert.equal(create.parseServiceLabel('com.kosmos.board'), null);
  assert.equal(create.parseServiceLabel(null), null);
  // Round-trips against serviceLabel for both worlds.
  assert.deepEqual(create.parseServiceLabel(create.serviceLabel('ava', 'default')), { name: 'ava', worldId: 'default' });
  assert.deepEqual(create.parseServiceLabel(create.serviceLabel('ava', 'qa-1')), { name: 'ava', worldId: 'qa-1' });
});

test('#1704 SERVICE_LABEL_PREFIX is world-INDEPENDENT (a named board must not derive it from serviceLabel(""))', () => {
  assert.equal(create.SERVICE_LABEL_PREFIX, 'com.kosmos.agent.');
  inWorld('test', () => {
    // The bug this guards: serviceLabel('') is world-dependent now.
    assert.equal(create.serviceLabel(''), 'com.kosmos.agent.+test');
    // ...so the sweeps must use the constant, which stays the namespace.
    assert.equal(create.SERVICE_LABEL_PREFIX, 'com.kosmos.agent.');
  });
});

test('#1704 the DEFAULT-world plist is byte-identical: no KOSMOS_WORLD line, bare label and session', () => {
  const dflt = inWorld(undefined, () => create.plistFor('ava', '/bin/echo', '/opt/homebrew/bin/tmux'));
  assert.doesNotMatch(dflt, /KOSMOS_WORLD/, 'a default-world plist carries no world variable');
  assert.match(dflt, /<key>Label<\/key><string>com\.kosmos\.agent\.ava<\/string>/);
  // The supervisor's first argument (the tmux session) is the bare name.
  assert.match(dflt, /<string>ava<\/string>/);
  assert.doesNotMatch(dflt, /ava\+/, 'the default session is not keyed');
});

test('#1704 a NAMED-world plist carries KOSMOS_WORLD and a keyed label + session', () => {
  const named = inWorld('test', () => create.plistFor('ava', '/bin/echo', '/opt/homebrew/bin/tmux'));
  assert.match(named, /<key>KOSMOS_WORLD<\/key><string>test<\/string>/);
  assert.match(named, /<key>Label<\/key><string>com\.kosmos\.agent\.ava\+test<\/string>/);
  assert.match(named, /<string>ava\+test<\/string>/, 'the supervisor session is the launch key');
  // The keyed session equals launchidentity.launchKey, one derivation.
  assert.ok(named.includes(`<string>${launchidentity.launchKey('ava', 'test')}</string>`));
});
