'use strict';
/**
 * The agents' own private browser (engine/agentbrowser.js).
 *
 * Every arm runs on any host: the platform is a parameter, the install's network,
 * tar and prove steps are seams, and the managed root is a sandbox. The live proof
 * (a real `claude -p` reading a JS-rendered page through this config) is recorded
 * on the PR, because no suite may drive a real browser.
 *
 *   node --test engine/agentbrowser.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentbrowser-')));
process.env.AGENT_WORKFORCE_RUNNERS_DIR = path.join(SANDBOX, 'runners');

const ab = require('./agentbrowser');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* A fake install: every step succeeds without the network, tar or a real server. */
const fakeSeams = (over) => Object.assign({
  download: async (url, file) => fs.writeFileSync(file, url),
  integrityOf: async (file) => ab.PIN.packages.find((p) => p.url === fs.readFileSync(file, 'utf8')).integrity,
  unpack: async (tgz, dest) => fs.writeFileSync(path.join(dest, dest.endsWith('mcp') ? 'cli.js' : 'package.json'), '//'),
  prove: async () => 'Version ' + ab.PIN.version + '\n',
}, over || {});

test('the pin is exact: three registry tarballs at fixed versions with sha512 integrity', () => {
  assert.equal(ab.PIN.version, '0.0.82');
  assert.deepEqual(ab.PIN.packages.map((p) => p.name), ['@playwright/mcp', 'playwright', 'playwright-core']);
  for (const p of ab.PIN.packages) {
    assert.match(p.url, /^https:\/\/registry\.npmjs\.org\/.+-\d[^/]*\.tgz$/, 'a versioned tarball, never a "latest"');
    assert.match(p.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
  }
  assert.ok(Object.isFrozen(ab.PIN) && Object.isFrozen(ab.PIN.packages[0]), 'the trust anchors cannot be repointed in-process');
});

test('the config: Edge, headless, isolated profile, output kept out of the agent folder', () => {
  const cfg = ab.configFor({ node: 'C:\\K\\runtime\\node.exe', cli: 'C:\\R\\cli.js', outputDir: 'C:\\T\\out' });
  assert.deepEqual(cfg, {
    mcpServers: {
      'kosmos-browser': {
        type: 'stdio',
        command: 'C:\\K\\runtime\\node.exe',
        args: ['C:\\R\\cli.js', '--browser', 'msedge', '--headless', '--isolated', '--output-dir', 'C:\\T\\out'],
      },
    },
  });
  const args = cfg.mcpServers['kosmos-browser'].args;
  for (const never of ['--extension', '--user-data-dir', '--cdp-endpoint', '--profile-dir-name']) {
    assert.ok(!args.includes(never), never + ' would reach the person\'s own browser or profile');
  }
});

test('launchConfig is Windows-only, honours the opt-out, and is null until installed', () => {
  assert.equal(ab.launchConfig({ platform: 'darwin' }), null, 'a Mac launch is untouched');
  assert.equal(ab.launchConfig({ platform: 'win32', env: { KOSMOS_AGENT_BROWSER: 'off' } }), null);
  assert.equal(ab.isInstalled(), false);
  assert.equal(ab.launchConfig({ platform: 'win32', install: false }), null,
    'not installed yet = launch without a browser, never a flag naming a file that is not there');
  assert.equal(fs.existsSync(ab.configPath()), false);
});

test('a checksum mismatch installs nothing', async () => {
  const r = await ab.ensureInstalled(fakeSeams({ integrityOf: async () => 'sha512-wrong' }));
  assert.equal(r.ok, false);
  assert.match(r.because, /checksum/);
  assert.equal(ab.isInstalled(), false);
  assert.equal(fs.existsSync(ab.treeDir()), false, 'no tree under the live name');
  assert.deepEqual(fs.readdirSync(ab.homeDir()).filter((f) => f.startsWith('.staging')), [], 'staging cleaned up');
});

test('a server that does not answer with its version installs nothing', async () => {
  const r = await ab.ensureInstalled(fakeSeams({ prove: async () => 'something else' }));
  assert.equal(r.ok, false);
  assert.equal(ab.isInstalled(), false);
});

test('a proven install, then every launch gets a flag for a file holding exactly the config', async () => {
  const r = await ab.ensureInstalled(fakeSeams());
  assert.deepEqual(r, { ok: true });
  assert.equal(ab.isInstalled(), true);
  assert.deepEqual(await ab.ensureInstalled(fakeSeams({ download: async () => { throw new Error('must not download again'); } })),
    { ok: true, already: true });

  const p = ab.launchConfig({ platform: 'win32', node: 'C:\\K\\node.exe' });
  assert.equal(p, ab.configPath());
  const written = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepEqual(written, ab.configFor({ node: 'C:\\K\\node.exe', cli: ab.cliPath(), outputDir: ab.outputDir() }));

  /* A damaged file is repaired, because a bad --mcp-config stops claude starting. */
  fs.writeFileSync(p, '{ not json');
  assert.equal(ab.launchConfig({ platform: 'win32', node: 'C:\\K\\node.exe' }), p);
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), written);
});
