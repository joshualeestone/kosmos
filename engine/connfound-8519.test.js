'use strict';
/* kosmos#8519: engine/connfound.js records which actions of a connection work, as the agents found them.
 *   node --test engine/connfound-8519.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-connfound-8519-'));
process.env.AGENT_WORKFORCE_DATA = SB;
const store = require('./store');
const cf = require('./connfound');
test.after(() => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });

function reset() { try { fs.rmSync(path.join(store.ROOT, 'connfound.json'), { force: true }); } catch { /* none */ } }

test('the store is the sandbox', () => {
  assert.ok(store.ROOT.startsWith(SB), store.ROOT);
});

test('parseMcpTool: the service and the action from a plugin tool name, provider prefixes dropped', () => {
  assert.deepEqual(cf.parseMcpTool('mcp__hubspot__update_deal'), { service: 'hubspot', action: 'update_deal' });
  assert.deepEqual(cf.parseMcpTool('mcp__claude_ai_Google_Drive__authenticate'), { service: 'Google Drive', action: 'authenticate' });
  assert.deepEqual(cf.parseMcpTool('mcp__plugin_discord_discord__reply'), { service: 'discord', action: 'reply' });
  assert.deepEqual(cf.parseMcpTool('mcp__plugin_acme_crm__list'), { service: 'acme crm', action: 'list' }, 'a plugin whose halves differ keeps both');
  for (const not of ['Bash', 'Read', 'mcp__', 'mcp__x', 'mcp____y', 'mcpx__a__b', '', null, 'mcp__a b__c']) {
    assert.equal(cf.parseMcpTool(not), null, String(not));
  }
});

test('classify: only what says something about the ACTION; Claude Code refusals and plain failures are null', () => {
  assert.equal(cf.classify('Unknown tool: crm_merge_contacts'), 'not-offered');
  assert.equal(cf.classify('MCP error -32601: Method not found'), 'not-offered');
  // Review 2: "operation not supported" is also how input errors read, so it is not a strong enough signal on its own.
  assert.equal(cf.classify('This operation is not supported by the server'), null);
  assert.equal(cf.classify('403 insufficient_scope: requires crm.objects.deals.write'), 'needs-scope', 'scope wins over the 403');
  assert.equal(cf.classify('missing required scopes for this endpoint'), 'needs-scope');
  assert.equal(cf.classify('HTTP 403 Forbidden'), 'needs-permission');
  assert.equal(cf.classify('You are not authorized to delete records'), 'needs-permission');
  assert.equal(cf.classify('Exports are disabled by your administrator'), 'off-by-policy');
  // Never the service:
  assert.equal(cf.classify('Permission to use mcp__hubspot__update_deal has been denied.'), null);
  assert.equal(cf.classify('The user rejected this tool call'), null);
  assert.equal(cf.classify('Permission to use mcp__hubspot__delete_deal has been denied: you are not allowed to run it here'), null,
    'a local refusal that ALSO reads like a permission error (the guard, not the absence of a match, decides)');
  // Says nothing about the action:
  assert.equal(cf.classify('Invalid input: dealId is required'), null);
  assert.equal(cf.classify('Request timed out after 30s'), null);
  // Review 1: errors about the input or the sign-in, not the action, record nothing.
  for (const notAboutTheAction of ['401 Unauthorized: token expired', 'Unauthorized', 'Error: user is not allowed to be empty',
    'Validation: field forbidden must be string', 'File type not supported', 'Not supported: this attachment is 40MB',
    '404 Not Found: no such record', '429 Too Many Requests', '405 Method Not Allowed']) {
    assert.equal(cf.classify(notAboutTheAction), null, notAboutTheAction);
  }
  // CONTROLS for the narrowed patterns: the same words about the caller or the action still count.
  assert.equal(cf.classify('Forbidden'), 'needs-permission');
  assert.equal(cf.classify('You are not allowed to delete this deal'), 'needs-permission');
  assert.equal(cf.classify('The update_deal tool is not supported'), 'not-offered');
  // Review 2: noise that also says 403 or "permission denied", and input errors in "not supported" words, record nothing.
  for (const noise of ['403 Forbidden: rate limit exceeded', 'API rate limit exceeded (403)', 'Error 403: The request is missing a valid API key',
    'EACCES: permission denied, open /tmp/x', 'permission denied (publickey)', 'This operation is not supported on shared drives',
    'Error: function not supported for this file format', 'error: operation not supported for value of type string',
    'Error: unknown action type in payload field "type"', '403']) {
    assert.equal(cf.classify(noise), null, noise);
  }
  // Review 2: the scope errors real services send, and scope before permission.
  for (const scope of ['Request had insufficient authentication scopes.', 'Insufficient Permission: Request had insufficient authentication scopes.',
    'missing_scope', 'Resource not accessible by integration', 'Resource not accessible by personal access token',
    'This app does not have proper permissions! (requires any of [crm.objects.deals.write])']) {
    assert.equal(cf.classify(scope), 'needs-scope', scope);
  }
  assert.equal(cf.classify('403: SAML enforcement is enabled for this organization'), 'off-by-policy');
  assert.equal(cf.classify(''), null);
  assert.equal(cf.classify(undefined), null);
});

test('noteToolFailure: a plugin action that the service refused is recorded; anything else is not', () => {
  reset();
  assert.deepEqual(cf.noteToolFailure('ada', 'mcp__hubspot__merge_contacts', 'Unknown tool: merge_contacts', { now: 1000 }), { recorded: true, outcome: 'not-offered' });
  assert.deepEqual(cf.noteToolFailure('ada', 'Bash', 'HTTP 403 Forbidden', { now: 1000 }), { recorded: false }, 'not a plugin tool');
  assert.deepEqual(cf.noteToolFailure('ada', 'mcp__hubspot__get_deal', 'Invalid input', { now: 1000 }), { recorded: false }, 'a bad input');
  assert.deepEqual(cf.noteToolFailure('ada', 'mcp__hubspot__get_deal', 'Permission to use mcp__hubspot__get_deal has been denied', { now: 1000 }), { recorded: false }, 'a local refusal');
  const l = cf.list({ now: 2000 });
  assert.equal(l.length, 1);
  assert.equal(l[0].name, 'hubspot');
  assert.equal(l[0].kind, 'other');
  assert.deepEqual(l[0].actions.map((a) => [a.action, a.outcome, a.how, a.by]), [['merge_contacts', 'not-offered', 'auto', 'ada']]);
});

test('record: the latest outcome per action wins, repeats count, and what does not work lists first', () => {
  reset();
  assert.deepEqual(cf.record({ service: 'GitHub', action: 'create release', outcome: 'needs-scope', by: 'ada', kind: 'kosmos', now: 1000 }), { ok: true });
  assert.deepEqual(cf.record({ service: 'github', action: 'create release', outcome: 'needs-scope', by: 'ben', kind: 'kosmos', now: 2000 }), { ok: true });
  assert.deepEqual(cf.record({ service: 'GitHub', action: 'open pull request', outcome: 'works', by: 'ada', kind: 'kosmos', now: 3000 }), { ok: true });
  assert.deepEqual(cf.record({ service: 'GitHub', action: 'delete repo', outcome: 'needs-permission', by: 'ada', kind: 'kosmos', now: 2500, note: 'the token is read only' }), { ok: true });
  const [g] = cf.list({ now: 4000 });
  assert.equal(g.name, 'GitHub', 'the first spelling is kept');
  assert.equal(g.kind, 'kosmos');
  assert.equal(g.notWorking, 2);
  assert.deepEqual(g.actions.map((a) => a.action), ['delete repo', 'create release', 'open pull request'], 'not working first, newest first');
  const cr = g.actions.find((a) => a.action === 'create release');
  assert.equal(cr.n, 2);
  assert.equal(cr.by, 'ben');
  assert.equal(cr.words, 'Needs a wider sign-in');
  // A later success replaces the failure.
  cf.record({ service: 'GitHub', action: 'create release', outcome: 'works', by: 'ada', kind: 'kosmos', now: 5000 });
  const g2 = cf.list({ now: 6000 })[0];
  assert.equal(g2.actions.find((a) => a.action === 'create release').outcome, 'works');
  assert.equal(g2.actions.find((a) => a.action === 'create release').n, 1, 'a change of outcome restarts the count');
});

test('a later refusal replaces an earlier works for the same action (the latest finding wins, either way)', () => {
  reset();
  cf.record({ service: 'hubspot', action: 'update_deal', outcome: 'works', by: 'ben', now: 1000 });
  cf.noteToolFailure('ada', 'mcp__hubspot__update_deal', 'HTTP 403 Forbidden', { now: 2000 });
  const a = cf.list({ now: 3000 })[0].actions[0];
  assert.deepEqual([a.action, a.outcome, a.by, a.how], ['update_deal', 'needs-permission', 'ada', 'auto']);
});

test('review 2: a plugin and a Kosmos connection of the same name are two rows, never one', () => {
  reset();
  cf.noteToolFailure('ada', 'mcp__plugin_github_github__create_pull_request', 'Resource not accessible by integration', { now: 1000 });
  cf.record({ service: 'GitHub', action: 'create release', outcome: 'needs-scope', by: 'ben', kind: 'kosmos', now: 2000 });
  const l = cf.list({ now: 3000 });
  assert.deepEqual(l.map((s) => [s.name, s.kind, s.actions.map((a) => a.action)]).sort(),
    [['GitHub', 'kosmos', ['create release']], ['github', 'other', ['create_pull_request']]]);
  assert.equal(cf.list({ service: 'GITHUB', now: 3000 }).length, 2, '?service= finds both by name');
});

test('review 2: a service or action named like an Object property is an ordinary name', () => {
  reset();
  for (const n of ['constructor', 'toString', 'hasOwnProperty']) {
    assert.deepEqual(cf.record({ service: n, action: n, outcome: 'works', by: 'ada', now: 1000 }), { ok: true }, n);
  }
  assert.deepEqual(cf.list({ now: 2000 }).map((s) => s.name).sort(), ['constructor', 'hasOwnProperty', 'toString']);
});

test('review 2: direction marks and C1 controls in a note are taken out', () => {
  reset();
  assert.deepEqual(cf.record({ service: 'Notion', action: 'search', outcome: 'works', by: 'ada', now: 1000, note: 'ok \u202eevil\u202c and \u0085 done' }), { ok: true });
  const note = cf.list({ now: 2000 })[0].actions[0].note;
  assert.equal(note, 'ok evil and done');
});

test('record refuses what it cannot keep honestly', () => {
  reset();
  const base = { service: 'Notion', action: 'search', outcome: 'works', by: 'ada', now: 1000 };
  assert.match(cf.record({ ...base, outcome: 'maybe' }).because, /outcome is one of/);
  assert.match(cf.record({ ...base, service: '' }).because, /service/);
  assert.match(cf.record({ ...base, action: '<script>' }).because, /action/);
  assert.match(cf.record({ ...base, by: '' }).because, /which agent/);
  assert.match(cf.record({ ...base, note: 'x'.repeat(cf.MAX_NOTE + 1) }).because, /at most/);
  assert.match(cf.record({ ...base, note: 'token ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8' }).because, /looks like it holds a key/);
  assert.deepEqual(cf.list({ now: 2000 }), [], 'nothing refused was written');
  assert.deepEqual(cf.record({ ...base, note: 'search works on shared pages only' }), { ok: true }, 'CONTROL: a plain note is kept');
});

test('findings expire after 30 days, and each service keeps at most MAX_ACTIONS', () => {
  reset();
  cf.record({ service: 'Linear', action: 'old', outcome: 'failed', by: 'ada', now: 1000 });
  assert.equal(cf.list({ now: 1000 + cf.KEEP_MS - 1 }).length, 1);
  assert.equal(cf.list({ now: 1000 + cf.KEEP_MS + 1 }).length, 0, 'expired');
  reset();
  for (let i = 0; i < cf.MAX_ACTIONS + 5; i++) cf.record({ service: 'Linear', action: 'a' + i, outcome: 'works', by: 'ada', now: 1000 + i });
  const acts = cf.list({ now: 5000 })[0].actions.map((a) => a.action);
  assert.equal(acts.length, cf.MAX_ACTIONS);
  assert.ok(!acts.includes('a0') && acts.includes('a' + (cf.MAX_ACTIONS + 4)), 'the oldest were dropped');
});

test('an unreadable store reads as nothing found, and the next record starts it afresh', () => {
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'connfound.json'), '{not json');
  assert.deepEqual(cf.list(), []);
  assert.deepEqual(cf.record({ service: 'Exa', action: 'search', outcome: 'works', by: 'ada' }), { ok: true });
  assert.equal(cf.list().length, 1);
});

test('renderLines: what both CLIs print, plain and with no em dash', () => {
  reset();
  assert.deepEqual(cf.renderLines([], 0), ['No agent has recorded what works on a connection yet, in the last 30 days.']);
  cf.noteToolFailure('ada', 'mcp__hubspot__merge_contacts', 'Unknown tool', { now: 0 });
  cf.noteToolFailure('ada', 'mcp__hubspot__merge_contacts', 'Unknown tool', { now: 60000 });
  cf.record({ service: 'hubspot', action: 'search', outcome: 'works', by: 'ben', now: 0, note: 'contacts and deals' });
  const lines = cf.renderLines(cf.list({ now: 120000 }), 120000);
  assert.deepEqual(lines, [
    'hubspot (outside Kosmos): 1 action does not work',
    '  merge_contacts: The service does not offer this (seen on a refused call by ada, 1 minute ago, 2 times)',
    '  search: Works (recorded by ben, 2 minutes ago) - contacts and deals',
  ]);
  assert.ok(lines.every((l) => !l.includes('—')));
});
