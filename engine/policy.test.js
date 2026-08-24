'use strict';

/**
 * Tests for the company AI policy record and its managed block (#479).
 * Sandbox-every-root, same shape as you.test.js.
 *
 *   node --test engine/policy.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pol-data-'));
const WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pol-workers-'));
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pol-home-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pol-projects-'));

const policy = require('./policy');
const projects = require('./projects');
const fleet = require('../test-support/fleet');

function bootFile(name) {
  return path.join(WORKERS, name, 'CLAUDE.md');
}
function plantAgent(name, text) {
  fs.mkdirSync(path.join(WORKERS, name), { recursive: true });
  fs.writeFileSync(bootFile(name), text, 'utf8');
}
const BOOT = 'You are **Casey**.\n\nDo the work well, and say what you did.\n';

test('the record is whole-or-not-at-all, round-trips, and carries its provenance', () => {
  assert.throws(() => policy.save({ source: 'pasted' }), /no policy text/);
  assert.throws(() => policy.save({ text: 'x'.repeat(policy.TEXT_MAX + 1), source: 'pasted' }), /longer/);
  assert.throws(() => policy.save({ text: 'Be careful.', source: 'somewhere' }), /where this policy came from/);
  assert.equal(policy.read().state, 'absent', 'no policy yet is absent, not an error');

  policy.save({ text: 'Never paste customer data into a chat.', source: 'https://example.com/ai-policy' });
  const back = policy.read();
  assert.equal(back.state, 'saved');
  assert.equal(back.policy.source, 'https://example.com/ai-policy');
  assert.match(back.policy.text, /customer data/);

  // The block opens with where it came from and when, before the words.
  const body = policy.blockBody(back.policy);
  assert.match(body, /From https:\/\/example\.com\/ai-policy, fetched \d{4}-\d{2}-\d{2}\./);
  assert.match(body, /policy wins/);
  const pasted = policy.blockBody({ text: 'Short.', source: 'pasted', savedAt: '2026-08-23T00:00:00Z' });
  assert.match(pasted, /Added by the person you work for on 2026-08-23\./);

  // A marker pair typed into the policy text is neutralised, with a control.
  const smuggled = policy.blockBody({ text: 'A ' + projects.YOU_START + ' pair ' + projects.YOU_END + ' typed in', source: 'pasted', savedAt: null });
  assert.ok(!smuggled.includes(projects.YOU_START) && !smuggled.includes(projects.YOU_END), 'a sibling marker survived through pasted policy text');
  assert.ok(smuggled.includes('(kosmos marker)'), 'CONTROL: neutralisation left no trace, so the absence above proves nothing');
});

test('tellAgent writes the block for a tied agent, clear removes it, strangers are refused', () => {
  policy.save({ text: 'Cite your sources.', source: 'pasted' });
  plantAgent('casey', BOOT);
  const roster = fleet.install([fleet.agent('casey', { state: 'idle' })]).agents;
  try {
    assert.equal(policy.tellAgent('casey', roster).state, projects.TOLD.TOLD);
    const text = fs.readFileSync(bootFile('casey'), 'utf8');
    assert.ok(text.includes(policy.START) && text.includes("company's AI policy") && text.includes('Cite your sources.'));
    assert.ok(text.includes('Do the work well'), 'the agent\'s own words survived');

    // Cleared: the block comes out, no residue, the agent's words stay.
    policy.clear();
    assert.equal(policy.read().state, 'absent');
    assert.equal(policy.tellAgent('casey', roster).state, projects.TOLD.TOLD);
    const after = fs.readFileSync(bootFile('casey'), 'utf8');
    assert.ok(!after.includes(policy.START) && !after.includes('AI policy'));
    assert.ok(after.includes('Do the work well'));

    // A name the roster cannot vouch for is refused before any write.
    const r = policy.tellAgent('nobody-here', roster);
    assert.equal(r.state, projects.TOLD.COULD_NOT);
    assert.match(r.because, /exactly this name/);
  } finally {
    fleet.uninstall && fleet.uninstall();
  }
});
