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
    ['NoSpacesHereAbCd1234', []],   // a line with no space is walked whole by the mask, not split here
  ];
  for (const [line, want] of cases) assert.deepEqual(keyTokens(line), want, line);
});
