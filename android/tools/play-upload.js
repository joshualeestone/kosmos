'use strict';
/**
 * #4090 piece 2: upload a signed AAB to the Google Play Developer API internal
 * track, dependency-free (node:crypto for the RS256 JWT, global fetch for the
 * calls). It mints a service-account OAuth token, opens an edit, uploads the
 * bundle, points the track's release at that versionCode, and either COMMITS or,
 * under --dry-run, VALIDATES and DELETES the edit so nothing is published.
 *
 * 🔑 THE SERVICE-ACCOUNT KEY IS READ ONLY THROUGH `secrets-map.sh path <target>`
 * (default target `play-upload-service-account`), never from a hand-rolled path,
 * and neither the key bytes nor the access token are ever handed to `log`. The
 * token lives only in the Authorization header this tool sends; it is never
 * printed, and errors echo the server's response, never the request.
 *
 * Run:
 *   node android/tools/play-upload.js --aab <path> [--track internal]
 *        [--status completed|draft] [--dry-run] [--package io.kosmos.app]
 *        [--key-target play-upload-service-account]
 *
 * Testable: `run()` takes injectable `fetchImpl`, `resolveKeyPath`, `now`, `log`
 * and an `apiBase`, so the stub-server unit test drives the whole flow offline.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const DEFAULTS = Object.freeze({
  pkg: 'io.kosmos.app',
  track: 'internal',
  status: 'completed',
  keyTarget: 'play-upload-service-account',
  apiBase: 'https://androidpublisher.googleapis.com',
  scope: 'https://www.googleapis.com/auth/androidpublisher',
});

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Resolve the SA key file path through the secrets map ONLY (never a passed-in
   path): the map is the single source of truth, and a hand-rolled path is exactly
   the wrong-credential hazard the map exists to remove. */
function defaultResolveKeyPath(target) {
  const out = execFileSync('secrets-map.sh', ['path', target], { encoding: 'utf8' });
  const p = out.trim();
  if (!p) throw new Error(`secrets-map.sh path ${target} returned nothing`);
  return p;
}

function parseArgs(argv) {
  const o = {
    aab: null, pkg: DEFAULTS.pkg, track: DEFAULTS.track, status: DEFAULTS.status,
    dryRun: false, keyTarget: DEFAULTS.keyTarget,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--aab': o.aab = next(); break;
      case '--package': o.pkg = next(); break;
      case '--track': o.track = next(); break;
      case '--status': o.status = next(); break;
      case '--key-target': o.keyTarget = next(); break;
      case '--dry-run': o.dryRun = true; break;
      default: throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!o.aab) throw new Error('--aab <path> is required');
  if (o.status !== 'completed' && o.status !== 'draft') {
    throw new Error(`--status must be completed or draft (got ${o.status})`);
  }
  return o;
}

/* Build and sign the RS256 assertion, exchange it for an access token. The token
   is returned to the caller's closure and never logged. */
async function mintToken({ key, fetchImpl, now }) {
  const iat = Math.floor(now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email,
    scope: DEFAULTS.scope,
    aud: key.token_uri,
    iat,
    exp: iat + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signature = b64url(crypto.createSign('RSA-SHA256').update(signingInput).sign(key.private_key));
  const assertion = `${signingInput}.${signature}`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetchImpl(key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`token endpoint returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error('token endpoint returned no access_token');
  return json.access_token;
}

/* One authenticated API call. The Authorization header carries the token and is
   never logged; on a non-2xx we surface the SERVER's response text, not our request. */
async function api(fetchImpl, token, method, url, { body, contentType, raw } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  let payload;
  if (raw !== undefined) { payload = raw; headers['content-type'] = contentType; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const res = await fetchImpl(url, { method, headers, body: payload });
  if (!res.ok) {
    throw new Error(`${method} ${url.replace(/\?.*$/, '')} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function run(opts = {}) {
  const {
    argv = process.argv.slice(2),
    env = process.env,
    fetchImpl = globalThis.fetch,
    resolveKeyPath = defaultResolveKeyPath,
    now = Date.now,
    log = (m) => process.stdout.write(`${m}\n`),
    apiBase = DEFAULTS.apiBase,
  } = opts;
  void env;

  const o = parseArgs(argv);
  const aabBytes = fs.readFileSync(o.aab);
  const key = JSON.parse(fs.readFileSync(resolveKeyPath(o.keyTarget), 'utf8'));
  if (!key.client_email || !key.private_key || !key.token_uri) {
    throw new Error('service-account key is missing client_email, private_key or token_uri');
  }

  const token = await mintToken({ key, fetchImpl, now });
  log(`authenticated as ${key.client_email}`);

  const editsUrl = `${apiBase}/androidpublisher/v3/applications/${encodeURIComponent(o.pkg)}/edits`;
  const edit = await api(fetchImpl, token, 'POST', editsUrl);
  const editId = edit.id;
  if (!editId) throw new Error('edits.insert returned no edit id');
  log(`opened edit ${editId}`);

  const uploadUrl = `${apiBase}/upload/androidpublisher/v3/applications/${encodeURIComponent(o.pkg)}/edits/${encodeURIComponent(editId)}/bundles?uploadType=media`;
  const bundle = await api(fetchImpl, token, 'POST', uploadUrl, { raw: aabBytes, contentType: 'application/octet-stream' });
  const versionCode = bundle.versionCode;
  if (!versionCode) throw new Error('bundles.upload returned no versionCode');
  log(`uploaded bundle, versionCode ${versionCode}`);

  const trackUrl = `${editsUrl}/${encodeURIComponent(editId)}/tracks/${encodeURIComponent(o.track)}`;
  await api(fetchImpl, token, 'PUT', trackUrl, {
    body: { track: o.track, releases: [{ status: o.status, versionCodes: [String(versionCode)] }] },
  });
  log(`set track ${o.track} release to ${o.status} for versionCode ${versionCode}`);

  if (o.dryRun) {
    await api(fetchImpl, token, 'POST', `${editsUrl}/${encodeURIComponent(editId)}:validate`);
    log('dry-run: edit validated');
    await api(fetchImpl, token, 'DELETE', `${editsUrl}/${encodeURIComponent(editId)}`);
    log('dry-run: edit deleted, nothing was published');
    return { editId, versionCode, committed: false, validated: true };
  }

  await api(fetchImpl, token, 'POST', `${editsUrl}/${encodeURIComponent(editId)}:commit`);
  log(`committed edit ${editId}: versionCode ${versionCode} is live on track ${o.track}`);
  return { editId, versionCode, committed: true, validated: false };
}

module.exports = { run, parseArgs, b64url };

if (require.main === module) {
  run().then(
    (r) => { process.exit(r && r.committed === false && !r.validated ? 1 : 0); },
    (e) => { process.stderr.write(`play-upload: ${e.message}\n`); process.exit(1); },
  );
}
