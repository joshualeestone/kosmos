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
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const create = require('./create');
const launchidentity = require('./launchidentity');
const remove = require('./remove');

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

test('#2828 a remove in world B cannot reach the DEFAULT world\'s like-named agent', () => {
  // The core cross-Kosmos collision this lane fixes: `ava` exists in Kosmos 1
  // (the default), and removing `ava` while the board serves world `b` must
  // resolve b's OWN label (com.kosmos.agent.ava+b), find no plist for it, and
  // touch nothing -- never the default's com.kosmos.agent.ava.plist. jobFor
  // resolves the label via create.serviceLabel (defaulting to the board's
  // currentWorldId) and only acts on a plist that exists.
  const agentsDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-la-'));
  const savedLaunch = process.env.AGENT_WORKFORCE_LAUNCH;
  const savedWorld = process.env.KOSMOS_WORLD;
  process.env.AGENT_WORKFORCE_LAUNCH = agentsDir;
  try {
    // Only the DEFAULT world's ava has a plist on disk.
    fs.writeFileSync(nodePath.join(agentsDir, 'com.kosmos.agent.ava.plist'), '<plist/>');

    process.env.KOSMOS_WORLD = 'b';
    assert.equal(remove.jobFor('ava', 'darwin'), null,
      'a remove in world b resolves ava+b, which has no plist, so it reaches nothing');

    delete process.env.KOSMOS_WORLD;
    const j = remove.jobFor('ava', 'darwin');
    assert.ok(j, 'the default board finds its own ava');
    assert.equal(j.label, 'com.kosmos.agent.ava', 'and targets the bare default-world label');
  } finally {
    if (savedLaunch === undefined) delete process.env.AGENT_WORKFORCE_LAUNCH; else process.env.AGENT_WORKFORCE_LAUNCH = savedLaunch;
    if (savedWorld === undefined) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = savedWorld;
    fs.rmSync(agentsDir, { recursive: true, force: true });
  }
});

test('#1704 the launchd label namespace is built in ONE place (no `com.kosmos.agent.` assembled outside create.js)', () => {
  // The plan's weakest-premise guard: a future enumeration or launch site that
  // builds the label from a bare name would re-open the cross-Kosmos collision.
  // serviceLabel (via SERVICE_LABEL_PREFIX) in create.js is the only sanctioned
  // builder; parseServiceLabel (also create.js) is the only reader. Any OTHER
  // engine file naming the literal is a candidate stray site.
  const dir = __dirname;
  const offenders = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f.endsWith('.test.js') || f === 'create.js') continue;
    // Strip block comments then line comments, so only CODE is checked: the many
    // JSDoc mentions of the label ("~/Library/LaunchAgents/ 1 job com.kosmos.agent.anna")
    // are documentation, not a construction site.
    const code = fs.readFileSync(nodePath.join(dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    if (code.includes('com.kosmos.agent.')) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    'the launchd label is named in CODE outside create.serviceLabel/parseServiceLabel: ' + offenders.join(', '));
});
