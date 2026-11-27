'use strict';
/*
 * kosmos#9180, the two CLIs. The Mac `kosmos feedback pull` runs for real (install/kosmos, the real engine) against a
 * loopback stand-in for the blob store (AGENT_WORKFORCE_BLOB_API, which the token check lets an http loopback origin
 * receive). The token comes from the module's own test seam (setSecretsRunner), set by a preload in the CLI's node
 * (NODE_OPTIONS), so this test NEVER asks the operator's real secrets map: a stand-in secrets-map.sh on PATH was tried
 * and lost to a real one placed ahead of it. Progress goes to stderr, a second pull fetches nothing,
 * --all fetches everything, an unknown option is still refused. The Windows CLI is driven through its engine seam,
 * as tools.windows-kosmos-cli-570.test.js does: --all and a progress writer reach pull, and progress goes to err.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const REC = (install, date, body) => ({ install, date, generated_at: date + 'T12:00:00.000Z', consent: { given: true, version: 'v1' }, body });

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbpull-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbpull-data-'));
  // Loaded into the CLI's node before its script: the same module instance (node resolves the app/engine symlink to
  // this checkout's engine), so the pull gets a test token and the secrets map is never run. Any other call is refused.
  const preload = path.join(data, 'token-seam.js');
  fs.writeFileSync(preload, 'require(' + JSON.stringify(path.join(__dirname, 'engine', 'feedbackpull')) + ').setSecretsRunner((bin, args) => '
    + '(args[0] === "value" ? { status: 0, stdout: "vercel_blob_rw_cli9180\\n", stderr: "" } : { status: 9, stdout: "", stderr: "test seam: only value" }));\n');
  return { home, data, preload };
}

function storeServer(records) {
  const gets = [];
  const blobs = {};
  const srv = http.createServer((req, res) => {
    // Review 1: only the seam's test token is served. A real token (the real secrets map answering, if the preload ever
    // set the seam on another module instance) gets a 401, so the run fails instead of passing on a real credential.
    if (req.headers.authorization !== 'Bearer vercel_blob_rw_cli9180') { srv.refused += 1; res.statusCode = 401; res.end('no'); return; }
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/' && u.searchParams.get('prefix') === 'feedback/') {
      const base = 'http://127.0.0.1:' + srv.address().port;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ hasMore: false, blobs: Object.keys(blobs).map((p, i) => ({ pathname: p, url: base + '/' + p, uploadedAt: '2026-11-26T00:00:0' + i + '.000Z', size: blobs[p].length })) }));
      return;
    }
    const p = u.pathname.slice(1);
    if (Object.prototype.hasOwnProperty.call(blobs, p)) { gets.push(p); res.end(blobs[p]); return; }
    res.statusCode = 404; res.end('no');
  });
  srv.refused = 0;
  records.forEach((r, i) => { blobs['feedback/r' + i + '.json'] = JSON.stringify(r); });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, gets, api: 'http://127.0.0.1:' + srv.address().port })));
}

function run(args, { home, data, preload }, api) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NODE_PRESERVE_SYMLINKS: '', KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: data, HOME: data, NODE_OPTIONS: '--require ' + preload,
      AGENT_WORKFORCE_BLOB_API: api, KOSMOS_PORT: '9', KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' };
    const child = spawn('bash', [CLI, 'feedback', 'pull', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(killer);
      // #3628: a killed CLI has no exit code; that is a hang, never a result to compare.
      const res = { code, out, err };
      if (typeof res.code !== 'number') { reject(new Error('the CLI gave no exit code (' + signal + '): it hung')); return; }
      resolve(res);
    });
  });
}

test('Mac CLI: progress on stderr, a second pull fetches nothing, --all fetches all, an unknown option is refused', async (t) => {
  const box = makeHome();
  const st = await storeServer([REC('a', '2026-11-25', 'one'), REC('b', '2026-11-25', 'two')]);
  t.after(() => st.srv.close());
  const dir = path.join(box.data, 'pulled');
  const first = await run(['--dir', dir], box, st.api);
  assert.equal(first.code, 0, first.out + first.err);
  assert.equal(st.gets.length, 2, 'fixture: the first pull fetched both reports: ' + first.err);
  assert.match(first.err, /^pulling feedback: 0 of 2 read\.\.\.$/m, 'no progress line on stderr: ' + JSON.stringify(first.err));
  assert.doesNotMatch(first.out, /pulling feedback/, 'progress went to stdout');
  assert.match(first.out, /^pulled 2 report\(s\) to /m, first.out);
  const second = await run(['--dir', dir], box, st.api);
  assert.equal(second.code, 0, second.out + second.err);
  assert.equal(st.gets.length, 3, 'the second pull fetched reports already in the folder (one check read is expected)');
  assert.match(second.out, /^pulled 0 report\(s\), 2 already here to /m, second.out);
  const all = await run(['--dir', dir, '--all'], box, st.api);
  assert.equal(all.code, 0, all.out + all.err);
  assert.equal(st.gets.length, 5, '--all did not fetch every report again');
  const bad = await run(['--every'], box, st.api);
  assert.equal(bad.code, 2, 'an unknown option was not refused: ' + bad.out + bad.err);
  assert.equal(st.gets.length, 5, 'a refused option still pulled');
  assert.equal(st.srv.refused, 0, 'a request reached the store without the test token');
});

test('Windows CLI: --all and a progress writer reach pull, progress goes to err, an unknown option is refused', async () => {
  const cli = require('./tools/windows/kosmos-cli');
  const real = require('./engine/feedbackpull');
  const seen = [];
  const engine = { feedbackpull: {
    pull: async (dir, opts) => { seen.push({ dir, opts }); opts.onProgress({ fetched: 0, toFetch: 3, alreadyHere: 1, total: 4 }); return { ok: true, written: 3, alreadyHere: 1, skipped: 0, total: 4, dir: dir || '/x' }; },
    summaryLines: real.summaryLines, nextLine: () => 'next: kosmos feedback triage', progressLine: real.progressLine,
  } };
  const go = async (argv) => {
    const out = []; const err = [];
    const code = await cli.main(argv, { env: {}, engine, out: (s) => out.push(s), err: (s) => err.push(s), fetch: async () => { throw new Error('reached the network'); } });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const r = await go(['feedback', 'pull', '--dir', '/x', '--all']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(seen.length, 1); assert.equal(seen[0].opts.all, true, '--all did not reach pull');
  assert.match(r.err, /^pulling feedback: 0 of 3 read \(1 already here\)\.\.\.$/m, 'progress was not written to err: ' + r.err);
  assert.match(r.out, /pulled 3 report\(s\), 1 already here to \/x/, r.out);
  const plain = await go(['feedback', 'pull']);
  assert.equal(plain.code, 0); assert.equal(seen[1].opts.all, false, 'a plain pull asked for --all');
  assert.equal((await go(['feedback', 'pull', '--every'])).code, 2, 'an unknown option was not refused');
});
