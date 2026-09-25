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
