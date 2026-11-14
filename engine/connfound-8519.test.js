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

test('classify: not-offered ONLY when the line starts by saying the called action is unknown (review 3)', () => {
  const A = 'merge_contacts';
  for (const yes of ['Unknown tool: merge_contacts', 'Unknown tool: mcp__hubspot__merge_contacts', 'MCP error -32601: Unknown tool: merge_contacts',
    'Tool not found: "merge_contacts"', 'unknown tool merge_contacts.', 'UNKNOWN TOOL: Merge_Contacts',
    'MCP error -32602: Tool merge_contacts not found', 'Error: MCP error -32601: Unknown tool: merge_contacts']) {   // review 4: the TS SDK and an Error: lead
    assert.equal(cf.classify(yes, A), 'not-offered', yes);
  }
  // Review 3's false positives, and every class the earlier rounds found: nothing is recorded.
  for (const no of ['Unknown tool: other_tool', 'MCP error -32601: Method not found: tools/call', 'Method not found',
    'Error: Payment method not found', 'Error: tool not found in cache, retrying', 'Error: method not implemented for draft messages',
    'No such tool available: mcp__hubspot__merge_contacts', 'Streamable HTTP error: Error POSTing to endpoint (HTTP 403): Forbidden',
    'HTTP 403 Forbidden', 'Forbidden', '403 Forbidden: Repository was archived so is read-only', '401 Unauthorized: token expired',
    'Request had insufficient authentication scopes.', 'missing_scope', 'Exports are disabled by your administrator',
    'This operation is not supported on shared drives', 'Invalid input: dealId is required', 'Request timed out after 30s',
    'Permission to use mcp__hubspot__merge_contacts has been denied', 'The user rejected this tool call',
    'Tool other_tool not found', 'Tool merge_contacts not found in cache', '']) {
    assert.equal(cf.classify(no, A), null, no);
  }
  assert.equal(cf.classify('Unknown tool: merge_contacts', ''), null, 'no action named, nothing to match');
});

test('noteToolFailure: an unknown-tool refusal naming the called action is recorded; anything else is not', () => {
  reset();
  assert.deepEqual(cf.noteToolFailure('ada', 'mcp__hubspot__merge_contacts', 'Unknown tool: merge_contacts', { now: 1000 }), { recorded: true, outcome: 'not-offered' });
  assert.deepEqual(cf.noteToolFailure('ada', 'Bash', 'Unknown tool: Bash', { now: 1000 }), { recorded: false }, 'not a plugin tool');
  assert.deepEqual(cf.noteToolFailure('ada', 'mcp__hubspot__get_deal', 'HTTP 403 Forbidden', { now: 1000 }), { recorded: false }, 'a 403');
  assert.deepEqual(cf.noteToolFailure('ada', 'mcp__hubspot__get_deal', 'Unknown tool: merge_contacts', { now: 1000 }), { recorded: false }, 'names another action');
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

test('review 3: an automatic finding never replaces a hand record; a hand works clears an automatic one in either row', () => {
  reset();
  cf.record({ service: 'hubspot', action: 'update_deal', outcome: 'works', by: 'ben', now: 1000 });
  assert.deepEqual(cf.noteToolFailure('ada', 'mcp__hubspot__update_deal', 'Unknown tool: update_deal', { now: 2000 }), { recorded: false });
  let a = cf.list({ now: 3000 })[0].actions[0];
  assert.deepEqual([a.action, a.outcome, a.by, a.how], ['update_deal', 'works', 'ben', 'agent'], 'the hand record stands');
  cf.record({ service: 'hubspot', action: 'update_deal', outcome: 'needs-permission', by: 'ada', now: 4000 });
  a = cf.list({ now: 5000 })[0].actions[0];
  assert.equal(a.outcome, 'needs-permission', 'a hand record does replace a hand record');
  reset();
  cf.noteToolFailure('ada', 'mcp__plugin_github_github__create_pull_request', 'Unknown tool: create_pull_request', { now: 1000 });
  assert.equal(cf.list({ now: 1500 }).length, 1, 'CONTROL: the automatic finding is there');
  cf.record({ service: 'GitHub', action: 'Create Pull-Request', outcome: 'works', by: 'ben', kind: 'kosmos', now: 2000 });
  const l = cf.list({ now: 3000 });
  assert.deepEqual(l.map((x) => [x.name, x.kind, x.actions.map((y) => [y.action, y.outcome])]), [['GitHub', 'kosmos', [['Create Pull-Request', 'works']]]]);
});

test('review 4: a hand record names a plugin as the hook does, so it lands on the same row and clears it', () => {
  reset();
  cf.noteToolFailure('ada', 'mcp__claude_ai_Google_Drive__export_file', 'Unknown tool: export_file', { now: 1000 });
  assert.equal(cf.list({ now: 1500 })[0].name, 'Google Drive', 'CONTROL: the automatic row');
  cf.record({ service: 'claude_ai_Google_Drive', action: 'export_file', outcome: 'works', by: 'ben', now: 2000 });
  const l = cf.list({ now: 3000 });
  assert.deepEqual(l.map((s) => [s.name, s.actions.map((a) => [a.action, a.outcome, a.how])]), [['Google Drive', [['export_file', 'works', 'agent']]]]);
  assert.equal(cf.list({ service: 'claude_ai_Google_Drive', now: 3000 }).length, 1, '--found with the server name finds it');
  assert.equal(cf.serviceKey('foo_foo'), 'foo-foo', 'only a plugin\'s doubled name collapses');
});

test('review 4: at the service cap, services with only automatic findings go first', () => {
  reset();
  cf.record({ service: 'Kept', action: 'x', outcome: 'needs-scope', by: 'ada', now: 1 });
  for (let i = 0; i < cf.MAX_SERVICES + 3; i++) cf.noteToolFailure('ada', 'mcp__svc' + i + '__x', 'Unknown tool: x', { now: 100 + i });
  const names = cf.list({ now: 1000 }).map((s) => s.name);
  assert.equal(names.length, cf.MAX_SERVICES);
  assert.ok(names.includes('Kept'), 'the hand record outlives newer automatic rows');
  assert.ok(!names.includes('svc0') && names.includes('svc' + (cf.MAX_SERVICES + 2)), 'the oldest automatic rows went');
});

test('review 3: action names match whatever their case, spaces, underscores or hyphens, shown as first recorded', () => {
  reset();
  cf.record({ service: 'Linear', action: 'Create Issue', outcome: 'needs-scope', by: 'ada', now: 1000 });
  cf.record({ service: 'linear', action: 'create_issue', outcome: 'needs-scope', by: 'ben', now: 2000 });
  const acts = cf.list({ now: 3000 })[0].actions;
  assert.equal(acts.length, 1);
  assert.deepEqual([acts[0].action, acts[0].n, acts[0].by], ['Create Issue', 2, 'ben']);
});

test('review 2: a plugin and a Kosmos connection of the same name are two rows, never one', () => {
  reset();
  cf.noteToolFailure('ada', 'mcp__plugin_github_github__create_pull_request', 'Unknown tool: create_pull_request', { now: 1000 });
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
  // Review 3: zero-width characters could split a key past the note check; the redactor refuses such a note outright.
  assert.match(cf.record({ service: 'Notion', action: 'list', outcome: 'works', by: 'ada', now: 1000, note: 'ghp_\u200bA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8' }).because, /looks like it holds a key/);
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
  cf.noteToolFailure('ada', 'mcp__crm__x', 'Unknown tool: x', { now: 1000 });
  assert.equal(cf.list({ now: 1000 + cf.KEEP_AUTO_MS - 1 }).length, 1);
  assert.equal(cf.list({ now: 1000 + cf.KEEP_AUTO_MS + 1 }).length, 0, 'an automatic finding expires after a week');
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
  cf.noteToolFailure('ada', 'mcp__hubspot__merge_contacts', 'Unknown tool: merge_contacts', { now: 0 });
  cf.noteToolFailure('ada', 'mcp__hubspot__merge_contacts', 'Unknown tool: merge_contacts', { now: 60000 });
  cf.record({ service: 'hubspot', action: 'search', outcome: 'works', by: 'ben', now: 0, note: 'contacts and deals' });
  const lines = cf.renderLines(cf.list({ now: 120000 }), 120000);
  assert.deepEqual(lines, [
    'hubspot (outside Kosmos): 1 action does not work',
    '  merge_contacts: The service does not offer this (seen on a refused call by ada, 1 minute ago, 2 times)',
    '  search: Works (recorded by ben, 2 minutes ago) - contacts and deals',
  ]);
  assert.ok(lines.every((l) => !l.includes('\u2014')));
  assert.deepEqual(cf.renderLines([], 0, 'Acme CRM'), ['No agent has recorded anything about Acme CRM in the last 30 days.'], 'a service asked for is named');
});
