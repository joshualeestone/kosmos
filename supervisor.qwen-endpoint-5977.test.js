'use strict';
/**
 * #5977: a codex agent whose account home holds kosmos-endpoint.json is launched against that endpoint. This
 * EXECUTES the shipped bin/agent-supervisor.sh with a recorder fake tmux (the shape supervisor.provider-key-inject-3296
 * uses) and asserts the launch line: the endpoint, its model, the measured context, web search off; the key reaches
 * the pane only as a launch secret; a file that cannot be used stops the launch; an OpenAI home is untouched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-qwen-5977-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const FAKE_TMUX = nodePath.join(SANDBOX, 'rec-tmux.sh');
fs.writeFileSync(FAKE_TMUX, [
  '#!/bin/bash',
  'case "$1" in',
  '  new-session)',
  '    before=""',
  '    for arg in "$@"; do',
  '      if [ "$before" = --pane-entry ]; then cp "$arg" "$REC.secrets"; break; fi',
  '      before="$arg"',
  '    done',
  '    printf "%s\\n" "$*" >> "$REC"; exit 0 ;;',
  '  has-session) exit 1 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });

let n = 0;
function home(files) {
  const dir = nodePath.join(SANDBOX, `.kosmos-qwen-h${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(nodePath.join(dir, name), body, { mode: 0o600 });
  return dir;
}
function run(codexHome, model) {
  const rec = nodePath.join(SANDBOX, `rec-${++n}.txt`);
  const env = { PATH: process.env.PATH, HOME: SANDBOX, REC: rec, AGENT_WORKFORCE_HOME: SANDBOX, CODEX_HOME: codexHome };
  const r = spawnSync('/bin/bash', [SUP, `agent-q${n}`, SANDBOX, '/usr/bin/true', FAKE_TMUX, '', model || '', 'codex'],
    { env, encoding: 'utf8', timeout: 30000 });
  const argv = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '';
  const secrets = fs.existsSync(`${rec}.secrets`) ? fs.readFileSync(`${rec}.secrets`, 'utf8') : '';
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), argv, secrets };
}
const EP = { baseUrl: 'http://localhost:11434/v1', model: 'kosmos-qwen2.5-7b-16k:latest', contextWindow: 16384 };

test('an endpoint home launches codex against the endpoint, with both measured settings and its own model', () => {
  const r = run(home({ 'kosmos-endpoint.json': JSON.stringify(EP) }), 'gpt-5.2');
  assert.match(r.argv, /new-session/, r.out);
  assert.match(r.argv, /-c model_provider="kosmos_endpoint"/);
  assert.match(r.argv, /-c model_providers\.kosmos_endpoint\.base_url="http:\/\/localhost:11434\/v1"/);
  assert.match(r.argv, /-c model_providers\.kosmos_endpoint\.wire_api="responses"/);
  assert.match(r.argv, /-c model_context_window=16384/);
  assert.match(r.argv, /-c web_search="disabled"/);
  assert.match(r.argv, /-m kosmos-qwen2\.5-7b-16k:latest/);
  assert.equal(/-m gpt-5\.2/.test(r.argv), false, 'the agent\'s OpenAI model is not used against the endpoint');
  assert.equal(/env_key/.test(r.argv), false, 'no key, no env_key');
  assert.equal(/OpenAI account is not signed in/.test(r.out), false, 'an endpoint home is not an unsigned OpenAI account');
});

test('a key reaches the pane only as a launch secret, never in the argv or the supervisor output', () => {
  const r = run(home({ 'kosmos-endpoint.json': JSON.stringify({ ...EP, baseUrl: 'https://q.example.com/v1', key: 'sk-endpoint-secret-4242' }) }));
  assert.match(r.argv, /-c model_providers\.kosmos_endpoint\.env_key="KOSMOS_ENDPOINT_KEY"/);
  assert.match(r.secrets, /^KOSMOS_ENDPOINT_KEY=sk-endpoint-secret-4242$/m);
  assert.equal(r.argv.includes('sk-endpoint-secret-4242'), false, 'the key is not in the tmux argv');
  assert.equal(r.out.includes('sk-endpoint-secret-4242'), false, 'the key is not in the supervisor output');
});

test('an endpoint file that cannot be used stops the launch, saying why', () => {
  for (const bad of [JSON.stringify({ ...EP, contextWindow: 4096 }), '{not json']) {
    const r = run(home({ 'kosmos-endpoint.json': bad }));
    assert.notEqual(r.code, 0);
    assert.equal(/new-session/.test(r.argv), false, 'nothing was launched');
    assert.match(r.out, /Qwen account cannot be used: .*the agent was not started/);
  }
});

test('CONTROL: an OpenAI home (auth.json, no endpoint file) launches exactly as before', () => {
  const r = run(home({ 'auth.json': '{"OPENAI_API_KEY":null,"tokens":{}}' }), 'gpt-5.2');
  assert.match(r.argv, /new-session/, r.out);
  assert.match(r.argv, /-m gpt-5\.2/);
  assert.equal(/model_provider|web_search|model_context_window/.test(r.argv), false, 'no endpoint arguments');
});
