'use strict';
/**
 * engine/feedguard.js -- the fail-closed guardrail for the public community
 * feed (#3485).
 *
 * The discipline these tests hold to (Splinter's steer on #3485): a detector
 * that only proves it RUNS proves nothing. Every leak class has a NEGATIVE
 * CONTROL that plants a real instance and asserts it is CAUGHT (a control that
 * can return the dangerous answer), AND the suite has a POSITIVE CONTROL -- a
 * clean post that must pass -- so `clean` is not vacuously always-false. If both
 * the planted-secret arm and the clean arm did not exist, an always-false stub
 * would pass every catch test; the clean arm is what forbids the stub.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fg = require('./feedguard');

/* A minimal, valid, clean candidate. The positive control. */
function clean() {
  return {
    v: 1,
    kind: 'community_post',
    agent: 'PigeonPete',
    session: 'pigeonpete',
    at: '2026-09-23T18:10:00Z',
    topic: 'agent-state seam',
    body: 'Today I scoped how an agent posts into the community feed and built the fail-closed backstop.',
    links: ['https://github.com/joshualeestone/kosmos/issues/3485'],
  };
}

test('POSITIVE CONTROL: a clean, trusted post is clean and publishes', () => {
  const v = fg.guard(clean(), { trusted: true });
  assert.equal(v.clean, true, 'a clean post must be clean -- if this fails, detection is vacuously always-false');
  assert.deepEqual(v.findings, []);
  assert.equal(v.publish, true);
  assert.equal(v.disposition, 'publish');
});

test('the positive control really exercises every pattern (a clean body is not a hit by luck)', () => {
  // Guards against a clean post passing only because it is short. Run each
  // pattern against the clean body explicitly and require no match.
  const body = clean().body;
  for (const p of fg.PATTERNS) {
    assert.equal(p.re.test(body), false, 'clean body unexpectedly matched ' + p.why);
  }
});

// ---- NEGATIVE CONTROLS: each planted leak MUST be caught ---------------------

const PLANTS = [
  ['GitHub fine-grained PAT', 'secret_token', 'my token is github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEF right here'],
  ['classic GitHub token', 'secret_token', 'ghp_' + 'a'.repeat(36)],
  ['OpenAI key', 'secret_token', 'key sk-proj-abcdEFGH1234ijklMNOP5678qrstUVWX for the demo'],
  ['AWS access key id', 'secret_token', 'AKIAIOSFODNN7EXAMPLE is in the env'],
  ['Slack token', 'secret_token', 'xoxb-2401-3920-abcdEFGH1234'],
  ['PEM private key', 'secret_token', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...'],
  ['Cardano wallet key', 'secret_token', 'addr1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wxq5ndj0'],
  ['email PII', 'email', 'ping me at somebody.real@example.com about it'],
  ['phone PII', 'phone', 'call the operator at (214) 555-0199 today'],
  ['grouped currency', 'financial', 'the finding was worth $249,000 in revenue'],
  ['large currency', 'financial', 'that is $12000 of value'],
  ['denylisted human name', 'human_name', 'Josh Stone asked me to post this'],
  ['high-entropy token', 'high_entropy', 'the value is Ab3' + 'x9K2p'.repeat(6) + 'Zq end'],
];

for (const [label, cls, body] of PLANTS) {
  test('NEGATIVE CONTROL caught: ' + label, () => {
    const cand = clean();
    cand.body = body;
    const v = fg.guard(cand, { trusted: true });
    assert.equal(v.clean, false, label + ' was NOT caught -- the backstop is blind to it');
    assert.ok(v.findings.some((x) => x.cls === cls), label + ' caught but not classed as ' + cls);
    // Fail-closed: even a "trusted" agent cannot publish a post with a leak.
    assert.equal(v.publish, false);
    assert.equal(v.disposition, 'hold');
  });
}

// ---- FAIL-CLOSED structural checks ------------------------------------------

test('an unexpected field fails closed (the minimization contract)', () => {
  const cand = clean();
  cand.secretNote = 'anything';
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'unexpected_field' && x.field === 'secretNote'));
});

test('a missing required field fails closed', () => {
  const cand = clean();
  delete cand.body;
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'missing_field' && x.field === 'body'));
});

test('the wrong kind fails closed', () => {
  const cand = clean();
  cand.kind = 'posted';
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'wrong_kind'));
});

test('an oversize body fails closed', () => {
  const cand = clean();
  cand.body = 'x'.repeat(fg.LIMITS.body + 1);
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'oversize' && x.field === 'body'));
});

test('a non-object candidate fails closed, and does not throw', () => {
  for (const bad of [null, undefined, 42, 'a string', ['array']]) {
    const v = fg.guard(bad, { trusted: true });
    assert.equal(v.clean, false, JSON.stringify(bad) + ' was treated as clean');
    assert.equal(v.publish, false);
  }
});

test('an agent that is an email address is refused as a persona', () => {
  const cand = clean();
  cand.agent = 'real.person@example.com';
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'agent_not_persona' || x.cls === 'email'));
});

test('a non-http link fails closed', () => {
  const cand = clean();
  cand.links = ['javascript:alert(1)'];
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'bad_link'));
});

// ---- HELD-BY-DEFAULT hook ---------------------------------------------------

test('HELD-BY-DEFAULT: a clean post with no trust asserted is held, not published', () => {
  const v = fg.guard(clean()); // no opts -> trusted defaults false
  assert.equal(v.clean, true, 'it is clean by content');
  assert.equal(v.trusted, false);
  assert.equal(v.publish, false, 'but it is held because trust was not asserted');
  assert.equal(v.disposition, 'hold');
});

test('only an explicit trusted:true lets a clean post publish (not a truthy value)', () => {
  for (const t of [1, 'yes', {}, undefined]) {
    const v = fg.guard(clean(), { trusted: t });
    assert.equal(v.publish, false, 'trusted=' + JSON.stringify(t) + ' should not count as trusted');
  }
  assert.equal(fg.guard(clean(), { trusted: true }).publish, true);
});

test('extra denyNames from the caller are honored', () => {
  const cand = clean();
  cand.body = 'a note about Acme Investors Inc';
  assert.equal(fg.guard(cand, { trusted: true }).clean, true, 'not denied by default');
  const v = fg.guard(cand, { trusted: true, denyNames: ['Acme Investors Inc'] });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'human_name'));
});

test('a GitHub link carrying the org handle is NOT flagged as a human name', () => {
  // Regression: the operator handle 'joshualeestone' is a structural part of
  // every kosmos repo URL. The name denylist scans authored prose, not links,
  // so a legitimate project link must pass. A secret in a link is still caught
  // by the pattern scan (covered elsewhere); this only pins the name scope.
  const cand = clean();
  cand.body = 'Scoped the feed seam today.';
  cand.links = ['https://github.com/joshualeestone/kosmos/issues/3485'];
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, true);
  assert.ok(!v.findings.some((x) => x.cls === 'human_name'));
});

test('a human name written in the BODY prose is still caught', () => {
  const cand = clean();
  cand.body = 'Josh Stone asked me to build this.';
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'human_name'));
});

test('a secret buried in an unexpected field is still caught (defense in depth)', () => {
  const cand = clean();
  cand.extra = 'ghp_' + 'b'.repeat(36);
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  // Both the structural miss (unexpected field) and the content hit fire.
  assert.ok(v.findings.some((x) => x.cls === 'unexpected_field'));
  assert.ok(v.findings.some((x) => x.cls === 'secret_token'));
});

// ---- fail-open regressions caught by the iteration-1 blind review -----------

test('a BigInt v (which makes JSON.stringify throw) fails closed, does not throw, and still catches a token in agent', () => {
  // The exact BLOCKER repro: an exotic value in an untyped field made stringify
  // throw, silently dropping the only scan agent/session/at ever got, so a token
  // in the public agent field published. Both the type guard and the direct
  // field scan must now hold.
  const cand = clean();
  cand.v = 1n; // BigInt -> JSON.stringify throws
  cand.agent = 'ghp_' + 'a'.repeat(36);
  let v;
  assert.doesNotThrow(() => { v = fg.guard(cand, { trusted: true }); });
  assert.equal(v.clean, false);
  assert.equal(v.publish, false);
  assert.equal(v.disposition, 'hold');
  assert.ok(v.findings.some((x) => x.cls === 'wrong_type' && x.field === 'v'));
  assert.ok(v.findings.some((x) => x.cls === 'secret_token'), 'the token in agent must be caught by the direct field scan');
});

test('a secret in the agent field is caught (agent is scanned directly, not only via serialization)', () => {
  const cand = clean();
  cand.agent = 'ghp_' + 'b'.repeat(36);
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'secret_token'));
});

test('a word-char prefix does NOT defeat a secret-token pattern (no leading \\b bypass)', () => {
  for (const body of ['xAKIAIOSFODNN7EXAMPLE here', 'zzzghp_' + 'c'.repeat(36), 'prefixsk-abcdEFGH1234ijklMNOP5678']) {
    const cand = clean();
    cand.body = body;
    const v = fg.guard(cand, { trusted: true });
    assert.equal(v.clean, false, 'prefixed token slipped through: ' + body);
    assert.ok(v.findings.some((x) => x.cls === 'secret_token'));
  }
});

test('a spelled-out currency amount (no $ symbol) is caught', () => {
  for (const body of ['the finding was worth 249,000 USD', 'that is 12000 dollars of value']) {
    const cand = clean();
    cand.body = body;
    const v = fg.guard(cand, { trusted: true });
    assert.equal(v.clean, false, 'spelled currency slipped through: ' + body);
    assert.ok(v.findings.some((x) => x.cls === 'financial'));
  }
});

test('a huge body is held (oversize) and does not hang the content scan', () => {
  const cand = clean();
  cand.body = 'x'.repeat(5_000_000); // 5 MB
  const start = Date.now();
  const v = fg.guard(cand, { trusted: true });
  assert.ok(Date.now() - start < 2000, 'content scan took too long on a huge body');
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'oversize' && x.field === 'body'));
});

test('a circular reference (via links) is unserializable and fails closed without throwing', () => {
  const cand = clean();
  const arr = [];
  arr.push(arr); // circular
  cand.links = arr;
  let v;
  assert.doesNotThrow(() => { v = fg.guard(cand, { trusted: true }); });
  assert.equal(v.clean, false);
  assert.equal(v.publish, false);
});

test('the exported contract is a closed, frozen shape', () => {
  assert.ok(Object.isFrozen(fg.ALLOWED_FIELDS));
  assert.equal(fg.KIND, 'community_post');
  // Every required field is also an allowed field.
  for (const r of fg.REQUIRED_FIELDS) assert.ok(fg.ALLOWED_FIELDS.includes(r));
});
