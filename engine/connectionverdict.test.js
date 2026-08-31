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
  doorkey: 'PLANTEDDOORKEY9271',
  keyTail: 'PLANTEDKEYTAIL9271',
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
        /* The shape openaiaccounts.rowFor() really produces. The brief for this
           change names an API KEY TAIL explicitly, and the proof did not cover
           it because the fixture did not carry one. */
        provider: 'openai',
        providerName: 'OpenAI',
        email: SECRETS.email,
        dir: SECRETS.dir,
        keyTail: SECRETS.keyTail,
        authMode: 'key',
        label: SECRETS.email,
        isDefault: true,
        connection: { state: subscription.STATE.NONE, because: 'nope' },
      },
    ],
    /* 🛑 KEYED THE WAY `runners.status()` ACTUALLY KEYS IT (`claude`, not
       `anthropic`). The first version of this fixture was hand-rolled from what
       its author believed the shape to be, and it hid a real defect: the module
       read `runners.anthropic`, got undefined forever, and could never say the
       runner was missing. A fixture that encodes a belief tests the belief. */
    runners: {
      claude: { name: 'Claude Code', present: true, bin: SECRETS.bin },
      openai: { name: 'Codex', present: false, bin: SECRETS.bin },
    },
    doors: {
      '/api/github': { connected: true, who: SECRETS.email },
      '/api/vercel': { connected: false, who: null },
      '/api/cloudflare': { connected: null, because: `could not check: ${SECRETS.org}` },
      /* a door whose KEY carries a secret: the leak test planted only into
         values, so this whole class was invisible to the proof the module rests on */
      [`/api/svc/${SECRETS.doorkey}`]: { connected: true },
    },
    doorNames: {
      '/api/github': 'GitHub', '/api/vercel': 'Vercel', '/api/cloudflare': 'Cloudflare',
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

test('every string the view emits comes from this module or the caller\'s door allowlist', () => {
  const out = verdict.forAgent(richInput());
  const allowed = new Set([
    ...Object.values(verdict.SAYS),
    ...verdict.PHASES, 'unknown',
    'anthropic', 'openai', ...Object.values(verdict.PROVIDER_LABEL),
    'GitHub', 'Vercel', 'Cloudflare',
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
    runners: { claude: { present: true } },
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
  assert.strictEqual(byName.GitHub.connected, true);
  assert.strictEqual(byName.Vercel.connected, false);
  assert.strictEqual(byName.Cloudflare.connected, null);
  assert.ok(!('who' in byName.GitHub), 'the door login must not travel');
  /* A door with no resolved name is DROPPED rather than named from its key. */
  assert.ok(!out.services.some((x) => /PLANTED/.test(x.name)), 'an unresolved door was named from its key');
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
    accounts: [], runners: { claude: { present: true } }, unreadable: { anthropic: true },
  });
  const claude = out.providers.find((p) => p.id === 'anthropic');
  assert.strictEqual(claude.signedIn, subscription.STATE.UNKNOWN);
  assert.strictEqual(claude.because, verdict.SAYS.CANNOT_TELL);
  // control: the SAME empty rows without the blind flag are honestly NONE,
  // so this test is about the flag and not about emptiness.
  const seeing = verdict.forAgent({ accounts: [], runners: { claude: { present: true } } });
  assert.strictEqual(seeing.providers.find((p) => p.id === 'anthropic').signedIn, subscription.STATE.NONE);
});

test('the runner keys this module maps to are the keys runners.status() really uses', () => {
  /**
   * 🛑 THE GUARD FOR THE DEFECT A HAND-ROLLED FIXTURE HID. An account row says
   * `anthropic`; runners.status() says `claude`. Nothing in either module makes
   * the two agree, so this asserts it against the REAL call rather than against
   * a shape somebody typed.
   */
  const real = require('./runners').status();
  const keys = Object.keys(real);
  assert.ok(keys.length > 0, 'control: runners.status() returned nothing to check against');
  for (const [provider, runnerKey] of Object.entries(verdict.RUNNER_KEY)) {
    assert.ok(keys.includes(runnerKey),
      `RUNNER_KEY maps ${provider} to '${runnerKey}', which runners.status() does not have (it has: ${keys.join(', ')})`);
  }
  // control: a key that must NOT be there, proving the assertion can fail
  assert.ok(!keys.includes('anthropic'),
    'runners.status() now has an `anthropic` key, so RUNNER_KEY may be unnecessary; re-read it rather than deleting this test');
});

test('installed is a real answer for BOTH providers against a real runners.status()', () => {
  const out = verdict.forAgent({ runners: require('./runners').status(), accounts: [] });
  for (const p of out.providers) {
    assert.notStrictEqual(p.installed, null,
      `${p.id} reports installed=null against a real runner status, which is the key-mismatch defect`);
  }
});

test('the phase lists stay in step with the engine that produces them', () => {
  /**
   * These are a hand-copied THIRD copy of connect.js's own lists (the page
   * carries the second, and connect.js documents that hazard for it). A phase
   * added upstream and not here would make the CLI go quiet during exactly the
   * sign-in step somebody needs help with.
   */
  const connect = require('./connect');
  assert.deepStrictEqual([...verdict.PHASES].sort(), [...Object.values(connect.PHASE)].sort(),
    'PHASES has drifted from connect.PHASE');
  assert.deepStrictEqual([...verdict.BUSY_PHASES].sort(), [...connect.ACTIVE_PHASES].sort(),
    'BUSY_PHASES has drifted from connect.ACTIVE_PHASES');
  assert.ok(verdict.PHASES.length > 5, `control: PHASES implausibly short (${verdict.PHASES.length})`);
});

test('a door whose KEY carries a secret cannot put it in the output', () => {
  const out = JSON.stringify(verdict.forAgent(richInput()));
  assert.ok(!out.includes(SECRETS.doorkey), 'a door key reached the agent view');
  // control: the planted key really is in the input
  assert.ok(JSON.stringify(richInput()).includes(SECRETS.doorkey), 'control: the door key was never planted');
});

test('a count is withheld rather than guessed when we could not check', () => {
  const out = verdict.forAgent({
    accounts: [], runners: { claude: { present: true } }, unreadable: { anthropic: true },
  });
  const claude = out.providers.find((p) => p.id === 'anthropic');
  assert.strictEqual(claude.signedIn, subscription.STATE.UNKNOWN);
  assert.strictEqual(claude.howMany, null, 'a 0 beside "cannot tell" reads as a settled none');
  // control: a provider we COULD read still reports a real count
  const seen = verdict.forAgent({ accounts: [{ provider: 'openai', connection: { state: subscription.STATE.CONNECTED } }] });
  assert.strictEqual(seen.providers.find((p) => p.id === 'openai').howMany, 1);
});

test('a door name is dropped unless the CALLER allowlisted it, prototype keys included', () => {
  /**
   * `names['constructor']` walks the prototype chain and answers a Function,
   * which is truthy, so an inherited key passed the gate whose whole job is
   * refusing input. The rows came back with a Function for a name, which
   * JSON.stringify drops, so the CLI printed `undefined: connected`.
   */
  const out = verdict.forAgent({
    doors: { constructor: { connected: true }, toString: { connected: false }, valueOf: { connected: null } },
    doorNames: {},
  });
  assert.deepStrictEqual(out.services, [], 'an inherited key passed the allowlist gate');
  // control: a door the caller DID allowlist still comes through
  const ok = verdict.forAgent({ doors: { '/api/github': { connected: true } }, doorNames: { '/api/github': 'GitHub' } });
  assert.strictEqual(ok.services.length, 1);
  assert.strictEqual(ok.services[0].name, 'GitHub');
});

test('the count of sign-ins is separate from the count that WORK', () => {
  /**
   * `howMany` counts rows. Rendered beside "this computer has a working
   * sign-in for it", three rows of which one works read as three working.
   */
  const sub = subscription.STATE;
  const out = verdict.forAgent({ accounts: [
    { provider: 'anthropic', connection: { state: sub.CONNECTED } },
    { provider: 'anthropic', connection: { state: sub.NONE } },
    { provider: 'anthropic', connection: { state: sub.NONE } },
  ] });
  const c = out.providers.find((p) => p.id === 'anthropic');
  assert.strictEqual(c.signedIn, sub.CONNECTED);
  assert.strictEqual(c.howMany, 3);
  assert.strictEqual(c.howManyWorking, 1, 'the working count must not equal the row count here');
  // control: when every row works, the two numbers agree
  const all = verdict.forAgent({ accounts: [{ provider: 'openai', connection: { state: sub.CONNECTED } }] });
  const o = all.providers.find((p) => p.id === 'openai');
  assert.strictEqual(o.howMany, o.howManyWorking);
});

test('the provider names are the words the screen uses', () => {
  /**
   * The board labels them `Claude` and `GPT`. A third vocabulary here is the
   * two-accounts-of-what-to-do failure this card exists to prevent.
   */
  const page = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'web', 'index.html'), 'utf8');
  for (const label of Object.values(verdict.PROVIDER_LABEL)) {
    assert.ok(page.includes('>' + label + '<'),
      `the agent view says ${JSON.stringify(label)}, which the screen never says`);
  }
  // control: a name the screen genuinely does not use must fail this same test
  assert.ok(!page.includes('>GPT (OpenAI, through Codex)<'), 'control: that string should not be on the page');
});

test('a door NAME is passed through verbatim, and that is the documented exception', () => {
  /**
   * 🛑 THIS TEST ASSERTS THE HOLE, NOT ITS ABSENCE, AND THAT IS DELIBERATE.
   *
   * `services[].name` is copied out of the caller's `doorNames`. Resolving
   * THROUGH an allowlist does not make the resolved value stop being input, so
   * the module's "nothing is passed through" rule has exactly one exception and
   * its safety lives at the CALL SITE (`server.js` builds that map from THREE
   * LITERALS AND NOTHING ELSE). It used to add `tokendoors.routes()`; the token
   * doors were dropped from the agent view as a money decision, the module
   * header was corrected, and THIS COPY OF THE SAME CLAIM WAS NOT. A correction
   * does not sweep by itself.
   *
   * ⚠️ An earlier version of this file planted a secret into `doorNames` and
   * asserted it did NOT appear. It passed -- because the planted name was keyed
   * to a route that was not among the doors, so the loop never reached it. A
   * green that proved nothing, under a comment claiming it proved the channel
   * was scrubbed. A future reader would have built `doorNames` from a request.
   *
   * ⇒ So this pins the REAL contract: the name travels. If someone later scrubs
   * it, this test fails and they are told to update the module header too.
   */
  const out = verdict.forAgent({
    doors: { '/api/svc/x': { connected: true } },
    doorNames: { '/api/svc/x': 'CALLER-SUPPLIED-9271' },
  });
  assert.strictEqual(out.services.length, 1);
  assert.strictEqual(out.services[0].name, 'CALLER-SUPPLIED-9271',
    'door names are a documented pass-through; if this changed, update the module header');
  // control: an UNRESOLVED door is still dropped, so the allowlist gate itself works
  const dropped = verdict.forAgent({ doors: { '/api/svc/y': { connected: true } }, doorNames: {} });
  assert.deepStrictEqual(dropped.services, [], 'the allowlist gate stopped working');
});

test('#1034: an unrecognised state is NOT counted as readable, and the three counts agree', () => {
  /* 🛑 THIS FUNCTION HAD NO TEST AT ALL. Measured before writing this: `howManyReadable`
     occurred 0 times in this file, against a sibling control of 2 for `howManyWorking`.
     A mutation replacing its whole body with `return 0` left all 39 tests across the
     three new files green.
     ⚠️ AND THE PROPERTY IT GUARDS IS A SENTENCE ABOUT A PERSON: an unreadable row must
     not land in the denominator, or the CLI tells somebody a sign-in is broken when the
     truth is we could not check it. */
  /* Row shape read off the module rather than assumed: `provider` is what routes a
     row to a provider, and the id is `anthropic`, not `claude`. A first draft of this
     test guessed both and asserted against a fixture the module never accepted. */
  const rows = [
    { provider: 'anthropic', connection: { state: subscription.STATE.CONNECTED } },
    { provider: 'anthropic', connection: { state: 'a-state-this-module-does-not-know' } },
    { provider: 'anthropic' },
  ];
  const v = verdict.forAgent({ accounts: rows, doors: {}, doorNames: {} });
  const claude = v.providers.find((p) => p.id === 'anthropic');

  assert.equal(claude.howMany, 3, 'the total should count every row it was given');
  assert.equal(claude.howManyReadable, 1,
    'an unrecognised state was counted as readable, so an unreadable row is being held against the person');
  assert.ok(claude.howManyWorking <= claude.howManyReadable,
    `working (${claude.howManyWorking}) exceeds readable (${claude.howManyReadable}), so the two classifiers disagree about the same row`);

  /* control: the arm CAN move, so the 1 above is a value the code chose. */
  const allGood = verdict.forAgent({
    accounts: [{ provider: 'anthropic', connection: { state: subscription.STATE.CONNECTED } },
               { provider: 'anthropic', connection: { state: subscription.STATE.CONNECTED } }],
    doors: {}, doorNames: {},
  });
  const cg = allGood.providers.find((p) => p.id === 'anthropic');
  assert.equal(cg.howManyReadable, 2, 'control: two readable rows did not count as two');
});

test('a stale terminal sign-in beside a live connection reads as unknown, not stuck', () => {
  /**
   * 🛑 `connect.state()` CAN HAND US A RECORD FROM A PREVIOUS BOARD PROCESS.
   * Once `startedOnce` is false, which is the state at every board boot, the disk
   * fallback has no freshness gate. So a `stuck` phase can arrive for a provider
   * that is connected right now, and reporting both is a contradiction about one
   * computer that the PERSON is left to reconcile.
   *
   * This lived in the CLI renderer, which made the shipped path correct and the
   * design wrong: no other consumer inherited it. It is decided here now.
   *
   * ⭐ IT BECOMES `unknown`, NOT `idle`. We cannot tell whether that record still
   * describes anything. Saying `idle` would be a confident negative about a
   * sign-in we did not look at, which is the collapse this whole module refuses.
   */
  const connectedRow = { provider: 'anthropic', connection: { state: subscription.STATE.CONNECTED, because: 'fine' } };

  const suppressed = verdict.forAgent({
    accounts: [connectedRow],
    connect: { phase: 'stuck' },
  });
  assert.equal(suppressed.signin.phase, 'unknown',
    'a stale terminal phase was reported beside a live connection: the two contradict each other about one computer');
  assert.notEqual(suppressed.signin.phase, 'idle',
    'the stale record was collapsed to idle, a confident negative about a sign-in nobody looked at');

  /* CONTROL: with nothing connected, the SAME record is real news and survives.
     Without this arm the assertion above is satisfied by suppressing always. */
  const kept = verdict.forAgent({
    accounts: [],
    connect: { phase: 'stuck' },
  });
  assert.equal(kept.signin.phase, 'stuck',
    'a terminal sign-in was suppressed even with nothing connected, which hides a real failure');

  /* CONTROL: an IN-FLIGHT sign-in is never suppressed. Somebody is at their
     keyboard now; a connected provider elsewhere does not make that stale. */
  const live = verdict.forAgent({
    accounts: [connectedRow],
    connect: { phase: 'signin-awaiting-code' },
  });
  assert.equal(live.signin.phase, 'signin-awaiting-code',
    'a sign-in happening RIGHT NOW was suppressed because something else was connected');
  assert.equal(live.signin.busy, true, 'the live phase lost its busy flag');
});
