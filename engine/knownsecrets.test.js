'use strict';
/**
 * #3769: the values the board holds, for masking the setup guide's words by value. Every place Kosmos keeps
 * a key is read; a file elsewhere, and a value too short to be a key, are not.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collect } = require('./knownsecrets');

test('#3769 collect reads the board token, the secrets folder and every account key file, and nothing else', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-known-')));
  try {
    const data = path.join(root, 'data');
    const home = path.join(root, 'home');
    const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
    put(path.join(data, 'board.token'), 'boardtoken0123456789abcdef\n');
    put(path.join(data, 'secrets', 'cloudflare.token'), 'cf-token-0123456789abcd\n');
    put(path.join(data, 'secrets', 'env', 'BRAVE_API_KEY'), 'brave-key-0123456789ab\n');
    put(path.join(data, 'secrets', 'deploy.env'), 'API_TOKEN="quoted-0123456789ab"\n');
    put(path.join(home, '.claude-work', '.kosmos-claude-apikey'), 'sk-ant-api03-work0123456789abcdef\n');
    put(path.join(home, '.gemini', '.kosmos-gemini-apikey'), 'AIzaSyGemini0123456789abcdefghij\n');
    put(path.join(home, '.grok-team', '.kosmos-grok-apikey'), 'xai-grok0123456789abcdef\n');
    put(path.join(home, '.codex-x', 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-codex0123456789abcdef' }));
    put(path.join(home, 'notes', 'todo.txt'), 'not-a-kosmos-secret-0123456789\n');          // CONTROL: not a Kosmos place
    put(path.join(home, '.claude-work', 'README.md'), 'readme-text-0123456789abcdef\n');          // CONTROL: not a key file
    put(path.join(data, 'secrets', 'short'), 'tiny\n');
    const got = new Set(collect({ dataRoot: data, home }));
    for (const v of ['boardtoken0123456789abcdef', 'cf-token-0123456789abcd', 'brave-key-0123456789ab', 'quoted-0123456789ab',
      'sk-ant-api03-work0123456789abcdef', 'AIzaSyGemini0123456789abcdefghij', 'xai-grok0123456789abcdef', 'sk-proj-codex0123456789abcdef']) {
      assert.ok(got.has(v), 'missed a held value: ' + v.slice(0, 10));
    }
    assert.ok(!got.has('not-a-kosmos-secret-0123456789'), 'read a file outside the places Kosmos keeps keys');
    assert.ok(!got.has('readme-text-0123456789abcdef'), 'read a file in an account folder that is not a key file');
    assert.ok(!got.has('tiny'), 'kept a value too short to be a key');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('#3769 collect never throws on a missing or unreadable place', () => {
  assert.deepEqual(collect({ dataRoot: '/nonexistent/kosmos', home: '/nonexistent/home' }), []);
});

test('#3935 assignedValue: the value a secrets-file line assigns to a public name, or null', () => {
  const { assignedValue } = require('./knownsecrets');
  const cases = [
    ['CF_API_TOKEN=AbCdEf123456ZzYy', 'AbCdEf123456ZzYy'],
    ['export CF_API_TOKEN=AbCdEf123456ZzYy', 'AbCdEf123456ZzYy'],
    ['CF_API_TOKEN=AbCdEf123456ZzYy # rotated', 'AbCdEf123456ZzYy'],
    ['PASS="my long pass phrase 9"', 'my long pass phrase 9'],
    ['r2_secret_access_key: Qw8eRt2yUi9oPa3s', 'Qw8eRt2yUi9oPa3s'],
    ['  "webhook_url_v2": "Mn4bVc7xZa1sDf3g",', 'Mn4bVc7xZa1sDf3g'],
    ['# OLD_API_KEY=Zq8vLm3pRt6wXy9kHb2n', 'Zq8vLm3pRt6wXy9kHb2n'],
    ['Note: see the wiki for full setup details', null],
    ['Zq8vLm3pRt6wXy9kHb2nWc4dQ1==', null],   // padding is not a value
    ['https://discord.com/api/webhooks/1/abc', null],
  ];
  for (const [line, want] of cases) assert.equal(assignedValue(line), want, line);
});

test('#3935 keyTokens: every key-shaped token of a line with spaces, and no names, words, timestamps or URLs', () => {
  const { keyTokens } = require('./knownsecrets');
  const cases = [
    ['AbCdEfGh12345678: rotated last week, keep until Friday', ['AbCdEfGh12345678']],   // the secret before its note
    ['# rotated: PqzRtLmWxKvBnHsUvWyZaBcDe (keep until Friday)', ['PqzRtLmWxKvBnHsUvWyZaBcDe']],   // all letters
    ['# token:Zq8vLm3pRt6wXy9kHb2n', ['Zq8vLm3pRt6wXy9kHb2n']],
    ['note Zq8vLm3pRt6wXy9kHb2nWc4dQ1=', ['Zq8vLm3pRt6wXy9kHb2nWc4dQ1=']],
    ['r2_secret_access_key: Qw8eRt2yUi9oPa3s', ['Qw8eRt2yUi9oPa3s']],
    ['# Cloudflare API token, DNS edit scope', []],
    ['Set CF_API_TOKEN and Configuration here', []],
    ['# Created 2026-09-25T11:54:00Z see https://x.io/a1b2c3d4e5f6g7', []],
    ['NoSpacesHereAbCd1234', []],   // one piece: the line itself is held and walked
    ['xK9-mP2qR7vT4wZ8nB5c: rotated last week', ['xK9-mP2qR7vT4wZ8nB5c']],   // a key with - before its note (round 33)
    ['password:Hq7vLm3pRt6wXy9kHb2n', ['Hq7vLm3pRt6wXy9kHb2n']],   // no space, glued with : (round 33)
    ['aws_secret_access_key = wJalrXUtnFEMI//K7MDENGbPxRfiCY9EXAMPLEKq', ['wJalrXUtnFEMI//K7MDENGbPxRfiCY9EXAMPLEKq']],   // // in base64 (round 33)
    ['# needs the XMLHttpRequest polyfill', []],   // an identifier, not a key (round 33)
    ['key 550e8400-e29b-41d4-a716-446655440000', ['550e8400-e29b-41d4-a716-446655440000']],
    ['lic Qw8e-Rt2y-Ui9o-Pa3s', ['Qw8e-Rt2y-Ui9o-Pa3s']],
  ];
  for (const [line, want] of cases) assert.deepEqual(keyTokens(line), want, line);
});

test('#4111 a value assigned to a public NAME (MODEL, REGION, VERSION) is not held; a secret-like NAME still is', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-known-')));
  try {
    const data = path.join(root, 'data');
    const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
    put(path.join(data, 'secrets', 'openai.env'), [
      'OPENAI_MODEL=gpt-4o-mini-2024-07-18',
      'export AWS_REGION=eu-central-1-zone9x',
      'api_version: 2024-10-21-preview',
      '"model": "claude-sonnet-4-20250514",',
      'OPENAI_API_KEY=sk-proj-held0123456789abcdefXYZ',
      'MODEL_API_KEY=modelkey0123456789abcdefXY',
      'IMAGE_MODEL=dall-e-3-hd # old key Zq8vLm3pRt6wXy9kHb2nWc4d',
      'BEDROCK_MODEL=anthropic.claude-3-5-sonnet-20240620-v1:0',
      'FT_MODEL=ft:gpt-4o-mini-2024-07-18:acme:custom:9xYz12',
      'MODEL_PASSPHRASE=Pw7vLm3pRt6wXy9kHb2nWc4d',
      'CF_ZONE_ID=0123456789abcdef0123456789abcdef',
      'CHAT_MODEL=gpt-4o-2024-11-20 # was gpt-4o-2024-11-20 before the switch',
      'API_VERSION=2 # old key Vr2vLm3pRt6wXy9kHb2nWc4d',
      'TZ=UTC # key UTCq8vLm3pRt6wXy9kHbUTC2n',
      'REGION=us-east-1;TOKEN=Rg1vLm3pRt6wXy9kHb2nWc4d',
      'PRIVKEY_VERSION=Pk9vLm3pRt6wXy9kHb2nWc4d',
    ].join('\n') + '\n');
    put(path.join(data, 'secrets', 'model.txt'), 'DEFAULT_MODEL=gpt-4o-2024-08-06\n');
    put(path.join(data, 'secrets', 'settings.json'), '{\n  "defaultModel": "gpt-4.1-2025-04-14",\n  "modelId": "o3-mini-2025-01-31"\n}\n');
    const got = new Set(collect({ dataRoot: data, home: path.join(root, 'nohome') }));
    for (const pub of ['gpt-4o-mini-2024-07-18', 'eu-central-1-zone9x', '2024-10-21-preview', 'claude-sonnet-4-20250514', 'gpt-4o-2024-08-06',
      'claude-3-5-sonnet-20240620', 'gpt-4.1-2025-04-14', 'o3-mini-2025-01-31', 'gpt-4o-2024-11-20']) {
      assert.ok(![...got].some((v) => v.includes(pub) && !/\n/.test(v)), `a public ${pub} was held: ${[...got].filter((v) => v.includes(pub))}`);
    }
    assert.ok(!got.has('OPENAI_MODEL=gpt-4o-mini-2024-07-18'), 'the public NAME=value line was held (the mask would walk it)');
    assert.ok(!got.has('DEFAULT_MODEL=gpt-4o-2024-08-06'), 'a one-line file that is a public assignment was held whole');
    assert.ok(got.has('sk-proj-held0123456789abcdefXYZ'), 'CONTROL: a key under a secret NAME was not held');
    assert.ok(got.has('modelkey0123456789abcdefXY'), 'CONTROL: a NAME with a secret part (MODEL_API_KEY) must still be held');
    assert.ok(got.has('Zq8vLm3pRt6wXy9kHb2nWc4d'), 'a key in a comment on a public line was dropped with the line');
    assert.ok(got.has('Pw7vLm3pRt6wXy9kHb2nWc4d'), 'CONTROL: a secret named after a model (MODEL_PASSPHRASE) was not held');
    assert.ok(got.has('0123456789abcdef0123456789abcdef'), 'CONTROL: a Cloudflare zone id (CF_ZONE_ID) is still held');
    for (const k of ['Vr2vLm3pRt6wXy9kHb2nWc4d', 'UTCq8vLm3pRt6wXy9kHbUTC2n', 'Rg1vLm3pRt6wXy9kHb2nWc4d', 'Pk9vLm3pRt6wXy9kHb2nWc4d']) {
      assert.ok(got.has(k), `a key on a public line (short value, glued assignment, glued secret word) was not held whole: ${k}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('#4111 isPublicName: a public part and no secret part', () => {
  const { isPublicName } = require('./knownsecrets');
  for (const n of ['OPENAI_MODEL', 'model', 'AWS_REGION', 'api.version', 'TZ', 'default-model', 'defaultModel', 'modelId', 'OPENAI_MODEL_ID', 'model.name', 'AWS_REGIONS', 'SUPPORTED_LOCALES', 'API_VERSIONS']) assert.equal(isPublicName(n), true, n);
  for (const n of ['MODEL_API_KEY', 'OPENAI_API_KEY', 'REGION_TOKEN', 'DATABASE_URL', 'API_HOST', 'VERSION_SECRET', 'MODELX',
    'MODEL_PASSPHRASE', 'REGION_BEARER', 'model.api-key', 'model-secret', 'modelToken', 'REGION_TOKEN_VERSION', 'CF_ZONE_ID', 'SESSION_ID', 'ID',
    'PRIVKEY_VERSION', 'APITOKEN_MODEL', 'SECRETKEY_REGION', 'ACCESSKEY_VERSION', 'apiKeyModel', 'APIVERSION', 'MODELNAME']) assert.equal(isPublicName(n), false, n);
});
