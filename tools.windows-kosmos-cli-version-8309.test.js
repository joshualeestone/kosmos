'use strict';
/* kosmos#8309: the Windows `kosmos version` (also --version, -v) names the version and the build, as install/kosmos
   does since #8299: "0.8.00 (build e224150682)". The version is the install's app/package.json, the build the zip's
   manifest.json source_sha. Driven in-process against throwaway install folders (the installRoot seam), so it runs on
   any host; nothing reaches a board: the hook and fetch below throw if touched. */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('./tools/windows/kosmos-cli');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win-version-8309-'));
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));

let n = 0;
/* An install folder with the given app/package.json and manifest.json (null leaves a file out; a string is written raw). */
function install(pkg, manifest) {
  const root = path.join(SB, 'k' + (n += 1));
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  const put = (rel, v) => { if (v !== null) fs.writeFileSync(path.join(root, rel), typeof v === 'string' ? v : JSON.stringify(v)); };
  put(path.join('app', 'package.json'), pkg);
  put('manifest.json', manifest);
  return root;
}
const SHA = 'e224150682004e888738e91ef905bbe52f3d9697';
const MAN = (extra) => ({ product: 'kosmos', platform: 'win32', version: '9.9.9', source_sha: SHA, source_dirty: false, ...extra });

/* main() with a board that must not be reached: any touch of the hook, fetch or the outbox fails the test. */
const untouchable = (what) => new Proxy({}, { get: (_, k) => { throw new Error(what + ' was touched (' + String(k) + ')'); } });
async function run(argv, root) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, installRoot: root, out: (s) => out.push(s), err: (s) => err.push(s),
    hook: untouchable('the report hook'), outbox: untouchable('the outbox'),
    fetch: async () => { throw new Error('a request was made'); },
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('#8309: the version line names the build, on every spelling, and sends nothing', async () => {
  const root = install({ version: '9.9.9' }, MAN());
  for (const flag of ['version', '--version', '-v']) {
    const r = await run([flag], root);
    assert.equal(r.code, 0, flag + ': ' + r.err);
    assert.equal(r.out, '9.9.9 (build e224150682)', flag);
  }
});

test('#8309: a build from a dirty tree says so, as the Mac and Linux bundles do', async () => {
  assert.equal(cli.versionLine(install({ version: '9.9.9' }, MAN({ source_dirty: true }))), '9.9.9 (build e224150682-dirty)');
  assert.equal(cli.versionLine(install({ version: '9.9.9' }, MAN({ source_dirty: 'yes' }))), '9.9.9 (build e224150682)', 'only true means dirty');
});

test('#8309: the version is the app package\'s, and the manifest\'s only when the package says none', () => {
  assert.equal(cli.versionLine(install({ version: '9.9.10' }, MAN())), '9.9.10 (build e224150682)', 'the app that runs is the one named');
  assert.equal(cli.versionLine(install(null, MAN())), '9.9.9 (build e224150682)', 'no app package');
  assert.equal(cli.versionLine(install('not json', MAN())), '9.9.9 (build e224150682)', 'an unreadable app package');
});

test('#8309: with no build to name, the version alone (best effort, as the Mac)', () => {
  assert.equal(cli.versionLine(install({ version: '9.9.9' }, null)), '9.9.9', 'no manifest');
  assert.equal(cli.versionLine(install({ version: '9.9.9' }, '{ broken')), '9.9.9', 'a manifest that is not JSON');
  assert.equal(cli.versionLine(install({ version: '9.9.9' }, MAN({ source_sha: undefined }))), '9.9.9', 'no commit recorded');
  assert.equal(cli.versionLine(install({ version: '9.9.9' }, MAN({ source_sha: 'unknown' }))), '9.9.9', 'a commit that is not one');
  assert.equal(cli.versionLine(install({ version: '9.9.9' }, MAN({ source_sha: 'e2241; rm -rf' }))), '9.9.9', 'nothing but hex is printed as a build');
});

test('#8309: neither file naming a version is said, with exit 1, and still sends nothing', async () => {
  const r = await run(['--version'], install(null, null));
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /no version found/);
  assert.equal(cli.versionLine(install({ version: 'a b' }, { version: '<x>' })), null, 'a version that is not a version is not printed');
});

test('#8309: extra words are refused with the usage; --help shows it; both send nothing', async () => {
  const root = install({ version: '9.9.9' }, MAN());
  const extra = await run(['version', 'now'], root);
  assert.equal(extra.code, 2);
  assert.equal(extra.err, cli.USAGE.version);
  const help = await run(['version', '--help'], root);
  assert.equal(help.code, 0);
  assert.equal(help.out, cli.USAGE.version);
});

test('#8309: the command list names it, in the Mac\'s words', async () => {
  const r = await run(['--help'], install({ version: '9.9.9' }, MAN()));
  assert.equal(r.code, 0);
  assert.match(r.out, /^ {2}kosmos version +say which version and build of Kosmos this is \(also --version or -v\)$/m);
});
