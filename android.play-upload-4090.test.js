'use strict';
/**
 * #4090 piece 2: android/tools/play-upload.js against a stub Play Developer API.
 *
 * A real local http server scripts the token + edits endpoints and records every
 * call, so the whole flow runs offline. A throwaway RSA keypair backs the stub
 * service-account JSON, so the tool's RS256 assertion actually signs. The arms
 * pin: the normal commit sequence, that --dry-run validates+deletes and NEVER
 * commits, that --status draft reaches the track, and that neither the access
 * token nor the key is ever handed to `log` or surfaced in an error.
 *
 *   node --test android.play-upload-4090.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { run } = require('./android/tools/play-upload');

const ACCESS_TOKEN = 'stub-access-token-do-not-log-abc123';
const PKG = 'io.kosmos.app';
const AAB_BYTES = Buffer.from('PK\x03\x04 stub aab bytes \x00\x01\x02', 'binary');

/* A throwaway SA key: the tool must be able to sign a real RS256 assertion. */
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/* Start a stub server. `opts.failOn` (a path substring) makes that call 403.
   Returns { base, calls, close, keyPath, aabPath }. */
async function stub(opts = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);
      const rec = { method: req.method, path: req.url.replace(/\?.*$/, ''), query: req.url, bodyBuf, auth: req.headers.authorization || '' };
      calls.push(rec);
      if (opts.failOn && rec.path.includes(opts.failOn)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'stub denied' } }));
        return;
      }
      const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (rec.path === '/token') return send({ access_token: ACCESS_TOKEN, token_type: 'Bearer', expires_in: 3600 });
      if (req.method === 'POST' && rec.path.endsWith('/edits')) return send({ id: 'edit-xyz' });
      if (req.method === 'POST' && rec.path.includes('/upload/') && rec.path.endsWith('/bundles')) return send({ versionCode: 42 });
      if (req.method === 'PUT' && rec.path.includes('/tracks/')) return send(JSON.parse(bodyBuf.toString() || '{}'));
      if (req.method === 'POST' && rec.path.endsWith(':commit')) return send({});
      if (req.method === 'POST' && rec.path.endsWith(':validate')) return send({});
      if (req.method === 'DELETE' && /\/edits\/[^/]+$/.test(rec.path)) return send({});
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-upload-test-'));
  const keyPath = path.join(dir, 'sa.json');
  fs.writeFileSync(keyPath, JSON.stringify({
    client_email: 'kosmos-play@example.iam.gserviceaccount.com',
    private_key: privateKey,
    token_uri: `${base}/token`,
  }));
  const aabPath = path.join(dir, 'app-release.aab');
  fs.writeFileSync(aabPath, AAB_BYTES);

  return {
    base, calls, keyPath, aabPath,
    close: () => new Promise((r) => server.close(r)),
  };
}

function runTool(s, extraArgs, logSink) {
  return run({
    argv: ['--aab', s.aabPath, ...extraArgs],
    resolveKeyPath: () => s.keyPath,
    apiBase: s.base,
    now: () => 1_700_000_000_000,
    log: (m) => logSink.push(m),
  });
}

test('normal run: insert -> upload -> track(internal,completed) -> commit', async () => {
  const s = await stub();
  const logs = [];
  try {
    const r = await runTool(s, [], logs);
    const seq = s.calls.map((c) => `${c.method} ${c.path}`);
    assert.deepEqual(seq, [
      'POST /token',
      `POST /androidpublisher/v3/applications/${PKG}/edits`,
      `POST /upload/androidpublisher/v3/applications/${PKG}/edits/edit-xyz/bundles`,
      `PUT /androidpublisher/v3/applications/${PKG}/edits/edit-xyz/tracks/internal`,
      `POST /androidpublisher/v3/applications/${PKG}/edits/edit-xyz:commit`,
    ], `sequence was ${JSON.stringify(seq)}`);
    // the uploaded bytes are the AAB, verbatim
    const upload = s.calls.find((c) => c.path.includes('/bundles'));
    assert.ok(upload.bodyBuf.equals(AAB_BYTES), 'uploaded bytes are not the AAB');
    // the track release names the returned versionCode, completed
    const track = s.calls.find((c) => c.path.includes('/tracks/'));
    assert.deepEqual(JSON.parse(track.bodyBuf.toString()), {
      track: 'internal', releases: [{ status: 'completed', versionCodes: ['42'] }],
    });
    assert.deepEqual(r, { editId: 'edit-xyz', versionCode: 42, committed: true, validated: false });
  } finally { await s.close(); }
});

test('--dry-run: validate + delete, and NEVER commit', async () => {
  const s = await stub();
  const logs = [];
  try {
    const r = await runTool(s, ['--dry-run'], logs);
    const seq = s.calls.map((c) => `${c.method} ${c.path}`);
    assert.deepEqual(seq.slice(-2), [
      `POST /androidpublisher/v3/applications/${PKG}/edits/edit-xyz:validate`,
      `DELETE /androidpublisher/v3/applications/${PKG}/edits/edit-xyz`,
    ]);
    assert.ok(!seq.some((c) => c.endsWith(':commit')), 'dry-run must not commit, but a commit call was made');
    assert.deepEqual(r, { editId: 'edit-xyz', versionCode: 42, committed: false, validated: true });
  } finally { await s.close(); }
});

test('--status draft reaches the track release', async () => {
  const s = await stub();
  const logs = [];
  try {
    await runTool(s, ['--status', 'draft'], logs);
    const track = s.calls.find((c) => c.path.includes('/tracks/'));
    assert.equal(JSON.parse(track.bodyBuf.toString()).releases[0].status, 'draft');
  } finally { await s.close(); }
});

test('security: the token and key are never logged, and a 403 does not leak the token', async () => {
  const s = await stub({ failOn: '/edits' });
  const logs = [];
  try {
    await assert.rejects(runTool(s, [], logs), (e) => {
      assert.ok(!e.message.includes(ACCESS_TOKEN), 'error message leaked the access token');
      assert.match(e.message, /403/);
      return true;
    });
    // nothing handed to log may contain the token or the private key
    const joined = logs.join('\n');
    assert.ok(!joined.includes(ACCESS_TOKEN), 'a log line leaked the access token');
    assert.ok(!joined.includes('PRIVATE KEY'), 'a log line leaked key material');
    // the tool DID authenticate with a Bearer token on the API call (sanity: it was sent, just never logged)
    const apiCall = s.calls.find((c) => c.path.endsWith('/edits'));
    assert.match(apiCall.auth, /^Bearer /);
  } finally { await s.close(); }
});

test('a malformed service-account key fails generically, never echoing its content', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-upload-badkey-'));
  const keyPath = path.join(dir, 'bad.json');
  const aabPath = path.join(dir, 'app.aab');
  // Invalid JSON that embeds secret-looking material, so a leaked parse snippet would show.
  fs.writeFileSync(keyPath, '{"private_key":"SUPERSECRETKEYMATERIAL-should-never-surface" oops not json');
  fs.writeFileSync(aabPath, AAB_BYTES);
  await assert.rejects(
    run({ argv: ['--aab', aabPath], resolveKeyPath: () => keyPath, apiBase: 'http://127.0.0.1:1', log: () => {} }),
    (e) => {
      assert.match(e.message, /is not valid JSON/);
      assert.ok(!e.message.includes('SUPERSECRETKEYMATERIAL'), 'the parse error leaked key file content');
      return true;
    },
  );
});

test('argument errors are loud', async () => {
  await assert.rejects(run({ argv: [], resolveKeyPath: () => '/nope', apiBase: 'http://127.0.0.1:1', log: () => {} }), /--aab/);
  await assert.rejects(run({ argv: ['--aab', 'x', '--status', 'live'], resolveKeyPath: () => '/nope', apiBase: 'http://127.0.0.1:1', log: () => {} }), /--status must be/);
});
