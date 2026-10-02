'use strict';
/**
 * kosmos#5062 part 3: tools/kosmos-bugs-triage.js, the daily read of the community's Kosmos bugs channel. A fake site
 * and a fake `gh` stand in for the network; every gh call is recorded, so a card's title and body are checked as filed.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const triageTool = require('./tools/kosmos-bugs-triage');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-bugs-triage-'));

const post = (id, title, body, name, extra = {}) => ({ id, channel: 'engineering', sub_channel: 'kosmos-bugs', title, body,
  created_at: '2026-10-02T21:00:00Z', agent: { name, role: 'Sales Development Representative', avatar: null }, ...extra });

/* A fake site that pages its posts two at a time, as the real feed pages them. */
function site(posts) {
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    const u = new URL(url);
    const start = Number(u.searchParams.get('cursor') || 0);
    const page = posts.slice(start, start + 2);
    return { ok: true, status: 200, json: async () => ({ posts: page, next_cursor: start + 2 < posts.length ? String(start + 2) : null }) };
  };
  return { fetchFn, asked };
}

/* A fake gh: search answers from `known` (title words), create numbers cards from 9000, view answers `states`. */
function fakeGh({ known = [], states = {} } = {}) {
  const calls = []; let next = 9000;
  const gh = (args) => {
    const bodyFile = args[args.indexOf('--body-file') + 1];
    calls.push({ args, body: args.includes('--body-file') ? fs.readFileSync(bodyFile, 'utf8') : null });
    if (args[0] === 'search') {
      const q = args[args.length - 1].split(' ');
      return { status: 0, stdout: JSON.stringify(known.filter((k) => q.some((w) => k.title.toLowerCase().includes(w)))), stderr: '' };
    }
    if (args[0] === 'issue' && args[1] === 'create') { next += 1; return { status: 0, stdout: `https://github.com/joshualeestone/kosmos/issues/${next}\n`, stderr: '' }; }
    if (args[0] === 'issue' && args[1] === 'view') return { status: 0, stdout: JSON.stringify({ state: states[args[2]] || 'OPEN' }), stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected ' + args.join(' ') };
  };
  return { gh, calls, created: () => calls.filter((c) => c.args[0] === 'issue' && c.args[1] === 'create') };
}

const opts = (name, extra) => ({ state: path.join(DIR, name + '.json'), digest: path.join(DIR, name + '.md'), tmpDir: DIR, ...extra });

test('#5062: a new report with no matching card is filed, and the card never names an agent or links the post', async () => {
  const s = site([post('p1', 'Board shows idle while the account is capped', 'I asked Sekar for a status and the board said idle; Theo saw it too. Kosmos 0.7.18.', 'Sekar'),
    post('p2', 'Composer loses the draft on reload', 'Typed a reply, reloaded, the draft was gone.', 'Theo Nguyen')]);
  const g = fakeGh();
  const r = await triageTool.triage(opts('a', { file: true, fetchFn: s.fetchFn, gh: g.gh }));
  assert.equal(r.reports, 2);
  assert.equal(g.created().length, 2, 'two unmatched reports, two cards');
  for (const c of g.created()) {
    const text = c.args[c.args.indexOf('--title') + 1] + '\n' + c.body;
    assert.doesNotMatch(text, /Sekar|Theo|Nguyen|Sales Development/i, 'a card named an agent: ' + text);
    assert.doesNotMatch(text, /kosmosplus\.com|installkosmos\.com|\/posts\//, 'a card links the post (its page shows the author)');
  }
  assert.match(g.created()[0].body, /I asked an agent for a status/, 'the report text did not survive the scrub');
  assert.match(fs.readFileSync(path.join(DIR, 'a.md'), 'utf8'), /## Filed \(no matching card\): 2/);
  // The site was read through the channel filter, every page.
  assert.ok(s.asked.every((u) => new URL(u).searchParams.get('channel') === 'kosmos-bugs'));
});

test('#5062: reports with the same bug in their titles become ONE card', async () => {
  const s = site([post('q1', 'Board shows idle while capped', 'one', 'Ana'), post('q2', 'Capped account board idle', 'two', 'Bo'),
    post('q3', 'Terminal font too small', 'three', 'Cy')]);
  const g = fakeGh();
  await triageTool.triage(opts('b', { file: true, fetchFn: s.fetchFn, gh: g.gh }));
  assert.equal(g.created().length, 2, 'the two capped-board reports were not grouped');
  assert.match(g.created()[0].body, /Report 1:[\s\S]*Report 2:/);
});

test('#5062: a report that may match an existing card is listed to decide, never filed', async () => {
  const s = site([post('r1', 'Board shows idle while capped', 'x', 'Ana')]);
  const g = fakeGh({ known: [{ number: 5029, title: 'Kosmos Guide goes silent when its Claude account is capped', state: 'CLOSED' }] });
  const r = await triageTool.triage(opts('c', { file: true, fetchFn: s.fetchFn, gh: g.gh }));
  assert.equal(g.created().length, 0, 'a possible duplicate was filed');
  assert.equal(r.toDecide.length, 1);
  assert.match(r.digest, /maybe: #5029 \[CLOSED\]/);
});

test('#5062: a second run files nothing again, and a closed card is listed as reply due', async () => {
  const s = site([post('s1', 'Board shows idle while capped', 'x', 'Ana')]);
  const g1 = fakeGh();
  await triageTool.triage(opts('d', { file: true, fetchFn: s.fetchFn, gh: g1.gh }));
  assert.equal(g1.created().length, 1);
  const g2 = fakeGh({ states: { 9001: 'CLOSED' } });
  const r = await triageTool.triage(opts('d', { file: true, fetchFn: s.fetchFn, gh: g2.gh }));
  assert.equal(g2.created().length, 0, 'the same report was filed twice');
  assert.equal(r.fresh, 0);
  assert.deepEqual(r.replyDue, [{ postId: 's1', card: 9001 }]);
});

test('#5062: without --file it files nothing and remembers nothing; a site error fails loudly', async () => {
  const s = site([post('t1', 'Board shows idle while capped', 'x', 'Ana')]);
  const g = fakeGh();
  const r = await triageTool.triage(opts('e', { fetchFn: s.fetchFn, gh: g.gh }));
  assert.equal(g.created().length, 0);
  assert.equal(r.filed.length, 1, 'the dry run did not say what it would file');
  assert.equal(fs.existsSync(path.join(DIR, 'e.json')), false, 'a dry run wrote state');
  assert.match(r.digest, /dry run/);
  await assert.rejects(triageTool.triage(opts('f', { fetchFn: async () => ({ ok: false, status: 503 }), gh: g.gh })), /answered 503/);
});

test('#5062: the scrub replaces whole names only, case-insensitively, and leaves other words alone', () => {
  assert.equal(triageTool.scrub("Ana said ana's board froze; banana stays", ['Ana']), "an agent said an agent's board froze; banana stays");
});
