'use strict';
/**
 * kosmos#5532 rollup review 1 (a BLOCKER): engine/usage.js reads every Claude config folder on this computer, with no
 * filter by world or agent, so its numbers include the person's other Kosmoses and their own sessions outside Kosmos.
 * The rollup must never send those. This plants a transcript the way any other session on the computer would leave
 * one, proves the computer-wide reader sees it (the control), and proves the rollup built from the board's real
 * sources carries none of it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'orgrollup-scope-5532-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
for (const v of ['CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'AGENT_WORKFORCE_GEMINI_HOME', 'GROK_HOME', 'AGENT_WORKFORCE_GROK_HOME']) delete process.env[v];
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });

const usage = require('./usage');
const r = require('./orgrollup');

const TODAY = new Date().toISOString().slice(0, 10);
const OTHER = 'claude-planted-other-session-model';

test('#5532 rollup review 1: usage from another session on this computer never reaches the rollup', async () => {
  const file = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'someone-else', 'session.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', cwd: '/elsewhere/personal', timestamp: TODAY + 'T01:00:00.000Z' }),
    JSON.stringify({ timestamp: TODAY + 'T02:00:00.000Z', cwd: '/elsewhere/personal', message: { id: 'other-1', model: OTHER, usage: { input_tokens: 4242, output_tokens: 99 } } }),
  ].join('\n') + '\n');

  // CONTROL: the computer-wide reader does see that session, so an empty rollup below is not an empty fixture.
  const all = await usage.dailyUsageByModel(1);
  assert.ok(all.byDay[TODAY] && all.byDay[TODAY][OTHER], 'CONTROL: the planted session was not read at all: ' + JSON.stringify(all.byDay));

  // The board's real sources, with only the parts that need a running board stood in.
  const src = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [{ sessionName: 'leo', name: 'Leo', runner: 'claude', model: 'claude-opus-5-5', state: 'working', isNamedOurs: true }] }),
    survey: () => ({ ok: true, agents: [] }),
    removed: () => [],
    projects: () => [],
    lastActiveOf: () => null,
  });
  const body = r.build(Object.assign({ world: 'a'.repeat(32) }, await r.gather(src)));
  const text = JSON.stringify(body);
  // NOTE: defaultSources() has no usageByDay today, so this goes red only if a reader is added back. A future reader
  // scoped to this world must bring its own test that plants a session of ANOTHER world beside one of this world's.
  assert.equal(text.includes(OTHER), false, 'another session\'s model reached the rollup: ' + text);
  assert.equal(text.includes('4242'), false, 'another session\'s tokens reached the rollup');
  assert.deepEqual(body.usage, []);
  assert.equal(body.usageWithheld, true, 'withheld usage must be said (usageWithheld, contract v1.1), not sent as "no usage"');
  assert.equal(body.truncated, false, 'truncated is only for a real trim or a partial read');
});

test('#5532 rollup review 7: the real runner lookup answers null (not claude) when nothing records one', () => {
  const src = r.defaultSources();
  assert.equal(src.recordedRunner('nobody-recorded-here'), null, 'a guessed runner would be reported as a provider');
  // CONTROL: a profile that records a provider is read, so the null above is "nothing recorded", not a broken lookup.
  require('./store').writeProfile('pat', { provider: 'openai' });
  assert.equal(src.recordedRunner('pat'), 'codex');
});
