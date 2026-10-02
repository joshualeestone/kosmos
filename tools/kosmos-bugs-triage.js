#!/usr/bin/env node
'use strict';
/**
 * kosmos#5062 part 3: the daily read of the community's Kosmos bugs channel.
 *
 *   node tools/kosmos-bugs-triage.js [--file] [--base <site>] [--state <file>] [--digest <file>] [--repo <owner/name>]
 *
 * Without --file it only reads and writes the digest (a dry run). With --file it also files cards.
 *
 * What it does, in order:
 *   1. READS the public site's kosmos-bugs channel (GET /api/posts/feed?channel=kosmos-bugs), read-only and with no
 *      credentials. Not `kosmos community read`: that needs an agent's token, and a scheduled script is not an agent.
 *   2. GROUPS the reports it has not seen before by their titles (shared significant words).
 *   3. SEARCHES existing cards for each group (open and closed).
 *   4. FILES a card only for a group with NO matching card, and only with --file. A group that matches a card is
 *      listed for the triager: "same bug or not" is judgement, never decided here.
 *   5. REMEMBERS which posts became which card (the state file), so nothing is filed twice; a filed card that has
 *      since closed is listed as "reply due", so the agent hears back on its post.
 *   6. Writes a digest the triager reads.
 *
 * 🛑 A CARD NEVER NAMES A USER OR AN AGENT. The author's name is never written; it is also replaced in the quoted
 * report text wherever it appears (with every other reporting agent's name, since one report can mention another).
 * No link to the post either: the post's page shows its author. The post ids stay in the state file on this box,
 * which is what the "reply due" step needs.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULTS = Object.freeze({
  base: 'https://community.kosmosplus.com',
  repo: 'joshualeestone/kosmos',
  state: path.join(os.homedir(), '.local', 'state', 'kosmos-bugs-triage', 'state.json'),
  channel: 'kosmos-bugs',
  maxPages: 10,
});

/* Words that say nothing about WHICH bug it is. Grouping on them would put every report in one group. */
const STOP = new Set(['the', 'and', 'for', 'with', 'when', 'that', 'this', 'from', 'not', 'but', 'are', 'was', 'its',
  'kosmos', 'bug', 'bugs', 'does', 'did', 'doesnt', 'didnt', 'into', 'after', 'before', 'while', 'then', 'than', 'have',
  'has', 'had', 'what', 'which', 'your', 'you', 'can', 'cannot', 'cant', 'wont', 'will', 'should', 'shows', 'show',
  'says', 'said', 'still', 'only', 'just', 'out', 'any', 'all', 'one', 'two', 'get', 'got', 'gets']);

function words(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w));
}

/* Two titles describe the same bug when at least half of the shorter one's significant words are in the other. */
function similar(a, b) {
  const A = new Set(words(a)); const B = new Set(words(b));
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / Math.min(A.size, B.size) >= 0.5;
}

function groupReports(posts) {
  const groups = [];
  for (const p of posts) {
    const g = groups.find((x) => similar(x.posts[0].title, p.title));
    if (g) g.posts.push(p); else groups.push({ posts: [p] });
  }
  return groups;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* Every name is replaced as a whole word, case-insensitively, so "Sekar" and "sekar's" both go. */
function scrub(text, names) {
  let t = String(text == null ? '' : text);
  for (const n of names) {
    const name = String(n || '').trim();
    if (name.length < 2) continue;
    t = t.replace(new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRe(name) + '(?=$|[^\\p{L}\\p{N}])', 'giu'), '$1an agent');
  }
  return t;
}

/* Every author's full name AND each part of it of three letters or more ("Theo Nguyen" -> also "Theo", "Nguyen"), since a
   report often calls another agent by first name. Longest first, so a full name goes before its parts. A part that is
   also an ordinary word gets replaced too: an odd sentence in a card is the right price for never naming anyone. */
function authorNames(posts) {
  const names = new Set();
  for (const p of posts) {
    if (!p || !p.agent || typeof p.agent.name !== 'string') continue;
    names.add(p.agent.name);
    for (const part of p.agent.name.split(/[\s._-]+/)) if (part.length >= 3) names.add(part);
  }
  return [...names].sort((a, b) => b.length - a.length);
}

/* The card for one group: the first report's title, every report's text, never an author or a link. */
function cardFor(group, names) {
  const first = group.posts[0];
  const title = ('Community report: ' + scrub(first.title, names)).slice(0, 120);
  const lines = [
    `Reported on the Kosmos community's Kosmos bugs channel ${group.posts.length === 1 ? 'by an agent' : 'by ' + group.posts.length + ' reports'}`
      + ` (${group.posts.map((p) => String(p.created_at || '').slice(0, 10)).filter(Boolean).join(', ')}). Filed by the daily triage read (kosmos#5062);`
      + ' the reporting agents are never named here.',
    '',
  ];
  group.posts.forEach((p, i) => {
    if (group.posts.length > 1) lines.push(`**Report ${i + 1}:** ${scrub(p.title, names)}`, '');
    for (const l of scrub(p.body, names).split('\n')) lines.push('> ' + l);
    lines.push('');
  });
  lines.push('A triager replies on the post when this card is fixed.');
  return { title, body: lines.join('\n') };
}

/* Read every report the site has in the channel, newest first, up to maxPages pages. */
async function fetchReports({ base, channel, maxPages, fetchFn }) {
  const out = []; let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const u = new URL('/api/posts/feed', base);
    u.searchParams.set('channel', channel); u.searchParams.set('limit', '50');
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetchFn(u.toString());
    if (!r.ok) throw new Error(`the site answered ${r.status} for ${u.pathname}`);
    const j = await r.json();
    if (!j || !Array.isArray(j.posts)) throw new Error('the site answered a feed with no posts list');
    out.push(...j.posts.filter((p) => p && (p.sub_channel === channel || p.channel === channel)));
    if (!j.next_cursor) break;
    cursor = j.next_cursor;
  }
  return out;
}

function ghRun(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/* Existing cards that might be this bug: a search on the title's significant words, open and closed. */
function searchCards(title, { repo, gh }) {
  const q = words(title).slice(0, 4).join(' ');
  if (!q) return [];
  const r = gh(['search', 'issues', '--repo', repo, '--json', 'number,title,state', '--limit', '5', '--', q]);
  if (r.status !== 0) throw new Error('gh search failed: ' + r.stderr.trim());
  return JSON.parse(r.stdout || '[]');
}

function fileCard(card, { repo, gh, tmpDir }) {
  const f = path.join(tmpDir, 'card-' + process.pid + '-' + Date.now() + '.md');
  fs.writeFileSync(f, card.body, { mode: 0o600 });
  try {
    const r = gh(['issue', 'create', '--repo', repo, '--title', card.title, '--body-file', f]);
    if (r.status !== 0) throw new Error('gh issue create failed: ' + r.stderr.trim());
    const m = /\/issues\/(\d+)\s*$/.exec(r.stdout.trim());
    if (!m) throw new Error('gh issue create printed no card url: ' + r.stdout.trim());
    return Number(m[1]);
  } finally { try { fs.unlinkSync(f); } catch { /* best effort */ } }
}

function cardState(number, { repo, gh }) {
  const r = gh(['issue', 'view', String(number), '--repo', repo, '--json', 'state']);
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout).state || null; } catch { return null; }
}

function loadState(file) {
  try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return { seen: s.seen || {}, replied: s.replied || {} }; } catch { return { seen: {}, replied: {} }; }
}
function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/* One run. Returns the digest text; `file` decides whether cards are filed. */
async function triage(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const fetchFn = o.fetchFn || fetch;
  const gh = o.gh || ghRun;
  const tmpDir = o.tmpDir || os.tmpdir();
  const state = loadState(o.state);
  const reports = await fetchReports({ base: o.base, channel: o.channel, maxPages: o.maxPages, fetchFn });
  const names = authorNames(reports);
  const fresh = reports.filter((p) => !(p.id in state.seen));
  const groups = groupReports(fresh);
  const filed = []; const toDecide = [];
  for (const g of groups) {
    const candidates = searchCards(g.posts[0].title, { repo: o.repo, gh });
    const card = cardFor(g, names);
    if (candidates.length) {
      toDecide.push({ card, candidates, count: g.posts.length });
      for (const p of g.posts) state.seen[p.id] = { card: null, decide: true, at: new Date().toISOString() };
      continue;
    }
    if (!o.file) { filed.push({ card, number: null, count: g.posts.length }); continue; }
    const number = fileCard(card, { repo: o.repo, gh, tmpDir });
    filed.push({ card, number, count: g.posts.length });
    for (const p of g.posts) state.seen[p.id] = { card: number, at: new Date().toISOString() };
  }
  /* A filed card that has closed: the agent should hear back on its post. Listed once, then remembered as due. */
  const replyDue = [];
  for (const [postId, s] of Object.entries(state.seen)) {
    if (!s.card || state.replied[postId]) continue;
    if (cardState(s.card, { repo: o.repo, gh }) === 'CLOSED') replyDue.push({ postId, card: s.card });
  }
  if (o.file) saveState(o.state, state);
  const lines = [`# Kosmos bugs triage, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${o.file ? '' : ' (dry run: nothing filed, nothing remembered)'}`, '',
    `Reports in the channel: ${reports.length}; new since the last run: ${fresh.length}, in ${groups.length} group(s).`, ''];
  lines.push(`## Filed (no matching card)${o.file ? '' : ': would file'}: ${filed.length}`);
  for (const f of filed) lines.push(`- ${f.number ? '#' + f.number + ' ' : ''}${f.card.title} (${f.count} report${f.count === 1 ? '' : 's'})`);
  lines.push('', `## To decide (an existing card may be this bug): ${toDecide.length}`);
  for (const d of toDecide) lines.push(`- ${d.card.title} (${d.count} report${d.count === 1 ? '' : 's'}); maybe: ${d.candidates.map((c) => '#' + c.number + ' [' + c.state + '] ' + c.title).join('; ')}`);
  lines.push('', `## Reply due (its card is closed; reply on the post as an agent, then record it): ${replyDue.length}`);
  for (const r of replyDue) lines.push(`- post ${r.postId}: card #${r.card} closed`);
  const digest = lines.join('\n') + '\n';
  if (o.digest) { fs.mkdirSync(path.dirname(o.digest), { recursive: true }); fs.writeFileSync(o.digest, digest); }
  return { digest, filed, toDecide, replyDue, reports: reports.length, fresh: fresh.length };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file') o.file = true;
    else if (['--base', '--state', '--digest', '--repo'].includes(a) && argv[i + 1]) { o[a.slice(2)] = argv[i + 1]; i += 1; }
    else throw new Error('usage: kosmos-bugs-triage.js [--file] [--base <site>] [--state <file>] [--digest <file>] [--repo <owner/name>]');
  }
  return o;
}

if (require.main === module) {
  triage(parseArgs(process.argv.slice(2)))
    .then((r) => { process.stdout.write(r.digest); })
    .catch((e) => { process.stderr.write('kosmos-bugs-triage: ' + (e && e.message ? e.message : e) + '\n'); process.exit(1); });
}

module.exports = { triage, groupReports, similar, scrub, cardFor, words, parseArgs, DEFAULTS };
