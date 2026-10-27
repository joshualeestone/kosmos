'use strict';
/**
 * kosmos#7365: a room read hands reactionsFor and claimOf only the post's own reaction rows, grouped once per request.
 * Before, each post's call walked the whole log, so a read was O(posts x log): a 5,500-post room took about 400 ms to
 * read and reactionsFor was 76% of it. Pinned by WHAT each call is given (a timing bound would scale with the machine),
 * and the pills are checked to be exactly what they were. Real rows through the real route.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-roomreact-7365-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const messages = require('./engine/messages');
const store = require('./engine/store');

let base;
let pid;
let other;
const POSTS = 40;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const datedBack = (id) => { projects.writeAll(projects.readAll().map((q) => (q.id === id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q))); return id; };
  pid = datedBack(projects.create({ name: 'Reacted Room' }).id);
  other = datedBack(projects.create({ name: 'Other Room' }).id);
  projects.addAgent(pid, 'gamma');   // a member, so gamma's 🙋 is a real claim the read must show
  // Every post carries reactions: a 👍 from two reactors, one of them later taken back, and on every third post the
  // person's own 🔥. Another room's post shares nothing with these. One millisecond apart, after the projects' date.
  const t0 = Date.parse('2024-01-01T00:00:00.000Z');
  const at = (i) => new Date(t0 + i).toISOString();
  const lines = [];
  let t = 0;
  for (let i = 1; i <= POSTS; i++) {
    const id = 'p7365-' + i;
    lines.push({ kind: 'post', id, project: pid, from: 'alpha', to: [], text: 'post ' + i, at: at(t++), outcomes: {} });
    lines.push({ kind: 'reaction', project: pid, of: id, at: at(t++), emoji: '👍', op: 'add', from: 'alpha' });
    lines.push({ kind: 'reaction', project: pid, of: id, at: at(t++), emoji: '👍', op: 'add', from: 'beta' });
    lines.push({ kind: 'reaction', project: pid, of: id, at: at(t++), emoji: '👍', op: 'remove', from: 'beta' });
    if (i % 3 === 0) lines.push({ kind: 'reaction', project: pid, of: id, at: at(t++), emoji: '🔥', op: 'add', operator: true });
    // A 🙋 claim (claim: true) on every fifth post, so the read also asks claimOf about it.
    if (i % 5 === 0) lines.push({ kind: 'reaction', project: pid, of: id, at: at(t++), emoji: '\u{1F64B}', op: 'add', from: 'gamma', claim: true });
  }
  lines.push({ kind: 'post', id: 'o7365-1', project: other, from: 'gamma', to: [], text: 'elsewhere', at: at(t++), outcomes: {} });
  lines.push({ kind: 'reaction', project: other, of: 'o7365-1', at: at(t++), emoji: '🎉', op: 'add', from: 'gamma' });
  // A reaction written from the OTHER room on one of this room's post ids: it counted before (reactions are keyed by
  // post id, not by room) and still must, so the grouping is not by project.
  lines.push({ kind: 'reaction', project: other, of: 'p7365-2', at: at(t++), emoji: '🎉', op: 'add', from: 'gamma' });
  fs.appendFileSync(path.join(store.ROOT, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#7365: each post\'s reactionsFor call is given only that post\'s reaction rows, and the pills are unchanged', async () => {
  const real = messages.reactionsFor;
  const realClaim = messages.claimOf;
  const calls = [];
  const claimCalls = [];
  messages.reactionsFor = (of, rows, you) => { calls.push({ of: String(of), rows }); return real(of, rows, you); };
  messages.claimOf = (of, rows, members) => { claimCalls.push({ of: String(of), rows }); return realClaim(of, rows, members); };
  let json;
  try {
    const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room`);
    assert.equal(res.status, 200);
    json = await res.json();
  } finally { messages.reactionsFor = real; messages.claimOf = realClaim; }
  const posts = json.rows.filter((r) => r.kind === 'post');
  assert.equal(posts.length, POSTS);
  assert.equal(calls.length, POSTS, 'one reactionsFor call per post');
  for (const c of calls) {
    assert.ok(c.rows.length >= 3 && c.rows.length <= 5, `post ${c.of} was given ${c.rows.length} rows, not its own 3 to 5`);
    assert.ok(c.rows.every((m) => m.kind === 'reaction' && String(m.of) === c.of), `post ${c.of} was given another row`);
  }
  // The same for claimOf, asked only about the posts carrying a 🙋 (every fifth).
  assert.equal(claimCalls.length, POSTS / 5, 'claimOf was asked about each post with a 🙋, and only those');
  for (const c of claimCalls) {
    assert.ok(c.rows.length <= 5 && c.rows.every((m) => m.kind === 'reaction' && String(m.of) === c.of), `claimOf for ${c.of} was given another row (${c.rows.length})`);
  }
  // CONTROL, the pills themselves: replayed against the WHOLE log, as before, they come out the same.
  const all = messages.record().rows;
  for (const p of posts) assert.deepEqual(p.reactions, real(p.id, all, 'you'), `post ${p.id}'s pills changed`);
  // Claims against the WHOLE log with the members the route uses: gamma is a member, so every fifth post is held.
  for (const c of claimCalls) assert.ok(c.rows.some((m) => m.claim === true), `claimOf for ${c.of} was not given the claim row`);
  const members = messages.claimMembers((projects.readAll().find((q) => q.id === pid) || {}).agents);
  for (const p of posts) {
    const want = realClaim(p.id, all, members);
    assert.equal(p.claim ? p.claim.by : null, want ? want.by : null, `post ${p.id}'s claim changed`);
  }
  assert.equal(posts.filter((p) => p.claim && p.claim.by === 'gamma').length, POSTS / 5, 'gamma holds every fifth post');
  const second = posts.find((p) => p.id === 'p7365-2');
  assert.ok(second.reactions.some((r) => r.emoji === '🎉' && r.who.includes('gamma')), 'the other room\'s reaction on a shared post id still counts');
  const third = posts.find((p) => p.id === 'p7365-3');
  assert.deepEqual(third.reactions, [{ emoji: '👍', count: 1, who: ['alpha'], mine: false }, { emoji: '🔥', count: 1, who: ['you'], mine: true }]);
  const first = posts.find((p) => p.id === 'p7365-1');
  assert.deepEqual(first.reactions, [{ emoji: '👍', count: 1, who: ['alpha'], mine: false }], 'beta took theirs back; no 🔥 on post 1');
});
