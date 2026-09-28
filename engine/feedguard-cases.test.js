'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cases = require('./feedguard-cases.json');
const feedguard = require('./feedguard');

const FIXED_AT = '2026-09-27T22:00:00Z';

function toBoardCandidate(input) {
  return {
    v: 1,
    kind: feedguard.KIND,
    agent: input.agent,
    at: FIXED_AT,
    topic: input.title,
    body: input.body,
  };
}

function publicOutput(input, verdict) {
  if (!verdict.clean) return null;
  return {
    agent: input.agent,
    channel: input.channel,
    sub_channel: input.sub_channel,
    title: verdict.post.topic,
    body: verdict.post.body,
  };
}

test('the language-neutral feedguard contract has unique, well-formed cases', () => {
  assert.equal(cases.version, 1);
  assert.ok(Array.isArray(cases.cases) && cases.cases.length > 0);
  const ids = new Set();
  for (const c of cases.cases) {
    assert.equal(typeof c.id, 'string');
    assert.ok(!ids.has(c.id), 'duplicate case id: ' + c.id);
    ids.add(c.id);
    assert.deepEqual(Object.keys(c.input).sort(), ['agent', 'body', 'channel', 'sub_channel', 'title']);
    for (const value of Object.values(c.input)) assert.equal(typeof value, 'string', c.id);
    assert.ok(c.reason === null || typeof c.reason === 'string', c.id);
    assert.equal(c.expected_output === null, c.reason !== null, c.id + ': output and reason disagree');
  }
});

test('known gaps stay explicit and point to their behavior-change card', () => {
  assert.ok(Array.isArray(cases.known_gaps));
  for (const gap of cases.known_gaps) {
    const verdict = feedguard.guard(toBoardCandidate(gap.input), { trusted: true });
    const currentReason = verdict.findings[0] ? verdict.findings[0].cls : null;
    assert.equal(currentReason, gap.current_reason, gap.id + ' current behavior changed; promote or revise the gap');
    assert.notDeepEqual(publicOutput(gap.input, verdict), gap.expected_output, gap.id + ' is no longer a failing gap');
  }
});

for (const c of cases.cases) {
  test('shared feedguard case: ' + c.id, () => {
    const verdict = feedguard.guard(toBoardCandidate(c.input), { trusted: true });
    assert.deepEqual(publicOutput(c.input, verdict), c.expected_output);
    if (c.reason === null) {
      assert.deepEqual(verdict.findings, []);
      assert.equal(verdict.publish, true);
    } else {
      assert.equal(verdict.publish, false);
      assert.ok(
        verdict.findings.some((finding) => finding.cls === c.reason),
        'expected reason ' + c.reason + ', got ' + JSON.stringify(verdict.findings),
      );
    }
  });
}
