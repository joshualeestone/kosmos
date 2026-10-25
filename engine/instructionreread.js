'use strict';
/**
 * kosmos#5297 (and #4890's running-agent half): telling a RUNNING agent that a section of its instructions file changed.
 *
 * An agent reads its instructions file once, when its session starts (engine/instructions.js), so a section rewritten
 * while it runs reaches it only at its next restart. A user's 0.7.22 report (Josh, 2026-10-05) found five running agents
 * still following the community rules and the CLI text they started with, days after both changed. Each change Kosmos
 * writes while agents run owes the agent a line telling it to read that section again (SECTIONS), for example:
 *   - community: the Kosmos+ community block, refreshed at every board start (communityblock.refreshEveryone);
 *   - rules: the working rules, rewritten when the person accepts the refresh (engine/doctrine.js refresh, #539), and
 *     since kosmos#5635 at board start where they were Kosmos's own unedited text (doctrine.refreshUnedited).
 *
 * chat drops a line it cannot place (the shared-quota hold, a busy or unreachable pane), so the debt is kept on disk
 * until a line lands (see settle: PLACED, or UNCONFIRMED, which may have been typed and is never typed twice; if it was
 * not, the agent reads the file at its next start) and the board retries it. { session: { at, last, n, sections: [...] } }: `at` is when the
 * debt began, `last` when it was last owed (a session start after `last` read every section owed; GIVE_UP_MS counts from
 * it, so a section owed late is never given up with an older one), and `n`
 * counts every owe, so a pass clears only the debt it sent and never one owed again while it was sending.
 * Atomic tmp + rename; an unreadable or odd file reads as empty. A debt ends without a line when the agent has started a
 * session since it was last owed (startedSince: it read the new file at that start), when the agent is missing from the
 * roster at two passes running (gone), or after GIVE_UP_MS. It is held, not ended, while the agent is stood down (every
 * project it is in paused or switched off for it: the person's control, as for the other automatic lines).
 *
 * passOnce delivers. It types only into an IDLE card of ours that was idle at the previous pass too (the rule the
 * community turn and the reply nudge use): a line typed into a permission prompt or a question menu would be submitted
 * as its highlighted default, approving or answering for the person (engine/chat.js).
 */
const fs = require('node:fs');
const path = require('node:path');

const GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_PASS = 3;   // lines typed per pass; the timer delivers the rest
const lastOf = (debt) => (Number.isFinite(debt.last) ? debt.last : debt.at);
/* kosmos#5636 F7a, for whoever adds a section here: lineFor tells the agent the notice is not itself a task. A section
   whose text is a standing do-X-daily rule (as the community's post-a-day minimum is) can still read as due now, so give
   it its own clause in lineFor, as the community has. */
const SECTIONS = Object.freeze({
  community: 'the section headed "The Kosmos+ community"',
  // kosmos#5635 review 5: no "with your person's OK": a board-start update had none, and the agent may repeat this.
  rules: 'the working rules (Kosmos added or updated them)',
  // kosmos#5304: the blocks the board-start sweeps and the About-you save rewrite.
  you: 'the section headed "Who you work for"',
  reports: 'the section headed "Who you report to"',
  connections: 'the sections headed "How connecting a provider works", "A plugin the person installed in their own app (Claude and Codex agents)" and "The Connections tab: the services you can work with"',
  dmfiles: 'the section headed "Where to save files you make for the person"',
  language: 'the section headed "The person\'s language"',
  /* kosmos#5320: the projects block (engine/projects.js, rewritten by syncAgent on task and membership changes) carries
     rules a running agent started without, such as `kosmos project pause` (#4982). */
  projects: 'the section headed "Your projects"',
  // kosmos#5534 slice 3: the AI policies block (the company's from its Kosmos policy, and the person's own). Used only
  // when policy.headingsHere cannot be read (kosmos#6270: the person's own policies are "Your AI policy").
  policy: 'the section headed "Your AI policy" (or "Your AI policies", "Your company\'s AI policy" or "Your company\'s AI policies")',
});

/* kosmos#6263 board review 3: the policy section by the headings this Kosmos's blocks carry (engine/policy.js
   headingsHere), so a family's agent is sent to the family's headings or "Your AI policy", not to the company's. The
   agent's file carries one of the headings the line names. */
function policySection() {
  let names;
  try { names = require('./policy').headingsHere(); } catch { return SECTIONS.policy; }
  if (names.length < 2) return SECTIONS.policy;   // defensive: every kind has four headings today (kosmos#6270)
  const q = names.map((n) => `"${n}"`);
  const rest = q.slice(1);
  const tail = rest.length === 1 ? rest[0] : rest.slice(0, -1).join(', ') + ' or ' + rest[rest.length - 1];
  return `the section headed ${q[0]} (or ${tail})`;
}
function file() { return path.join(require('./store').ROOT, 'instruction-reread.json'); }
/* When a re-read line was typed into each agent, the last day of them: the community turn treats the turn such a line
   woke as Kosmos's own, never as the agent's work (communityturn.workedSince). { session: [ms, ...] }. One writer: the
   board's re-read pass, which never runs twice at once (server.js instructionRereadRunning). */
function sentFile() { return path.join(require('./store').ROOT, 'instruction-reread-sent.json'); }
const SENT_KEEP_MS = 24 * 60 * 60 * 1000;
function readSent() {
  try {
    const d = JSON.parse(fs.readFileSync(sentFile(), 'utf8'));
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
    const out = {};
    for (const [k, v] of Object.entries(d)) if (k && Array.isArray(v)) out[k] = v.filter(Number.isFinite);
    return out;
  } catch { return {}; }
}
function sentTimes(session) { const v = readSent()[session]; return Array.isArray(v) ? v : []; }
function recordSent(session, now = Date.now()) {
  try {
    const all = readSent();
    const out = {};
    for (const [k, v] of Object.entries(all)) { const keep = v.filter((t) => now - t < SENT_KEEP_MS); if (keep.length) out[k] = keep; }
    out[session] = [...(out[session] || []), now];
    fs.mkdirSync(path.dirname(sentFile()), { recursive: true });
    // #5434 slice 23: flushed before the rename
    require('./store').saveFlushed(sentFile(), JSON.stringify(out) + '\n');
    return true;
  } catch { return false; }
}

/* The debt file as written, null when it exists but cannot be read or parsed (a writer that would replace it must not:
   that would drop every debt in it), {} when there is none. */
function readOwedStrict() {
  let raw;
  try { raw = fs.readFileSync(file(), 'utf8'); } catch (err) { return err && err.code === 'ENOENT' ? {} : null; }
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  } catch { return null; }
  return readOwed();
}

function readOwed() {
  try {
    const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
    const out = {};
    for (const [k, v] of Object.entries(d)) {
      if (!k || !v || typeof v !== 'object' || !Number.isFinite(v.at) || !Array.isArray(v.sections)) continue;
      const sections = v.sections.filter((s) => Object.prototype.hasOwnProperty.call(SECTIONS, s));
      if (sections.length) out[k] = { at: v.at, last: Number.isFinite(v.last) ? v.last : v.at, n: Number.isInteger(v.n) ? v.n : 1, sections };
    }
    return out;
  } catch { return {}; }
}

function writeOwed(owed) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    // #5434 slice 23: flushed before the rename
    require('./store').saveFlushed(file(), JSON.stringify(owed) + '\n');
    return true;
  } catch { return false; }
}

/* Pure: the map with `section` owed to `session`. The first debt's time is kept, so a section owed again does not
   postpone giving up. */
function owe(owed, session, section, now = Date.now()) {
  if (!session || !Object.prototype.hasOwnProperty.call(SECTIONS, section)) return { ...owed };
  const cur = owed[session];
  const sections = cur ? [...new Set([...cur.sections, section])] : [section];
  return { ...owed, [session]: { at: cur ? cur.at : now, last: now, n: (cur && Number.isInteger(cur.n) ? cur.n : 0) + 1, sections } };
}

/* Read, owe and write in one step, for a caller that is not holding the map. */
function oweNow(session, section, now = Date.now()) {
  const cur = readOwedStrict();
  if (cur === null) return false;
  return writeOwed(owe(cur, session, section, now));
}

/* Pure: the map after one delivery verdict. A line that landed clears the agent's whole debt (it named every section
   owed); anything else keeps it, until GIVE_UP_MS. (chat sets held and busy only on a COULD_NOT verdict today; the
   check is kept so a landed state can never be read from a refusal.) */
function settle(owed, session, verdict, DELIVERY, now = Date.now()) {
  const next = { ...owed };
  const state = verdict && verdict.state;
  const landed = Boolean(DELIVERY) && (state === DELIVERY.PLACED || state === DELIVERY.UNCONFIRMED)
    && !(verdict && (verdict.held === true || verdict.busy === true));
  if (landed || !next[session] || now - lastOf(next[session]) > GIVE_UP_MS) delete next[session];
  return next;
}

/* Pure: has the agent started a session since the debt began? `rows` is engine/selfreport.history (oldest first); a
   'started' report is written at every session start. true, false, or null when the history is unknown (keep the debt). */
function startedSince(rows, at) {
  if (!Array.isArray(rows)) return null;   // a cut history (rows.truncated) can only miss a start: one extra line, never a lost one
  return rows.some((r) => r && r.state === 'started' && Number.isFinite(r.at) && r.at > at);
}

/* Pure: the file's debts after a pass, given what the pass ended: { session: n } (the `n` of the debt it ended). A debt
   owed again during the pass has a larger `n`, so it survives. */
function mergeCleared(latest, cleared) {
  const next = { ...latest };
  for (const [session, n] of Object.entries(cleared || {})) {
    if (next[session] && next[session].n === n) delete next[session];
  }
  return next;
}

/* Pure: the board-start community refresh's verdicts (communityblock.refreshEveryone) applied to the debt map: every
   agent whose rules changed owes a 'community' re-read. */
function oweChanged(told, owed, now = Date.now()) {
  let next = { ...owed };
  for (const t of Array.isArray(told) ? told : []) if (t && t.rulesChanged === true && t.agent) next = owe(next, t.agent, 'community', now);
  return next;
}

/* Pure (kosmos#5304): every verdict whose block was rewritten (`changed`) owes `section`. */
function oweEach(told, owed, section, now = Date.now()) {
  let next = { ...owed };
  // A removed block (`removed`) owes nothing: there is no section left to read; the agent drops it at its next start.
  for (const t of Array.isArray(told) ? told : []) if (t && t.changed === true && t.removed !== true && t.agent) next = owe(next, t.agent, section, now);
  return next;
}

/* kosmos#7149: what changed, not only where. A copy of the agent's instructions file as it last read it (at its session
   start, from the report route, and when a re-read line lands) is kept per session; at delivery the file is diffed
   against it and the changed lines are written to one file in the agent's own folder, which the line names. No copy, an
   unreadable file or no difference: the line is as before. The copy is Kosmos's bookkeeping, never shown to anyone. */
const SEEN_SAFE = /^[A-Za-z0-9._-]{1,120}$/;
// Per session (review 2): two agents can share one recorded folder, and each must find only its own changes.
// Review 7: with the same name hash as the copy, so two names that differ only in case (one folder) never share it.
const nameHash = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex').slice(0, 12);
const changesName = (session) => '.kosmos-instructions-changed-' + session + '-' + nameHash(session) + '.md';
const DIFF_CELLS_MAX = 4 * 1000 * 1000;   // LCS table bound: a rewrite this large is read whole anyway
const CHANGES_LINES_MAX = 160;
// Review 2: a whole line is never cut (an edit past the cut would print as two identical lines); the file is capped
// by its size instead, and says so when it is.
const CHANGES_BYTES_MAX = 32 * 1024;
function seenDir() { return path.join(require('./store').ROOT, 'instruction-reread-seen'); }
/* Review 2: the exact name's hash is in the file name, so two names that differ only in case (one file on macOS) keep
   two copies. */
function seenFile(session) {
  const s = String(session || '');
  if (!SEEN_SAFE.test(s) || /^\.+$/.test(s)) return null;
  return path.join(seenDir(), s + '-' + nameHash(s) + '.md');
}
function readSeen(session) {
  const p = seenFile(session);
  if (!p) return null;
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
/* Atomic: tmp + rename. false on any failure (the next diff is then against an older copy, or none). */
function remember(session, text) {
  const p = seenFile(session);
  if (!p || typeof text !== 'string') return false;
  try {
    fs.mkdirSync(seenDir(), { recursive: true, mode: 0o700 });
    // Review 1: through securewrite (no symlink followed, 0600): the copy holds the person's whole instructions file.
    require('./securewrite').writeSecret(p, text, 0o600, { atomicOnly: true, ownTempsOnly: true });
    return true;
  } catch { return false; }
}
/* The changes file beside the agent's brief, or null. */
function changesPath(session) {
  try {
    const file = require('./instructions').fileFor(session);
    return file && SEEN_SAFE.test(String(session || '')) ? path.join(path.dirname(file), changesName(String(session))) : null;
  } catch { return null; }
}
function dropChanges(session) {
  const p = changesPath(session);
  if (!p) return;
  try { const st = fs.lstatSync(p); if (st.isFile() || st.isSymbolicLink()) fs.unlinkSync(p); } catch { /* none there */ }
}
/* The agent read its whole file just now (a session start). Its changes file has done its job, so it goes (review 2:
   it may hold lines the person removed). Never throws. */
function rememberRead(session) {
  // Review 4: a copy that cannot be renewed here is dropped, so the next notice is as before rather than diffed
  // against something older than what the agent just read.
  const dropCopy = () => { const p = seenFile(session); if (p) { try { fs.unlinkSync(p); } catch { /* none kept */ } } return false; };
  try {
    dropChanges(session);
    const got = require('./instructions').read(session);
    if (!(got && got.exists === true && typeof got.text === 'string')) return dropCopy();
    return remember(session, got.text) || dropCopy();
  } catch { return dropCopy(); }
}
/* The agent's files are deleted (engine/delete-leftover.js): its copy and changes file go with them (review 2). */
function forget(session) {
  dropChanges(session);
  const p = seenFile(session);
  if (p) { try { fs.unlinkSync(p); } catch { /* none kept */ } }
}
/* Pure: the lines that differ between two texts, each run labelled with the nearest heading above it in the newer text
   (or the older one, for a run removed at the end). '' when they are the same, null when too large to diff. */
function changedLines(before, after) {
  // Review 1: a CRLF file compares and prints without its carriage returns.
  // Review 2: one trailing newline more or less is not a change.
  const norm = (s) => String(s).replace(/\r\n?/g, '\n').replace(/\n$/, '');   // review 3: a lone CR is a line end too
  const lines = (s) => { const n = norm(s); return n === '' ? [] : n.split('\n'); };   // review 5: an empty file has no lines
  const a = lines(before);
  const b = lines(after);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre += 1;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf += 1;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  if (!A.length && !B.length) return '';
  if ((A.length + 1) * (B.length + 1) > DIFF_CELLS_MAX) return null;
  // LCS lengths from the end, so a forward walk can choose at each step.
  const w = B.length + 1;
  const L = new Uint32Array((A.length + 1) * w);
  for (let i = A.length - 1; i >= 0; i -= 1) {
    for (let j = B.length - 1; j >= 0; j -= 1) {
      L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  // A heading is a # line OUTSIDE a fenced code block (review 1: a shell comment in a fence is not a section).
  const headsOf = (lines) => {
    const heads = new Array(lines.length);
    /* The opening run (review 3, as CommonMark): only a run of the same character at least as long closes it, with
       nothing after it but spaces. */
    let fence = null;
    let cur = null;
    for (let k = 0; k < lines.length; k += 1) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[k]);
      if (m && fence === null) fence = m[1];
      else if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = null;
      else if (fence === null && /^#{1,6} \S/.test(lines[k])) cur = lines[k];
      heads[k] = cur;
    }
    return heads;
  };
  const headsA = headsOf(a);
  const headsB = headsOf(b);
  const headAt = (heads, upTo) => (upTo >= 0 ? heads[upTo] : null);
  const runs = [];
  let run = null;
  const flush = () => { if (run) { runs.push(run); run = null; } };
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { flush(); i += 1; j += 1; continue; }
    /* Review 9: each changed line is labelled by the heading it sits under (headsOf, so a # line in a code fence never
       counts): an added line by the new text at its own position (an added heading labels itself), a removed one by
       the new text just above it, else the old. A change of label starts a new run, so lines added at the end of one
       section are never filed under a heading added after them. */
    const removing = i < A.length && (j >= B.length || L[(i + 1) * w + j] >= L[i * w + j + 1]);
    const head = removing ? (headAt(headsB, pre + j - 1) || headAt(headsA, pre + i - 1)) : headAt(headsB, pre + j);
    if (run && run.head !== head) flush();
    if (!run) run = { head, lines: [] };
    // A removed line before the line that replaced it, as a reader expects.
    if (removing) { run.lines.push('- ' + A[i]); i += 1; }
    else { run.lines.push('+ ' + B[j]); j += 1; }
  }
  flush();
  /* Review 5: each removed line beside the line that replaced it, so a cut keeps old and new together (removals all
     first would leave a cut file with only the rules that no longer apply). */
  for (const r of runs) {
    const minus = r.lines.filter((l) => l.startsWith('- '));
    const plus = r.lines.filter((l) => l.startsWith('+ '));
    const paired = [];
    for (let k = 0; k < Math.max(minus.length, plus.length); k += 1) {
      if (k < minus.length) paired.push(minus[k]);
      if (k < plus.length) paired.push(plus[k]);
    }
    r.lines = paired;
  }
  const out = [];
  let bytes = 0;
  let cut = false;
  // Room is kept for the cut note (review 3), so a cut file stays inside both caps.
  const NOTE = '[More changed than fits here: read the sections the notice names.]';
  const lineRoom = CHANGES_LINES_MAX - 2;
  const byteRoom = CHANGES_BYTES_MAX - Buffer.byteLength(NOTE) - 2;
  const fits = (s) => out.length < lineRoom && bytes + Buffer.byteLength(s) + 1 <= byteRoom;
  for (const r of runs) {
    // A label and at least one of its lines fit, or the run is left for the sections the notice names.
    const label = r.head ? 'Under ' + r.head.replace(/^#+ /, '') + ':' : 'Before the first heading:';
    if (out.length + 3 > lineRoom || !fits('\n' + label + '\n' + r.lines[0])) { cut = true; break; }
    out.push('', label);
    bytes += Buffer.byteLength(label) + 2;
    for (const l of r.lines) {
      if (!fits(l)) { cut = true; break; }
      out.push(l);
      bytes += Buffer.byteLength(l) + 1;
    }
    if (cut) break;
  }
  // Review 3: nothing fit (one line larger than the cap): too large, so the line names no file.
  if (!out.length) return null;
  if (cut) out.push('', NOTE);
  return out.join('\n');
}
/* Before a line: the current file, and (when a copy of what the agent last read exists and differs) the path of the
   changes file written beside it. { text, path } or null when the file cannot be read. Never throws. */
function prepareChanges(session) {
  try {
    const instructions = require('./instructions');
    const got = instructions.read(session);
    if (!got || got.exists !== true || typeof got.text !== 'string') return null;
    const p = changesPath(session);
    // Review 1: an older changes file is removed whenever this notice names none, so the agent never finds a stale one.
    const none = () => { dropChanges(session); return { text: got.text, path: null }; };
    const seen = readSeen(session);
    if (seen === null) return none();
    const diff = changedLines(seen, got.text);
    // A path with a double quote is not named: the #5304 reader takes quoted text in the line for section headings.
    // Review 2: nor one with whitespace or a control character, which would make the unquoted path in the line ambiguous.
    if (!diff || !p || /["\s\u0000-\u001f\u007f]/.test(p)) return none();
    const body = '# What changed in your instructions file since you last read it\n\n'
      + 'Kosmos wrote this when it told you the file changed. A line starting with - was removed, one starting with + was added.\n'
      + diff + '\n';
    // Review 1 BLOCKER: through securewrite, so a link planted in the agent's folder is never followed; 0600.
    require('./securewrite').writeSecret(p, body, 0o600, { atomicOnly: true, ownTempsOnly: true });
    return { text: got.text, path: p };
  } catch { return null; }
}

/* The one line for an agent's debt, naming every section it owes. */
function lineFor(sections, { communityStopped = false, changesAt = null } = {}) {
  const named = (Array.isArray(sections) ? sections : []).filter((s) => Object.prototype.hasOwnProperty.call(SECTIONS, s));
  if (!named.length) return null;
  const list = named.map((s) => (s === 'policy' ? policySection() : SECTIONS[s]));
  const what = list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  /* kosmos#5636 F7a: the line is a notice, not a task. Suspected, not confirmed (see the plan): on a 0.7.48 test board
     an agent got a prompt to post with no community turn that day, plausibly from reading the community section's
     post-a-day rule as asked now. So, apart from the reading, the line is not itself a task. The agent (idle when this
     is typed, passOnce) follows the new text wherever it applies, so a working rule that says to take the next thing
     still moves it. When the community section is named, one clause scopes itself to now: no taking part because of
     this notice, and the new community text applies the next time the agent takes part. It names no community duty, so
     it sends nobody to check one. No double quotes in the text added here (the section names carry them by design): the #5304 test
     reads quoted text as section headings. */
  /* kosmos#6239: under a policy that keeps agents out of the community, the section now says the agent does not take
     part, so the line says that, not "the next time you take part". */
  const community = !named.includes('community') ? ''
    : communityStopped === true
      ? 'Its Kosmos+ community section now says you do not take part in the community: from now on, do not. '
      : 'Do not take part in the Kosmos+ community now because of this notice, even with a daily minimum still open there; '
        + 'its new text applies the next time you take part. ';
  // kosmos#7149: where the changed lines are, so the agent need not re-read a long block to find a short change.
  const changes = typeof changesAt === 'string' && changesAt
    ? 'To help you find what changed since you last read it, the changed lines are listed in ' + changesAt + ' (a pointer only: still read the sections themselves). '
    : '';
  // Review 5: after the replaces sentence, so its "it" stays the instructions file, not the changes file.
  return 'Kosmos here: your instructions file has changed since you started. Read ' + what + ' in it now. '
    + 'What it says now replaces anything you read there when you started. '
    + changes
    + community
    + 'Apart from that reading, this notice is not itself a task: follow the new text from here wherever it applies.';
}

/*
 * One delivery pass. Never throws. Everything it reads or sends is injected, so it is tested without a board:
 *   roster()      the board's cards (safeRoster); null or empty leaves every debt for a later pass
 *   isIdle(card)  agentnudge.nudgeableCard: an idle card of ours
 *   seenIdle      a Set kept by the caller across passes: the sessions idle at the previous pass (refilled here)
 *   history(s)    engine/selfreport.history
 *   allowed()     live execution
 *   deliver(s, line, roster)  chat.deliverAutomaticAsync; DELIVERY: chat.DELIVERY
 *   recordSent(s, ms)         recordSent below (optional)   seenMissing  a Set like seenIdle, for agents missing from the roster
 *   stoodDown(s)              replynudge.stoodDown over the projects (optional): true holds the debt
 *   sectionOn(section)        false holds that section (the line names only the others; it stays owed)
 *   read()/write(owed)        the debt file (readOwed / writeOwed by default)
 * Returns [{ session, act }] for the log: 'sent' | 'kept' | 'not-idle' | 'stood-down' | 'section-off' | 'missing' | 'restarted' | 'gone' | 'expired'.
 */
async function passOnce(o) {
  const out = [];
  try {
    const read = typeof o.read === 'function' ? o.read : readOwed;
    const write = typeof o.write === 'function' ? o.write : writeOwed;
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    let roster = null;
    try { roster = o.roster(); } catch { roster = null; }
    const seen = o.seenIdle instanceof Set ? new Set(o.seenIdle) : new Set();
    const missingBefore = o.seenMissing instanceof Set ? new Set(o.seenMissing) : null;
    if (!Array.isArray(roster) || !roster.length) {
      if (o.seenIdle instanceof Set) o.seenIdle.clear();
      if (o.seenMissing instanceof Set) o.seenMissing.clear();
      return out;
    }
    const idleNow = new Set();
    const isIdle = (c) => { try { return o.isIdle(c) === true; } catch { return false; } };
    for (const c of roster) if (c && c.sessionName && isIdle(c)) idleNow.add(String(c.sessionName));
    if (o.seenIdle instanceof Set) { o.seenIdle.clear(); for (const s of idleNow) o.seenIdle.add(s); }
    let owed = read();
    const cleared = {};
    const keep = {};
    let tried = 0;
    const end = (session, act) => {
      cleared[session] = owed[session].n;
      out.push({ session, act });
      // Review 3: a debt that ends without a line leaves no changes file behind.
      if (act !== 'sent' && typeof o.dropChanges === 'function') { try { o.dropChanges(session); } catch { /* the next start removes it */ } }
    };
    const ours = new Set(roster.filter((c) => c && c.isNamedOurs === true).map((c) => String(c.sessionName)));
    for (const session of Object.keys(owed)) {
      const debt = owed[session];
      if (now - lastOf(debt) > GIVE_UP_MS) { end(session, 'expired'); continue; }
      if (!ours.has(session)) {
        /* Gone only when it was missing at the previous pass too (a caller without the set: at once), so one partial
           roster cannot end a real debt. */
        if (missingBefore === null || missingBefore.has(session)) end(session, 'gone');
        else out.push({ session, act: 'missing' });
        continue;
      }
      let rows = null;
      try { rows = o.history(session); } catch { rows = null; }
      // A start after the LATEST owe read every section owed; one between owes read only the older ones.
      if (startedSince(rows, lastOf(debt)) === true) { end(session, 'restarted'); continue; }
      let down = false;
      if (typeof o.stoodDown === 'function') { try { down = o.stoodDown(session) === true; } catch { down = false; } }
      if (down) { out.push({ session, act: 'stood-down' }); continue; }
      const on = typeof o.sectionOn === 'function' ? debt.sections.filter((sec) => { try { return o.sectionOn(sec) === true; } catch { return false; } }) : debt.sections;
      if (!on.length) { out.push({ session, act: 'section-off' }); continue; }
      const off = debt.sections.filter((sec) => !on.includes(sec));   // stay owed after a line for the others lands
      if (!idleNow.has(session) || !seen.has(session)) { out.push({ session, act: 'not-idle' }); continue; }
      let ok = false;
      try { ok = o.allowed() === true; } catch { ok = false; }
      if (!ok) break;
      let stoppedNow = false;
      if (typeof o.communityStopped === 'function') { try { stoppedNow = o.communityStopped() === true; } catch { stoppedNow = false; } }
      /* The pass awaits each send, so the reading above can be seconds old: read the roster again and check THIS card
         is still idle just before typing (and hand chat that fresh roster). */
      if (tried >= (Number.isInteger(o.max) ? o.max : MAX_PER_PASS)) break;
      let fresh = null;
      try { fresh = o.roster(); } catch { fresh = null; }
      const card = Array.isArray(fresh) ? fresh.find((c) => c && String(c.sessionName) === session) : null;
      if (!card || !isIdle(card)) { out.push({ session, act: 'not-idle' }); continue; }
      /* kosmos#7149, after every check that can skip the line (review 1): nothing is written for a line never typed. Not
         while a section is held (off): the copy would move past a change the agent is not told about yet. */
      let prepared = null;
      if (!off.length && typeof o.prepareChanges === 'function') { try { prepared = o.prepareChanges(session); } catch { prepared = null; } }
      // Review 3: a line that names no changes file leaves none behind (a held section, or prepareChanges not reached).
      if (!(prepared && prepared.path) && typeof o.dropChanges === 'function') { try { o.dropChanges(session); } catch { /* the next start removes it */ } }
      const line = lineFor(on, { communityStopped: stoppedNow, changesAt: prepared && prepared.path });
      tried += 1;
      const sentAt = Date.now();   // before the send: the agent's own report of the turn can land before deliver returns
      let v = null;
      // A throw may come after the paste, so it counts as UNCONFIRMED (reached), as communityturn and replynudge read chat.
      try { v = await o.deliver(session, line, fresh); } catch { v = { state: o.DELIVERY && o.DELIVERY.UNCONFIRMED }; }
      /* #4588 ask 3 (rebase review): a line the Gemini cap or the quota held typed nothing, so it does not spend one of the
         pass's tries; otherwise held idle Gemini agents at the top of the debts take every try each pass and nobody below
         them is ever told (the community turn's review-15 defect). Its debt stays owed (settle keeps a held verdict). */
      if (v && v.held === true) tried -= 1;
      const after = settle(owed, session, v, o.DELIVERY, now);
      if (after[session]) {
        out.push({ session, act: 'kept', state: (v && v.state) || null });
        // Review 6: a line that did not land leaves no changes file behind; the next pass writes a fresh one.
        if (prepared && prepared.path && typeof o.dropChanges === 'function') { try { o.dropChanges(session); } catch { /* the next start removes it */ } }
      }
      else {
        end(session, 'sent');
        if (off.length) keep[session] = { at: debt.at, last: debt.last, n: 1, sections: off };
        if (typeof o.recordSent === 'function') { try { o.recordSent(session, sentAt); } catch { /* only the turn's label is lost */ } }
        // kosmos#7149: the agent reads the file now, so this is what it last read (the next diff starts here).
        if (prepared && typeof prepared.text === 'string' && typeof o.remember === 'function') { try { o.remember(session, prepared.text); } catch { /* the next diff is wider */ } }
      }
    }
    if (o.seenMissing instanceof Set) {
      o.seenMissing.clear();
      for (const k of Object.keys(owed)) if (!ours.has(k) && !(k in cleared)) o.seenMissing.add(k);   // still-open debts only
    }
    if (Object.keys(cleared).length) {
      const cur = typeof o.read === 'function' ? read() : readOwedStrict();
      if (cur === null) return out;   // unreadable now: never replaced
      const next = mergeCleared(cur, cleared);
      // A debt owed again during the send already names every section, so a held one is kept only when there is none.
      for (const [session, debt] of Object.entries(keep)) if (!next[session]) next[session] = debt;
      write(next);
    }
  } catch { /* the next pass tries again */ }
  return out;
}

module.exports = { changedLines, prepareChanges, remember, rememberRead, forget, dropChanges, readSeen, GIVE_UP_MS, MAX_PER_PASS, SECTIONS, file, readOwed, readOwedStrict, writeOwed, owe, oweNow, settle, startedSince, mergeCleared, oweChanged, oweEach, lineFor, passOnce, recordSent, sentTimes, sentFile };
