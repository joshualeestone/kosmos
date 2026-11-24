'use strict';
/* kosmos#8993: ios.yml builds the sample-board app once (job `uibuild`) and its three UI jobs test those products
   (ui-sample.sh --products) instead of each building the same app. Source pins on the workflow, so a later edit cannot
   quietly drop the sharing (and the macOS minutes come back) or point a job at products another job never uploads; and
   ui-sample.sh's two new arguments, checked where they refuse before any Xcode work. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const YML = fs.readFileSync(path.join(__dirname, '.github', 'workflows', 'ios.yml'), 'utf8');
const SAMPLE = path.join(__dirname, 'ios', 'tools', 'ui-sample.sh');

// The text of one top-level job, from its "  name:" line to the next job at the same indent.
function job(name) {
  const lines = YML.split('\n');
  const at = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(at >= 0, `premise: ios.yml has a job ${name}`);
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i += 1) if (/^ {2}[a-z][a-z0-9_-]*:\s*$/.test(lines[i])) { end = i; break; }
  return lines.slice(at, end).join('\n');
}
const ARTIFACT = 'ui-products-${{ github.run_id }}-${{ github.run_attempt }}';

test('uibuild builds once, checks it built, and uploads the products under the run\'s own name', () => {
  const b = job('uibuild');
  assert.match(b, /ios\/tools\/ui-sample\.sh --build-only "\$RUNNER_TEMP\/ui-products"/);
  assert.match(b, /grep -q '\^PASS {2}ui-sample build:'/, 'a build that printed no PASS line is red');
  assert.match(b, /actions\/upload-artifact@v4/);
  assert.ok(b.includes(`name: ${ARTIFACT}`), 'uploaded under the name the UI jobs download');
  assert.match(b, /if-no-files-found: error/, 'an empty upload is red, never a silent nothing');
});

test('every UI job needs uibuild, downloads that same artifact, and tests it with --products', () => {
  for (const name of ['ui', 'uikit']) {
    const j = job(name);
    assert.match(j, /\n {4}needs: uibuild\n/, `${name} waits for the build`);
    assert.match(j, /actions\/download-artifact@v4/, `${name} downloads the products`);
    assert.ok(j.includes(`name: ${ARTIFACT}`), `${name} downloads the artifact uibuild uploads`);
    assert.match(j, /ui-sample\.sh[^\n]* --products "\$RUNNER_TEMP\/ui-products"/, `${name} tests the shared products`);
  }
  assert.match(job('uikit'), /--uikit --shard "\$\{\{ matrix\.shard \}\}" --products/, 'both UIKit halves keep their shard');
});

test('CONTROL: the job reader can fail (a job that does not exist)', () => {
  assert.throws(() => job('no-such-job'));
});

test('ui-sample.sh refuses --build-only with a test option, and either option with no folder, before any Xcode work', () => {
  const run = (...args) => spawnSync('bash', [SAMPLE, ...args], { encoding: 'utf8', timeout: 20000 });
  for (const [args, said] of [
    [['--build-only'], /--build-only takes a folder/],
    [['--products'], /--products takes a folder/],
    [['--uikit', '--build-only', '/nonexistent/x'], /--build-only takes no other option/],
    [['--build-only', '/nonexistent/x', '--products', '/nonexistent/y'], /--build-only takes no other option/],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status} ${r.stderr}`);
    assert.match(r.stderr, said);
  }
});
