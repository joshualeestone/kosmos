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
    const hit = p.fn ? p.fn(body) : p.re.test(body);
    assert.equal(hit, false, 'clean body unexpectedly matched ' + p.why);
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

test('a secret buried in an unexpected field is held, and its content never reaches the snapshot', () => {
  const cand = clean();
  cand.extra = 'ghp_' + 'b'.repeat(36);
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'unexpected_field' && x.field === 'extra'));
  // The snapshot the board would publish carries ONLY allowed fields -- the
  // unexpected field (and its secret) is excluded entirely, not merely flagged.
  assert.ok(!('extra' in v.post), 'unexpected field leaked into the published snapshot');
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

/* A seeded generator for the equivalence tests, so a failure reproduces.
   Math.imul keeps the multiply in 32 bits. The first version multiplied as
   floats; the product passed 2^53, the low bits were lost, and the sequence
   cycled after 11,000 to 16,000 values in 50,000 draws (#3609). */
function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x80000000; };
}

test('the seeded generator does not cycle within a test run', () => {
  const rand = seeded(3608);
  const seen = new Set();
  for (let i = 0; i < 50000; i++) seen.add(rand());
  assert.equal(seen.size, 50000);
});

/* #3608: the email pattern used to be quadratic on a long run of local-part
   characters with no "@", which is what made the test above fail on a busy
   Mac. The inputs here are 65536 characters, four times SCAN_CAP, because
   this tests the regex itself and a quadratic cost is sixteen times larger
   there: measured on this fleet's Mac at load 7 to 14, the unanchored form
   took 2.2 to 3.8 s on each of the first three inputs and the anchored one at
   most 1 ms, so a 200 ms bound is over ten times away from both. The fourth
   input exercises the domain half after "@"; it is fast for both forms. */
const EMAIL = fg.PATTERNS.find((p) => p.cls === 'email').re;
// A deliberate copy of the pre-#3608 form. A later change to the email pattern
// that is meant to change what it matches must update this copy too.
const EMAIL_UNANCHORED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

test('#3608: the email pattern is linear on a long run with no match', () => {
  const inputs = ['x'.repeat(65536), 'a.'.repeat(32768), 'a@' + 'a-'.repeat(32767), 'a@'.repeat(32768)];
  for (const s of inputs) {
    const start = Date.now();
    const hit = EMAIL.test(s);
    const ms = Date.now() - start;
    assert.equal(hit, false);
    assert.ok(ms < 200, 'email pattern took ' + ms + ' ms on a ' + s.length + '-char ' + JSON.stringify(s.slice(0, 4)) + '... run');
  }
});

test('#3608: the anchored email pattern finds exactly what the unanchored one does', () => {
  const fixed = [
    'a@b.cd', 'mail me at first.last+tag@example.co.uk today', 'x.y@z', 'a@b.c', '@b.cd', 'a@.cd',
    'foo@@bar.com', 'a@b.cd@e.fg', '..a@b.cd', 'name@host', 'Josh <jo%sh@ex-ample.org>', 'a b@c.de',
  ];
  for (const s of fixed) assert.equal(EMAIL.test(s), EMAIL_UNANCHORED.test(s), JSON.stringify(s));
  // A seeded generator over the characters that matter to either form, so a
  // failure reproduces. At least one string must match, or agreeing on "no"
  // everywhere would pass while proving nothing.
  const rand = seeded(3608);
  // Letters, dots and '@' are weighted so that a useful share of strings are
  // email-shaped; with a flat alphabet only about 40 in 50000 matched.
  const alphabet = 'aabb.@.@ab1%+-_ Z\n';
  let matched = 0;
  // 100000 draws: about 400 match. (With the old cycling generator 50000 draws
  // reported 434, but many were repeats; without repeats 50000 gives about 200.)
  for (let i = 0; i < 100000; i++) {
    let s = '';
    const len = Math.floor(rand() * 14);
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
    const want = EMAIL_UNANCHORED.test(s);
    if (want) matched++;
    assert.equal(EMAIL.test(s), want, JSON.stringify(s));
  }
  assert.ok(matched > 300, 'the generator produced only ' + matched + ' matching strings');
});

/* #3609: the spelled grouped-currency check was a regex that went quadratic on
   a long comma chain with no currency word after it (121 ms at 16 KB, about 4x
   per doubling). It is now a function. These pin it to the old regex's answers
   and to linear time. */
const SPELLED = fg.PATTERNS.find((p) => p.why === 'grouped currency amount (spelled)').fn;
// A deliberate copy of the pre-#3609 regex. A later change meant to alter what
// the check matches must update this copy too.
const SPELLED_REGEX = /\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*(?:USD|EUR|GBP|dollars?|euros?|pounds?)\b/i;

test('#3609: the spelled grouped-currency check is linear on long inputs', () => {
  const chain = '9' + ',999'.repeat(16384); // 65537 chars; the old regex took seconds
  const inputs = [
    [chain, false],                          // the shape that was quadratic
    [chain + ' USD', true],                  // the same chain, now an amount
    [' '.repeat(65536) + 'USD', false],      // a long look back over whitespace
    ['1,23 USD '.repeat(7000), false],       // thousands of words, each looked back from and rejected
    ['1.'.repeat(32768) + 'USD', false],     // a long look back over a fraction
  ];
  for (const [s, want] of inputs) {
    const start = Date.now();
    const hit = SPELLED(s);
    const ms = Date.now() - start;
    assert.equal(hit, want, 'wrong answer on ' + JSON.stringify(s.slice(0, 12)) + '...');
    assert.ok(ms < 200, 'spelled currency check took ' + ms + ' ms on a ' + s.length + '-char ' + JSON.stringify(s.slice(0, 6)) + '... input');
  }
});

test('#3609: the spelled grouped-currency check finds exactly what the old regex does', () => {
  const fixed = [
    '249,000 USD', '1,234.50 euros', 'a,123,456 USD', '1234,567 USD', '1,2345 USD', '1,234USD',
    '1,234 USDX', '1,234.5 6 USD', '1,234.567,890 USD', '1,234 DOLLARS', '1,234 dollarss',
    '1,234\u00a0GBP', '1,234\n\tpounds', '12,34 USD', '1,234. USD', '.1,234 usd', '1,234.USD',
    '9,999,999,999 EUR!', 'USD', '', '1,234', ',234 USD', '1,234 US dollars',
    '1,234\ufeffUSD', '1,234\u2028usd', '1,234.5\u00a0\u00a0euros',
  ];
  for (const s of fixed) assert.equal(SPELLED(s), SPELLED_REGEX.test(s), JSON.stringify(s));
  // Structured strings: noise, a digit-and-separator core, an optional
  // fraction, whitespace, a currency-like word and a suffix. A flat alphabet
  // almost never forms "d,ddd", so it cannot test anything here.
  const rand = seeded(3609);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const digits = (lo, hi) => { let d = ''; for (let n = lo + Math.floor(rand() * (hi - lo + 1)); n > 0; n--) d += String(Math.floor(rand() * 10)); return d; };
  const NO_FRACTION = /\d{1,3}(?:,\d{3})+\s*(?:USD|EUR|GBP|dollars?|euros?|pounds?)\b/i;
  let matched = 0, fractionMatters = 0;
  for (let i = 0; i < 50000; i++) {
    let s = '';
    for (let k = Math.floor(rand() * 3); k > 0; k--) s += pick(['x', '.', ',', ' ', '9', '$', 'a,']);
    s += digits(0, 4);
    for (let k = Math.floor(rand() * 3); k > 0; k--) s += pick([',', ',', ',', '.', ' ']) + digits(1, 4);
    if (rand() < 0.4) s += pick(['.', '.', ',']) + digits(0, 3);
    for (let k = Math.floor(rand() * 3); k > 0; k--) s += pick([' ', '\n', '\u00a0', '\t', '\ufeff', '\u2028', 'x']);
    s += pick(['USD', 'usd', 'Eur', 'GBP', 'dollar', 'dollars', 'euros', 'pound', 'pounds', 'US', 'dollarz', '']);
    s += pick(['', '', ' ', '.', 's', 'x', '_', '1', '!']);
    const want = SPELLED_REGEX.test(s);
    if (want) matched++;
    if (NO_FRACTION.test(s) !== want) fractionMatters++;
    assert.equal(SPELLED(s), want, JSON.stringify(s));
  }
  // Both floors keep the test honest: enough strings match, and enough of them
  // need the fraction arm, so a version without it could not pass.
  assert.ok(matched > 1000, 'only ' + matched + ' generated strings matched');
  assert.ok(fractionMatters > 200, 'only ' + fractionMatters + ' generated strings depended on the fraction');
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

// ---- fail-open regressions caught by the iteration-2 blind review -----------

test('a Symbol at (skipped by both scans) fails closed and cannot smuggle a token', () => {
  const cand = clean();
  cand.at = Symbol('ghp_' + 'a'.repeat(36));
  let v;
  assert.doesNotThrow(() => { v = fg.guard(cand, { trusted: true }); });
  assert.equal(v.clean, false);
  assert.equal(v.publish, false);
  assert.ok(v.findings.some((x) => x.cls === 'wrong_type' && x.field === 'at'));
});

test('guard(candidate, null) does not throw and holds', () => {
  let v;
  assert.doesNotThrow(() => { v = fg.guard(clean(), null); });
  assert.equal(v.publish, false, 'null opts means no asserted trust -> held');
  assert.equal(v.clean, true);
  // any non-object opts is coerced, not thrown on
  for (const bad of [null, 42, 'x', true]) {
    assert.doesNotThrow(() => fg.guard(clean(), bad));
  }
});

test('a many-links candidate is bounded and does not hang the scan', () => {
  const cand = clean();
  cand.links = [];
  for (let i = 0; i < 60; i++) cand.links.push('https://example.com/' + 'a'.repeat(2000));
  const start = Date.now();
  const v = fg.guard(cand, { trusted: true });
  assert.ok(Date.now() - start < 2000, 'many-links scan took too long');
  assert.equal(v.clean, false); // > LIMITS.links -> oversize
  assert.ok(v.findings.some((x) => x.cls === 'oversize' && x.field === 'links'));
});

test('newly added leak classes are caught: SSN, card, AWS STS (ASIA)', () => {
  const cases = [
    ['ssn', 'his ssn is 123-45-6789 apparently'],
    ['card', 'card 4111 1111 1111 1111 on file'],
    ['card', 'card 4111-1111-1111-1111 on file'],
    ['secret_token', 'temp creds ASIAIOSFODNN7EXAMPLE here'],
  ];
  for (const [cls, body] of cases) {
    const cand = clean();
    cand.body = body;
    const v = fg.guard(cand, { trusted: true });
    assert.equal(v.clean, false, cls + ' slipped: ' + body);
    assert.ok(v.findings.some((x) => x.cls === cls), body + ' not classed ' + cls);
  }
});

test('non-USD currency figures are caught', () => {
  for (const body of ['the loss was €249,000 total', 'that is 249,000 EUR', '£120000 gone']) {
    const cand = clean();
    cand.body = body;
    const v = fg.guard(cand, { trusted: true });
    assert.equal(v.clean, false, 'currency slipped: ' + body);
    assert.ok(v.findings.some((x) => x.cls === 'financial'));
  }
});

test('name-denylist evasions are caught after normalization', () => {
  const evasions = [
    'Jos​h Stone asked me to',   // zero-width space
    'Josh\nStone asked me to',         // newline for the space
    'Ｊｏｓｈ Stone did', // full-width "Josh"
  ];
  for (const body of evasions) {
    const cand = clean();
    cand.body = body;
    const v = fg.guard(cand, { trusted: true });
    assert.equal(v.clean, false, 'name evasion slipped: ' + JSON.stringify(body));
    assert.ok(v.findings.some((x) => x.cls === 'human_name'));
  }
});

test('a non-enumerable own property is caught as an unexpected field', () => {
  const cand = clean();
  Object.defineProperty(cand, 'stash', { value: 'ghp_' + 'z'.repeat(36), enumerable: false });
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'unexpected_field' && x.field === 'stash'));
});

test('two secrets in two different fields yield two field-attributed findings', () => {
  const cand = clean();
  cand.topic = 'ghp_' + 'a'.repeat(36);
  cand.body = 'ghp_' + 'b'.repeat(36);
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  const tokenFields = v.findings.filter((x) => x.cls === 'secret_token').map((x) => x.field);
  assert.ok(tokenFields.includes('topic'), 'topic leak not attributed');
  assert.ok(tokenFields.includes('body'), 'body leak not attributed');
});

test('an oversize at is a structural finding', () => {
  const cand = clean();
  cand.at = 'x'.repeat(fg.LIMITS.at + 1);
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'oversize' && x.field === 'at'));
});

// ---- fail-open regressions caught by the iteration-3 blind review -----------

test('full-width-digit PII is caught (pattern scan folds NFKC like the name scan)', () => {
  const fwSSN = '１２３-４５-６７８９'; // 123-45-6789 full-width
  const fwCard = '４１１１１１１１１１１１１１１１'; // 4111111111111111 full-width
  for (const [cls, body] of [['ssn', 'ref ' + fwSSN + ' noted'], ['card', 'pan ' + fwCard + ' saved']]) {
    const cand = clean();
    cand.body = body;
    const v = fg.guard(cand, { trusted: true });
    assert.equal(v.clean, false, 'full-width ' + cls + ' slipped');
    assert.ok(v.findings.some((x) => x.cls === cls));
  }
});

test('a getter on an allowed field is refused (TOCTOU), even if it reads clean at inspection', () => {
  const cand = clean();
  let reads = 0;
  Object.defineProperty(cand, 'body', {
    configurable: true, enumerable: true,
    get() { reads += 1; return reads === 1 ? 'clean prose' : 'ghp_' + 'a'.repeat(36); },
  });
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'accessor_field' && x.field === 'body'));
});

test('a bare (no-separator) Luhn-valid card number is caught', () => {
  const cand = clean();
  cand.body = 'card 4111111111111111 on file'; // valid Luhn, no separators
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'card'));
});

test('a random long digit run that fails Luhn is NOT flagged as a card', () => {
  const cand = clean();
  cand.body = 'build id 1111111111111111 ran'; // 16 digits, fails Luhn (checksum 24)
  // may still be clean or flagged by something else, but NOT as a card
  const v = fg.guard(cand, { trusted: true });
  assert.ok(!v.findings.some((x) => x.cls === 'card'), 'a non-Luhn number was misflagged as a card');
});

test('a soft-hyphen name evasion is caught (\\p{Cf} strip)', () => {
  const cand = clean();
  cand.body = 'Jos­h Stone reviewed it'; // soft hyphen
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'human_name'));
});

// ---- TOCTOU closure caught by the iteration-4 blind review ------------------

test('verdict.post is the sanitized snapshot the board publishes (allowed fields only, disjoint links)', () => {
  const cand = clean();
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.publish, true);
  assert.ok(v.post && typeof v.post === 'object');
  for (const k of Object.keys(v.post)) assert.ok(fg.ALLOWED_FIELDS.includes(k), 'snapshot has a non-allowed key: ' + k);
  assert.equal(v.post.body, clean().body);
  // links must be a FRESH array, not the caller's live reference.
  assert.notEqual(v.post.links, cand.links, 'post.links is the caller live array');
  assert.deepEqual(v.post.links, cand.links);
});

test('mutating the caller links array after guard cannot change what the board publishes (TOCTOU)', () => {
  const cand = clean();
  const liveLinks = ['https://example.com/ok'];
  cand.links = liveLinks;
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.publish, true);
  liveLinks[0] = 'ghp_' + 'a'.repeat(36); // caller mutates AFTER inspection
  assert.ok(!/ghp_/.test(String(v.post.links[0])), 'a post-inspection mutation leaked into the published snapshot');
});

test('a PROTOTYPE-chain getter cannot smuggle a leak (bad_prototype + snapshot)', () => {
  let reads = 0;
  const proto = { get body() { reads += 1; return reads === 1 ? 'clean prose' : 'ghp_' + 'a'.repeat(36); } };
  const cand = Object.create(proto);
  cand.v = 1; cand.kind = 'community_post'; cand.agent = 'PigeonPete'; cand.at = '2026-09-23T18:10:00Z';
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.publish, false, 'a prototype-getter candidate must not publish');
  assert.ok(v.findings.some((x) => x.cls === 'bad_prototype'));
  // whatever the board publishes is the frozen snapshot, not a live re-read
  if (v.post && typeof v.post.body === 'string') {
    assert.ok(!/ghp_/.test(v.post.body), 'a later getter read leaked into the snapshot');
  }
});

test('a Proxy with a lying descriptor trap cannot publish a live-mutating field', () => {
  let reads = 0;
  const target = { v: 1, kind: 'community_post', agent: 'PigeonPete', at: '2026-09-23T18:10:00Z', body: 'seed', topic: 'x' };
  const cand = new Proxy(target, {
    get(t, p) { if (p === 'body') { reads += 1; return reads === 1 ? 'clean prose' : 'ghp_' + 'a'.repeat(36); } return t[p]; },
    getOwnPropertyDescriptor(t, p) { return { configurable: true, enumerable: true, writable: true, value: t[p] }; },
    getPrototypeOf() { return Object.prototype; },
  });
  const v = fg.guard(cand, { trusted: true });
  // The board publishes verdict.post (the one-read snapshot). Whatever it holds,
  // it must be the value captured at inspection, never a later leaking read.
  assert.ok(v.post && typeof v.post === 'object');
  assert.ok(!/ghp_/.test(String(v.post.body)), 'a later proxy read leaked into the snapshot the board would publish');
});

// ---- fail-open regression caught by the iteration-6 blind review ------------

test('a denylisted human name in the AGENT field is caught (not just body)', () => {
  for (const agent of ['Josh Stone', 'joshualeestone']) {
    const cand = clean();
    cand.agent = agent;
    const v = fg.guard(cand, { trusted: true });
    assert.equal(v.clean, false, agent + ' in agent slipped through');
    assert.equal(v.publish, false);
    assert.ok(v.findings.some((x) => x.cls === 'human_name' && x.field === 'agent'));
  }
});

test('a denylisted name in the session field is caught', () => {
  const cand = clean();
  cand.session = 'joshualeestone';
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'human_name' && x.field === 'session'));
});

test('verdict.post is actually frozen (object and links)', () => {
  const v = fg.guard(clean(), { trusted: true });
  assert.ok(Object.isFrozen(v.post), 'post is not frozen');
  assert.ok(Object.isFrozen(v.post.links), 'post.links is not frozen');
});

test('a symbol key description is redacted in findings, never echoed raw', () => {
  const cand = clean();
  const s = Symbol('ghp_' + 'a'.repeat(36));
  cand[s] = 'x';
  const v = fg.guard(cand, { trusted: true });
  assert.equal(v.clean, false);
  assert.ok(v.findings.some((x) => x.cls === 'unexpected_field' && x.field === '[symbol key]'));
  const asText = JSON.stringify(v.findings);
  assert.ok(!/ghp_/.test(asText), 'a secret-shaped symbol description leaked into findings');
});

test('the exported contract is a closed, frozen shape', () => {
  assert.ok(Object.isFrozen(fg.ALLOWED_FIELDS));
  assert.equal(fg.KIND, 'community_post');
  // Every required field is also an allowed field.
  for (const r of fg.REQUIRED_FIELDS) assert.ok(fg.ALLOWED_FIELDS.includes(r));
});
