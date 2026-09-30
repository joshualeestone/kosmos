#!/usr/bin/env node
'use strict';
/**
 * feedback-digest.js -- kosmos#4415 slice 2b: the DAILY feedback digest, callable by an agent (Echo) or a launchd job.
 *
 *   node tools/feedback-digest.js --dry-run        print the digest; read the watermark, write NO state
 *   node tools/feedback-digest.js                  print the digest, and also write it to <state>/digest.txt with
 *                                                  the watermark it would advance to in <state>/pending
 *   node tools/feedback-digest.js --mark-posted    the digest reached #admin: move <state>/pending to last-seen
 *   options: --state <dir> (default ~/.cache/kosmos-feedback-digest-4415)  --cards-file <file> (instead of gh)
 *
 * EXIT CODES (for an agent): 0 = a digest is on stdout (including the one-line "no new reports");
 *   2 = the reports could NOT be read: stdout still carries a digest whose first words say so, the reason is on
 *   stderr, and no state moves;  1 = a usage or internal error (stderr only).
 *
 * A THIN WRAPPER over the two engine pieces the `kosmos feedback pull` and `kosmos feedback triage` verbs run:
 * engine/feedbackpull.pull (the store's own read token, secrets-map target vercel-blob-feedback; least access, the
 * admin token is never used here) into a private temp dir (mode 700, removed after), then engine/feedback-triage
 * (freshSince + triage). It opens no card, changes no report and posts nowhere (#2246: a person decides).
 *
 * THE WINDOW is (last-seen, run start], on each report's generated_at, via feedback-triage.freshSince: second
 * granularity, so a report is in exactly one digest. The CLI's `--since YYYY-MM-DD` is inclusive by DAY and would
 * repeat the last run's day every morning (see .claude/plans/triagedaily-4415.md). First run: the last 24 hours.
 * Weakest premise, inherited: generated_at is written by the install, so a report written before the last digest
 * and delivered after it is only in the /admin inbox.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ENGINE = path.join(__dirname, '..', 'engine');
const ADMIN_URL = 'https://installkosmos.com/admin';
const CARD_LIMIT = 2000;       // a card list AS LONG AS this is a ceiling, not a total
const MAX_CHARS = 1900;        // one Discord message
const TOP = 5;
/* Crash or data loss: listed first. Over-matching is the safe side here (it only reorders), so it is broad. */
const CRASH = /\b(?:crash(?:es|ed|ing)?|froze|freez(?:es|ing)|hangs?|hung|data loss|lost (?:my|all|the|every|our)|wiped|erased|deleted (?:my|all|every|our)|disappeared|vanished|corrupt(?:ed|ion)?|(?:wont|won't|will not|does not|doesnt|doesn't) (?:start|open|launch))\b/i;

function defaultStateDir() { return path.join(os.homedir(), '.cache', 'kosmos-feedback-digest-4415'); }

/** Open card lines "#123 title" (the format tools/feedback-digest-daily.sh feeds the engine), or null. */
function readCards({ execFileImpl = execFile, cardsFile } = {}) {
  if (cardsFile) { try { return Promise.resolve(fs.readFileSync(cardsFile, 'utf8')); } catch { return Promise.resolve(null); } }
  return new Promise((resolve) => {
    execFileImpl('gh', ['issue', 'list', '--repo', 'joshualeestone/kosmos', '--state', 'open', '--limit', String(CARD_LIMIT),
      '--json', 'number,title', '-q', '.[]|"#\\(.number) \\(.title)"'], { timeout: 120000, maxBuffer: 32 * 1024 * 1024 },
    (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

function whenCt(sec) {
  const d = new Date(sec * 1000);
  if (!Number.isFinite(d.getTime())) return 'the start';
  return d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
}

/** One quoted line: inline code (a report is anyone's words, never the bot's), backticks swapped, short. */
function quote(text) { return '`' + String(text).replace(/\s+/g, ' ').replace(/`/g, "'").slice(0, 150) + '`'; }
function installs(n) { return n === 1 ? '1 install' : n + ' installs'; }

/**
 * The phone-sized digest. Pure.
 *   pulled: { ok, because?, unreadable? }   fresh: the new reports   triaged: engine triage() over them
 */
function renderDigest({ pulled, sinceSec, fresh, triaged, cardsOk, cardsCapped, adminUrl = ADMIN_URL }) {
  const inbox = 'Inbox: ' + adminUrl + ' (Reports).';
  if (!pulled.ok) {
    return 'Kosmos feedback: COULD NOT READ THE REPORTS (' + String(pulled.because || 'no reason given').slice(0, 300)
      + '). This is not a quiet day; the next good run covers everything since ' + whenCt(sinceSec) + '. ' + inbox;
  }
  const n = fresh.length;
  if (n === 0) return 'Kosmos feedback: no new reports since ' + whenCt(sinceSec) + '. ' + inbox;
  const lines = ['Kosmos feedback: ' + n + ' new report' + (n === 1 ? '' : 's') + ' since ' + whenCt(sinceSec)
    + (pulled.unreadable ? ' (' + pulled.unreadable + ' in the store could not be read)' : '') + '.'];
  const all = triaged.candidates.map((c) => ({ ...c, card: null }))
    .concat(triaged.duplicatesOfOpenCards.map((c) => ({ ...c, card: c.matchesCard.title })));
  const crash = all.filter((c) => CRASH.test(c.text)).sort((a, b) => b.installs - a.installs);
  if (crash.length) {
    lines.push('Crash or data loss:');
    for (const c of crash.slice(0, TOP)) lines.push('- ' + quote(c.text) + ' (' + installs(c.installs) + ')' + (c.card ? ' ~ ' + c.card.slice(0, 60) : ''));
  }
  const rest = triaged.candidates.filter((c) => !CRASH.test(c.text)).sort((a, b) => (b.installs - a.installs) || 0);
  if (rest.length) {
    lines.push('To review (' + Math.min(rest.length, TOP) + ' of ' + rest.length + '):');
    for (const c of rest.slice(0, TOP)) lines.push('- ' + quote(c.text) + ' (' + installs(c.installs) + ')');
  }
  const carded = triaged.duplicatesOfOpenCards.filter((c) => !CRASH.test(c.text));
  if (carded.length) {
    lines.push('Maybe already carded (' + carded.length + '):');
    for (const c of carded.slice(0, 3)) lines.push('- ' + c.matchesCard.title.slice(0, 70) + ' (' + installs(c.installs) + ')');
  }
  if (!crash.length && !rest.length && !carded.length) lines.push('Nothing above the bar: ' + triaged.noise.length + ' lines read as praise, context or clean runs.');
  if (!cardsOk) lines.push('(Open cards could not be read, so nothing was checked against them.)');
  else if (cardsCapped) lines.push('(The open card list hit its ' + CARD_LIMIT + ' limit, so the card check is partial.)');
  lines.push(inbox + ' No card was opened.');
  let out = lines.join('\n');
  if (out.length > MAX_CHARS) out = out.slice(0, MAX_CHARS - 60).replace(/\n[^\n]*$/, '') + '\n...\n' + inbox;
  return out;
}

function readState(dir, name) { try { return fs.readFileSync(path.join(dir, name), 'utf8').trim(); } catch { return ''; } }
function writeState(dir, name, value) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const tmp = path.join(dir, name + '.tmp');
  fs.writeFileSync(tmp, value + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);   // the mode above is umask-filtered; the rename keeps the temp's mode
  fs.renameSync(tmp, path.join(dir, name));
}

/**
 * The whole run. Returns { code, out, err }. Every outside effect comes through `deps` so tests reach every arm:
 *   pull(dir) -> feedbackpull.pull's answer   execFileImpl (gh)   now() -> Date   tmpRoot
 */
async function main(argv, deps = {}) {
  const args = argv.slice();
  const flag = (f) => { const i = args.indexOf(f); if (i === -1) return false; args.splice(i, 1); return true; };
  const opt = (f) => { const i = args.indexOf(f); if (i === -1) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const dry = flag('--dry-run');
  const markPosted = flag('--mark-posted');
  const stateDir = opt('--state') || deps.stateDir || defaultStateDir();
  const cardsFile = opt('--cards-file');
  if (args.length) return { code: 1, out: '', err: 'feedback-digest: unknown argument: ' + args[0] };

  if (markPosted) {
    const pending = readState(stateDir, 'pending');
    if (!/^\d+$/.test(pending)) return { code: 1, out: '', err: 'feedback-digest: nothing pending to mark posted' };
    writeState(stateDir, 'last-seen', pending);
    try { fs.unlinkSync(path.join(stateDir, 'pending')); } catch { /* already gone */ }
    return { code: 0, out: 'feedback-digest: marked posted through ' + whenCt(Number(pending)), err: '' };
  }

  const nowSec = Math.floor((deps.now ? deps.now() : new Date()).getTime() / 1000);
  /* One second back, as the daily .sh does: stamps are whole seconds, and the window is (since, runStart]. */
  const runStart = nowSec - 1;
  let sinceSec = Number(readState(stateDir, 'last-seen'));
  if (!Number.isFinite(sinceSec) || sinceSec <= 0 || sinceSec > runStart) sinceSec = nowSec - 86400;

  const pullFn = deps.pull || ((dir) => require(path.join(ENGINE, 'feedbackpull')).pull(dir));
  const tmp = fs.mkdtempSync(path.join(deps.tmpRoot || os.tmpdir(), 'kfd-'));
  let pulled;
  let files = [];
  try {
    fs.chmodSync(tmp, 0o700);
    const dir = path.join(tmp, 'pulled');
    try { pulled = await pullFn(dir); } catch (e) { pulled = { ok: false, because: 'the pull threw: ' + String((e && e.message) || e) }; }
    if (!pulled || pulled.ok !== true) pulled = { ok: false, because: (pulled && pulled.because) || 'the pull gave no answer' };
    if (pulled.ok) {
      let names = [];
      try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { names = []; }
      files = names.sort().map((name) => ({ name, body: fs.readFileSync(path.join(dir, name), 'utf8') }));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const t = require(path.join(ENGINE, 'feedback-triage'));
  const fresh = [];
  for (const f of files) {
    const got = t.freshSince([f], sinceSec, runStart);
    if (got.length) {
      const m = /(?:^|\n)install:\s*(\S+)/.exec(f.body);
      fresh.push({ ...got[0], install: m ? m[1] : null });
    }
  }
  let triaged = { candidates: [], duplicatesOfOpenCards: [], noise: [] };
  let cardsOk = true;
  let cardsCapped = false;
  if (fresh.length) {
    const cards = await readCards({ execFileImpl: deps.execFileImpl, cardsFile });
    cardsOk = cards != null;
    const cardLines = String(cards || '').split('\n').map((s) => s.trim()).filter(Boolean);
    cardsCapped = cardLines.length >= CARD_LIMIT;
    triaged = t.triage(fresh, { openCards: cardLines });
  }
  const out = renderDigest({ pulled, sinceSec, fresh, triaged, cardsOk, cardsCapped });
  const err = pulled.ok ? '' : 'feedback-digest: could not read the reports: ' + pulled.because;
  const code = pulled.ok ? 0 : 2;
  if (!dry) {
    writeState(stateDir, 'digest.txt', out);
    /* The watermark moves only when a poster says the digest landed (--mark-posted), never on a failed read. */
    if (pulled.ok) writeState(stateDir, 'pending', String(runStart));
  }
  return { code, out, err };
}

module.exports = { main, renderDigest, readCards, CRASH, defaultStateDir };

if (require.main === module) {
  main(process.argv.slice(2)).then((r) => {
    if (r.out) process.stdout.write(r.out + '\n');
    if (r.err) process.stderr.write(r.err + '\n');
    process.exitCode = r.code;
  }, (e) => { process.stderr.write('feedback-digest: FAILED: ' + String((e && e.message) || e) + '\n'); process.exitCode = 1; });
}
