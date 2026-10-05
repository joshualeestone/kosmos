'use strict';

/**
 * #5319: `kosmos task add` with the same ask as an OPEN task still adds it (no silent dedup), and the board's answer
 * names the open look-alikes so the adder can close one. Seen on 0.7.22: one ask added as #1 and #11, another as #26,
 * #27 and #29.
 *
 * Pure rows on tasks.similarOpen, then the real route on a sandboxed board with a real project record, then both CLIs
 * run on a real answer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5319-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const P = {
  tasks: [
    { number: 1, sentence: 'Verify Theo AI and Enzo Health', closedAt: null },
    { number: 26, sentence: 'Deep dive: Worlds', closedAt: null },
    { number: 5, sentence: 'Write release notes', closedAt: null },
    { number: 7, sentence: 'Deep dive: Worlds', closedAt: '2026-10-01T00:00:00Z' },
    { number: 8, sentence: 'Fix the login bug', closedAt: null },
    { number: 9, sentence: 'Release 0.7.22', closedAt: null },
    { number: 10, sentence: 'Fix it', closedAt: null },
    { number: 11, sentence: 'Do not enable dark mode on login', closedAt: null },
    { number: 40, sentence: 'Deep dive: Worlds', closedAt: null },
    { number: 12, sentence: 'Ship the "beta" \\ build', closedAt: null },
  ],
};

test('#5319: which open tasks count as the same (pure)', () => {
  const rows = [
    ['verify Theo AI and Enzo Health', [1], 'the same text, other case (the report\'s #1 and #11)'],
    ['deep  dive: WORLDS ', [26], 'the same text, other case and spacing (the report\'s #26, #27, #29); the closed #7 is not named'],
    ['Deep dive - Worlds', [], 'other punctuation is other text (review 4: punctuation can carry meaning)'],
    ['deep dive worlds again', [], 'one word more is not the same text (a miss costs only today\'s behaviour)'],
    ['write the release notes for 0.7.23', [], 'more words is not the same text'],
    ['Fix the signup bug', [], 'another word'],
    ['Release 0.7.23', [], 'another version'],
    ['Fix this', [], 'another word, even a short one'],
    ['Enable dark mode on login', [], 'without the negation'],
    ['', [], 'no words'],
  ];
  for (const [sentence, want, why] of rows) {
    assert.deepEqual(tasks.similarOpen(P, sentence, 31).map((t) => t.number), want, `${JSON.stringify(sentence)}: ${why}`);
  }
  assert.deepEqual(tasks.similarOpen(P, 'Verify Theo AI and Enzo Health', 1), [], 'a task is never the same as itself');
  // Review round 1: two agents add the same ask at once (#40 and #41): only the OLDER copy is named, so never both close.
  assert.deepEqual(tasks.similarOpen(P, 'Deep dive: Worlds', 41).map((t) => t.number), [26, 40], 'the newest copy names the older ones');
  assert.deepEqual(tasks.similarOpen(P, 'Deep dive: Worlds', 40).map((t) => t.number), [26], 'the older copy never names the newer one');
  assert.deepEqual(tasks.similarOpen(P, 'Deep dive: Worlds', 41, { parent: 26 }).map((t) => t.number), [40], 'a subtask never names its own parent');
  // Review rounds 1 to 3: different asks a fuzzy rule matched; each judged against ONE open task.
  const pair = (open, added) => tasks.similarOpen({ tasks: [{ number: 1, sentence: open, closedAt: null }] }, added, 9).length > 0;
  for (const [open, added, want, why] of [
    ['Email Alice about the contract renewal terms and pricing', 'Email Bob about the contract renewal terms and pricing', false, 'another person'],
    ['Ask Josh to approve the Ingram MSA draft today', 'Ask Josh to reject the Ingram MSA draft today', false, 'the opposite verb'],
    ['Do not enable dark mode on login', 'Enable dark mode on login', false, 'a negation'],
    ['Book flight from Dallas to Austin', 'Book flight from Austin to Dallas', false, 'swapped places'],
    ['Add user Alice', 'Add user Alice Smith Jones', false, 'more of a name'],
    ['Add v2 login page', 'Add v3 login page', false, 'another version'],
    ['Deploy', 'Deploy', true, 'the very same one-word task'],
    ['修复登录错误', '修复登录错误', true, 'the very same Chinese task (no spaces)'],
    ['Café menu', 'Café menu', true, 'the same text, another Unicode form (NFKC)'],
    ['Ｆｉｘ login bug', 'Fix login bug', true, 'full-width letters are the same text'],
    // Review 4: signs and symbols carry meaning.
    ['Set offset to -5', 'Set offset to 5', false, 'a sign'],
    ['Ship if x > 5', 'Ship if x < 5', false, 'a comparison'],
    ['Support C++', 'Support C', false, 'a symbol in a name'],
    ['Say \u2705', 'Say \u274c', false, 'a check mark is not a cross'],
    ['Pay $5', 'Pay \u20ac5', false, 'another currency'],
  ]) assert.equal(pair(open, added), want, `${open} | ${added}: ${why}`);
  const many = { tasks: [2, 3, 4, 5].map((n) => ({ number: n, sentence: 'deep dive worlds', closedAt: null })) };
  assert.deepEqual(tasks.similarOpen(many, 'deep dive worlds', 99).map((t) => t.number), [2, 3, 4], 'at most three, oldest first');
});

function seed() {
  const folder = fs.mkdtempSync(path.join(SANDBOX, 'pf-'));
  projects.writeAll([{ id: 'p5319', name: 'Research', folder, agents: [], taskCounter: 30, tasks: P.tasks.map((t) => ({ ...t, who: null })) }]);
}

async function add(sentence) {
  const res = await fetch(base + '/api/project/p5319/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentence }) });
  return { code: res.status, json: await res.json() };
}

test('#5319: the route adds a look-alike task and names the open one, with the close command', async () => {
  seed();
  const r = await add('verify theo ai and enzo health');
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.equal(r.json.task.number, 31, 'the task is ADDED as asked (no silent dedup)');
  assert.equal(r.json.note, 'Note: an open task with the same text already exists: #1 (Verify Theo AI and Enzo Health). '
    + 'If this is the same ask, close the new one: kosmos task close p5319 31');
  const stored = projects.readAll().find((x) => x.id === 'p5319');
  assert.ok(stored.tasks.some((t) => t.number === 31), 'and it is stored');

  const other = await add('Update the onboarding copy');
  assert.equal(other.code, 200);
  assert.equal(other.json.note, undefined, 'CONTROL: a task like no other gets no note');

  // The open task's stored text has a double quote and a backslash; the note must carry neither (the macOS CLI's sed).
  const quoted = await add('SHIP the "beta" \\ build');
  assert.match(quoted.json.note || '', /^Note: an open task with the same text already exists: #12 \(Ship the beta build\)\./, quoted.json.note);
  assert.doesNotMatch(quoted.json.note, /["\\]/, 'the note holds no double quote or backslash');
});

test('#5319: the macOS CLI prints the note from a real answer, and nothing without one', () => {
  const mac = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
  const i = mac.indexOf('added to ${project:-the project}');
  assert.ok(i > 0, 'the macOS CLI still says the task was added');
  const after = mac.slice(i, i + 700);
  const lift = (after.match(/^\s*local _note; (_note=\$\(printf '%s' "\$body" \| sed -n .*\))$/m) || [])[1];
  assert.ok(lift, 'the macOS CLI lifts the note with one sed line after the added sentence');
  assert.match(after, /if \[ -n "\$_note" \]; then say "\$_note"; fi ;;/);
  const note = 'Note: an open task with the same text already exists: #1 (Verify Theo AI). If this is the same ask, close the new one: kosmos task close p 31';
  const run = (body) => execFileSync('/bin/bash', ['-c', lift + '; printf %s "$_note"'], { env: { body, PATH: process.env.PATH } }).toString();
  assert.equal(run(JSON.stringify({ task: { number: 31, sentence: 'he said "note":"x"' }, told: null, heard: null, note })), note,
    'the board\'s note comes out, even past a sentence that spells "note":"');
  assert.equal(run(JSON.stringify({ task: { number: 31 }, told: null, heard: null })), '', 'CONTROL: no note, nothing');
});

test('#5319: the Windows CLI prints the note after the added sentence (run, not read)', async () => {
  const cli = require('./tools/windows/kosmos-cli');
  const realHook = require('./engine/kosmos-report-hook');
  const hook = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARD5319', agentToken: realHook.agentToken };
  const go = async (answer) => {
    const out = []; const err = [];
    const code = await cli.main(['task', 'add', 'p5319', 'verify theo ai'], {
      env: { KOSMOS_AGENT_TOKEN: 'ef'.repeat(16) }, hook,
      out: (x) => out.push(x), err: (x) => err.push(x),
      fetch: async () => ({ status: 200, text: async () => JSON.stringify(answer) }),
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const note = 'Note: an open task with the same text already exists: #1 (Verify Theo AI). If this is the same ask, close the new one: kosmos task close p5319 31';
  const withNote = await go({ task: { number: 31, who: null }, note });
  assert.equal(withNote.code, 0, withNote.err);
  assert.equal(withNote.out, 'Task 31 added to p5319. See it with: kosmos task list p5319\n' + note);
  const without = await go({ task: { number: 31, who: null } });
  assert.equal(without.out, 'Task 31 added to p5319. See it with: kosmos task list p5319', 'CONTROL: no note, one line');
});
