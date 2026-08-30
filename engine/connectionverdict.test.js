'use strict';

// Sandbox every root BEFORE any require, the same rule the sibling suites state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-connverdict-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert');
const verdict = require('./connectionverdict');
const subscription = require('./subscription');

/**
 * The inputs, carrying every sensitive shape the real readers carry. Each
 * planted value is distinctive so a match cannot be a coincidence.
 */
const SECRETS = {
  url: 'https://claude.ai/oauth/authorize?code=PLANTEDBEARER9271&state=PLANTEDSTATE',
  tail: 'PLANTEDTAIL9271 paste code here: 8842-PLANTEDCODE',
  email: 'planted9271@example.com',
  dir: '/Users/planted9271/Library/Application Support/PlantedDir',
  bin: '/opt/planted9271/bin/claude',
  org: 'planted9271_org',
};

function richInput() {
  return {
    connect: {
      phase: 'signin-awaiting-code',
      url: SECRETS.url,
      tail: SECRETS.tail,
      because: `we could not work out the plan of (${SECRETS.org})`,
      configDir: SECRETS.dir,
    },
    accounts: [
      {
        provider: 'anthropic',
        email: SECRETS.email,
        dir: SECRETS.dir,
        connection: {
          state: subscription.STATE.CONNECTED,
          because: `this computer has a Claude account we do not recognise the plan of (${SECRETS.org})`,
        },
      },
      {
        provider: 'openai',
        email: SECRETS.email,
        dir: SECRETS.dir,
        connection: { state: subscription.STATE.NONE, because: 'nope' },
      },
    ],
    runners: {
      anthropic: { name: 'Claude Code', present: true, bin: SECRETS.bin },
      openai: { name: 'Codex', present: false, bin: SECRETS.bin },
    },
    doors: {
      '/api/github': { connected: true, who: SECRETS.email },
      '/api/vercel': { connected: false, who: null },
      '/api/cloudflare': { connected: null, because: `could not check: ${SECRETS.org}` },
    },
  };
}

test('NOTHING sensitive reaches the agent view, and the control proves the test can fail', () => {
  const input = richInput();
  const inputText = JSON.stringify(input);
  const outText = JSON.stringify(verdict.forAgent(input));

  // CONTROL FIRST: if the planted values are not in the input, the assertions
  // below are vacuous and would pass against an empty object.
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(inputText.includes(value), `control failed: ${name} is not even in the input`);
  }

  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!outText.includes(value), `${name} LEAKED into the agent view`);
  }
  // The bearer credential specifically, by shape as well as by value.
  assert.doesNotMatch(outText, /oauth/i);
  assert.doesNotMatch(outText, /@example\.com/);
  assert.doesNotMatch(outText, /\/Users\//);
});

test('every string the view emits comes from this module, not from its input', () => {
  const out = verdict.forAgent(richInput());
  const allowed = new Set([
    ...Object.values(verdict.SAYS),
    ...verdict.PHASES, 'unknown',
    'anthropic', 'openai', 'Claude Code', 'GPT (OpenAI, through Codex)',
    'github', 'vercel', 'cloudflare',
    subscription.STATE.CONNECTED, subscription.STATE.NONE, subscription.STATE.UNKNOWN,
  ]);
  const strings = [];
  (function walk(v) {
    if (typeof v === 'string') { strings.push(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { Object.values(v).forEach(walk); }
  }(out));
  assert.ok(strings.length > 10, `control: expected many strings, got ${strings.length}`);
  for (const s of strings) assert.ok(allowed.has(s), `un-allowlisted string escaped: ${JSON.stringify(s)}`);
});

test('cannot-tell is a real answer and never collapses into not-connected', () => {
  const out = verdict.forAgent({
    accounts: [{ provider: 'anthropic', connection: { state: subscription.STATE.UNKNOWN } }],
    runners: { anthropic: { present: true } },
  });
  const claude = out.providers.find((p) => p.id === 'anthropic');
  assert.strictEqual(claude.signedIn, subscription.STATE.UNKNOWN);
  assert.strictEqual(claude.because, verdict.SAYS.CANNOT_TELL);
  assert.notStrictEqual(claude.signedIn, subscription.STATE.NONE);
});

test('one working sign-in outranks a sibling we could not check', () => {
  const out = verdict.forAgent({
    accounts: [
      { provider: 'openai', connection: { state: subscription.STATE.UNKNOWN } },
      { provider: 'openai', connection: { state: subscription.STATE.CONNECTED } },
    ],
  });
  const gpt = out.providers.find((p) => p.id === 'openai');
  assert.strictEqual(gpt.signedIn, subscription.STATE.CONNECTED);
  assert.strictEqual(gpt.howMany, 2);
});

test('no accounts at all is NONE, and says the runner is missing when it is', () => {
  const out = verdict.forAgent({ runners: { openai: { present: false } } });
  const gpt = out.providers.find((p) => p.id === 'openai');
  assert.strictEqual(gpt.signedIn, subscription.STATE.NONE);
  assert.strictEqual(gpt.installed, false);
  assert.strictEqual(gpt.because, verdict.SAYS.NO_RUNNER);
});

test('an unknown runner state is null, not a false "not installed"', () => {
  const out = verdict.forAgent({});
  for (const p of out.providers) assert.strictEqual(p.installed, null);
});

test('a phase we have never seen becomes unknown rather than travelling', () => {
  const out = verdict.forAgent({ connect: { phase: 'PLANTED-NEW-PHASE-9271' } });
  assert.strictEqual(out.signin.phase, 'unknown');
  assert.strictEqual(out.signin.busy, false);
  // control: a real phase DOES travel, so the assertion above is not vacuous
  assert.strictEqual(verdict.forAgent({ connect: { phase: 'stuck' } }).signin.phase, 'stuck');
});

test('a sign-in in progress is reported as busy', () => {
  assert.strictEqual(verdict.forAgent({ connect: { phase: 'signin-awaiting-code' } }).signin.busy, true);
  assert.strictEqual(verdict.forAgent({ connect: { phase: 'idle' } }).signin.busy, false);
});

test('service doors keep their three states and lose their login', () => {
  const out = verdict.forAgent(richInput());
  const byName = Object.fromEntries(out.services.map((s) => [s.name, s]));
  assert.strictEqual(byName.github.connected, true);
  assert.strictEqual(byName.vercel.connected, false);
  assert.strictEqual(byName.cloudflare.connected, null);
  assert.ok(!('who' in byName.github), 'the door login must not travel');
});

test('rubbish input does not throw and does not invent a connection', () => {
  for (const bad of [null, undefined, 'nope', 42, [], { accounts: 'no' }, { doors: 7 }]) {
    const out = verdict.forAgent(bad);
    assert.strictEqual(out.providers.length, 2);
    for (const p of out.providers) assert.strictEqual(p.signedIn, subscription.STATE.NONE);
    assert.deepStrictEqual(out.services, []);
  }
});

test('a reader that threw is UNKNOWN, never a confident "no sign-in"', () => {
  const out = verdict.forAgent({
    accounts: [], runners: { anthropic: { present: true } }, unreadable: { anthropic: true },
  });
  const claude = out.providers.find((p) => p.id === 'anthropic');
  assert.strictEqual(claude.signedIn, subscription.STATE.UNKNOWN);
  assert.strictEqual(claude.because, verdict.SAYS.CANNOT_TELL);
  // control: the SAME empty rows without the blind flag are honestly NONE,
  // so this test is about the flag and not about emptiness.
  const seeing = verdict.forAgent({ accounts: [], runners: { anthropic: { present: true } } });
  assert.strictEqual(seeing.providers.find((p) => p.id === 'anthropic').signedIn, subscription.STATE.NONE);
});
