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
  connections: 'the section headed "Connecting providers, plugins and services"',   // kosmos#7875 item 2: the short block
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
// kosmos#8912: how many section names a cut note lists before it says "and N more sections".
const CUT_NAMES_MAX = 12;
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
  const dropCopy = () => { const p = seenFile(session); if (p) { try { fs.unlinkSync(p); } catch { /* none kept */ } } forgetMarks(session); return false; };
  try {
    dropChanges(session);
    forgetBody(session);   // kosmos#8912 slice 2: a session start begins the numbering again, at Notice 1
    const got = require('./instructions').read(session);
    if (!(got && got.exists === true && typeof got.text === 'string')) return dropCopy();
    // kosmos#8416: it read every section just now; marks that could not be saved are dropped, never left old.
    if (!markRead(session, Object.keys(SECTIONS), got.text)) forgetMarks(session);
    return remember(session, got.text) || dropCopy();
  } catch { return dropCopy(); }
}
/* kosmos#8916 item 1: a session start that was not recorded still read the whole file, so what was kept for its old
   session goes: its marks (kosmos#8416), and its changes file and the number kept with it, so the next notice starts
   at Notice 1 and no entry from before the start is carried. Only the copy stays, so it never runs ahead of the recorded
   start (review 7 of #7149); the next entry is then diffed from that older copy and can list lines the agent already read
   at this start, more to read, never less. Never throws. */
function startedUnrecorded(session) {
  try { dropChanges(session); } catch { /* none there */ }
  try { forgetBody(session); } catch { /* none kept */ }
  try { forgetMarks(session); } catch { /* the next notice names more */ }
}
/* The agent's files are deleted (engine/delete-leftover.js): its copy and changes file go with them (review 2). */
function forget(session) {
  dropChanges(session);
  forgetBody(session);
  forgetMarks(session);
  const p = seenFile(session);
  if (p) { try { fs.unlinkSync(p); } catch { /* none kept */ } }
}
/* Pure: the lines that differ between two texts, each line labelled by the heading it sits under (review 9: an added line
   by the newer text, a removed one by the newer text above it, else the older), each run in a diff fence (review 11).
   '' when they are the same, null when too large to diff.
   kosmos#8743: `moved` ({ under, lines, where }) leaves out a removed line under the heading `under` whose text is in `lines` (a
   Set): a line that moved out of that section into a guide printed on demand has not stopped applying, and the file's
   own header says a line marked - no longer applies. A Left out note (before the cut note, if any) says how many and where.
   When a line under that heading is still marked, a sentence says it may be in the guide reworded: inside the Left out
   note when there is one, on its own when nothing was left out.
   kosmos#8735 slice 2: `moved` may also be a list of such entries (the community routine, and the task commands that
   moved to `kosmos task --how`), each judged under its own heading, with its own note. One entry behaves as before. */
function changedLines(before, after, moved = null) {
  const movedList = (Array.isArray(moved) ? moved : [moved]).filter((m) => m && m.lines instanceof Set && typeof m.under === 'string');
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
  /* kosmos#9096 item 5, review 2: which lines are code (a fence line, or inside a fence), by headsOf's fence rules. A code
     line is never judged wording only: its quotes, commas and spacing are syntax. */
  const codeOf = (lines) => {
    const code = new Array(lines.length).fill(false);
    // Review 4: leading width in columns, a tab reaching the next multiple of 4 (CommonMark).
    const cols = (ws) => { let c = 0; for (const ch of ws) c = ch === '\t' ? c + 4 - (c % 4) : c + 1; return c; };
    let fence = null;   // { mark, at }: the opening run and its column
    for (let k = 0; k < lines.length; k += 1) {
      /* Review 3: an opener at any indentation and quote depth (a fence in a list item, after a tab, in a > quote).
         Review 4: a closer only up to 3 columns deeper than its opener, so a deeper ``` is content (a block showing a
         fence). Erring towards code only shows more lines. */
      const m = /^(\s*)(?:>\s*)*(`{3,}|~{3,})(.*)$/.exec(lines[k]);
      if (m && fence === null) { fence = { mark: m[2], at: cols(m[1]) }; code[k] = true; }
      else if (m && m[2][0] === fence.mark[0] && m[2].length >= fence.mark.length && !m[3].trim() && cols(m[1]) <= fence.at + 3) { fence = null; code[k] = true; }
      // Review 3 and 4: an indented code block (4 columns or more, tabs counted to the next multiple of 4) is code too.
      else code[k] = fence !== null || cols(/^[ \t]*/.exec(lines[k])[0]) >= 4;
    }
    return code;
  };
  const codeA = codeOf(a);
  const codeB = codeOf(b);
  const headAt = (heads, upTo) => (upTo >= 0 ? heads[upTo] : null);
  const runs = [];
  let run = null;
  const flush = () => { if (run) { runs.push(run); run = null; } };
  let i = 0;
  let j = 0;
  const movedOut = movedList.map(() => 0);
  const shownUnder = movedList.map(() => 0);   // review 4: lines under that heading still marked -, which the conditional sentence covers
  /* Review 1: any non-blank guide line (a short one such as KOSMOS_END or Also: is the guide's too; the heading keeps the
     match narrow), and every blank line removed under that heading is left out without being counted (a blank line
     carries no rule). Review 2: the heading is the one the removed line had in the OLD text, not the new text above it. */
  const underMoved = (head) => movedList.findIndex((m) => head === m.under);   // -1: under no moved heading
  const isMoved = (line, head) => { const k = underMoved(head); return k >= 0 && line.trim() !== '' && movedList[k].lines.has(line.trim()); };
  const isGap = (line, head) => underMoved(head) >= 0 && line.trim() === '';
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { flush(); i += 1; j += 1; continue; }
    /* Review 9: each changed line is labelled by the heading it sits under (headsOf, so a # line in a code fence never
       counts): an added line by the new text at its own position (an added heading labels itself), a removed one by
       the new text just above it, else the old. A change of label starts a new run, so lines added at the end of one
       section are never filed under a heading added after them. */
    const removing = i < A.length && (j >= B.length || L[(i + 1) * w + j] >= L[i * w + j + 1]);
    const head = removing ? (headAt(headsB, pre + j - 1) || headAt(headsA, pre + i - 1)) : headAt(headsB, pre + j);
    const oldHead = removing ? headsA[pre + i] : null;   // review 2: the section the removed line was in
    if (removing && isMoved(A[i], oldHead)) { movedOut[underMoved(oldHead)] += 1; i += 1; continue; }   // kosmos#8743: the guide prints it
    if (removing && isGap(A[i], oldHead)) { i += 1; continue; }   // review 1: a blank line, not a rule
    if (run && run.head !== head) flush();
    if (!run) run = { head, lines: [] };
    // A removed line before the line that replaced it, as a reader expects.
    if (removing) { const k = underMoved(headsA[pre + i]); if (k >= 0) shownUnder[k] += 1; (run.movedOf = run.movedOf || []).push(k); (run.codeMinus = run.codeMinus || []).push(codeA[pre + i]); run.lines.push('- ' + A[i]); i += 1; }
    else { (run.codePlus = run.codePlus || []).push(codeB[pre + j]); run.lines.push('+ ' + B[j]); j += 1; }
  }
  flush();
  /* Review 5: each removed line beside the line that replaced it, so a cut keeps old and new together (removals all
     first would leave a cut file with only the rules that no longer apply). */
  /* kosmos#9096 item 5: a removed line and the line that replaced it whose only difference is spacing after the
     indentation, or a single full stop that ends the line right after a word, changed in wording
     only. Such a pair is counted and not printed, so the capped list keeps its room for rules that changed.
     Narrow on purpose (review 1): a mark standing alone is kept (`git add .`, `cd ..`); ? ! ; : are kept (a question is
     not an instruction, `! cmd` negates, `;` separates commands, `key:` is YAML); leading indentation must match exactly
     (YAML, nested bullets); case, hyphens and every other symbol count, because a flag (`--no-reply`, `-D`) or a path
     can differ by exactly that. Telling a paraphrase from a change in meaning needs judgement, so it is never tried. */
  const wordingOf = (t) => {
    const s = String(t);
    const indent = s.match(/^[ \t]*/)[0];
    // Review 2: one full stop only, right after a word (`main..` is a git range); a comma is never wording (JSON, args).
    // Review 3: only at the END of the line ("1. Push" is a list item; "merge. Wait" is two sentences).
    return indent + s.slice(indent.length).replace(/\s+/g, ' ').trim().replace(/(?<=\w)\.$/, '');
  };
  let reworded = 0;
  for (const r of runs) {
    const minus = r.lines.filter((l) => l.startsWith('- '));
    const plus = r.lines.filter((l) => l.startsWith('+ '));
    const movedOf = r.movedOf || [];   // the moved-heading index of each - line, in order (-1: none)
    const codeMinus = r.codeMinus || [];
    const codePlus = r.codePlus || [];
    for (let k = Math.min(minus.length, plus.length) - 1; k >= 0; k -= 1) {
      // Review 2: code (in a fence, or with a backtick span) is compared exactly, so it is never hidden.
      // Review 4: a line with any quote mark is compared exactly too (a command outside backticks: curly quotes, and
      // spacing inside quotes, change what runs).
      const exact = (l) => /[`'"\u2018\u2019\u201C\u201D]/.test(l);
      if (codeMinus[k] || codePlus[k] || exact(minus[k]) || exact(plus[k])) continue;
      if (wordingOf(minus[k].slice(2)) !== wordingOf(plus[k].slice(2))) continue;
      // Review 1: a hidden - line is no longer "still marked" under a moved heading.
      if (movedOf[k] >= 0) shownUnder[movedOf[k]] -= 1;
      minus.splice(k, 1); plus.splice(k, 1); movedOf.splice(k, 1); codeMinus.splice(k, 1); codePlus.splice(k, 1); reworded += 1;
    }
    r.lines = minus.concat(plus);
  }
  for (let ri = runs.length - 1; ri >= 0; ri -= 1) if (!runs[ri].lines.length) runs.splice(ri, 1);
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
  /* Room is kept for this plain cut note (review 3). kosmos#8912's note names sections and so can be longer: the end of
     the function makes it fit, and falls back to this one when it cannot. */
  const NOTE = '[More changed than fits here: read the sections the notice names.]';
  /* Review 1: the moved note (kosmos#8743) is known before any output, so its room is kept too, and it goes before the
     cut note, so a cut file still ends with the more-changed note the header tells the reader to look for. */
  /* Review 2: only what the code checks (the line left that section and the guide prints it), and, since a reworded line
     cannot be matched, a conditional any reader can check for the lines still marked there. */
  const noteFor = (m, n, shown) => {
    const where = m.under.replace(/^#+ /, '');
    const mayBe = 'A line marked - under ' + where + ' may be in ' + m.where + ' too, reworded: read it before you treat it as dropped.';
    // Review 4: the conditional also when nothing was left out but a line under that heading is still marked.
    return n ? 'Left out: ' + n + (n === 1 ? ' line' : ' lines') + ' removed from ' + where + ' that '
      + m.where + ' prints, where ' + (n === 1 ? 'it still applies' : 'they still apply') + '.' + (shown ? ' ' + mayBe : '')
      : (shown ? mayBe : '');
  };
  const movedNotes = movedList.map((m, k) => noteFor(m, movedOut[k], shownUnder[k])).filter((t) => t !== '');
  // kosmos#9096 item 5: said once, after the moved notes, so a reader knows lines were left out and why.
  if (reworded) movedNotes.push('Not shown: ' + reworded + (reworded === 1 ? ' line that changed' : ' lines that changed')
    + ' only in spacing or punctuation (the rule reads the same).');
  const movedNote = movedNotes.join('\n\n');   // each note its own paragraph, in the order the entries were given
  const lineRoom = CHANGES_LINES_MAX - 2 - 2 * movedNotes.length;
  const byteRoom = CHANGES_BYTES_MAX - Buffer.byteLength(NOTE) - 2 - (movedNote ? Buffer.byteLength(movedNote) + 2 : 0);
  const fits = (s) => out.length < lineRoom && bytes + Buffer.byteLength(s) + 1 <= byteRoom;
  /* kosmos#8912: where each shown run starts in `out` (by run index), and the first run not shown whole, so the cut note
     can name the sections it left out. */
  const startOf = new Map();
  let cutAt = -1;
  for (let ri = 0; ri < runs.length; ri += 1) {
    const r = runs[ri];
    // A label and at least one of its lines fit, or the run is left for the sections the cut note names.
    const label = r.head ? 'Under ' + r.head.replace(/^#+ /, '') + ':' : 'Before the first heading:';
    /* Review 11: each run in a diff fence, longer than any backtick run inside it, so a removed line (- ...) can never
       be read or rendered as a live bullet. */
    let longest = 0;
    for (const l of r.lines) for (const m of l.match(/`+/g) || []) longest = Math.max(longest, m.length);
    const fence = '`'.repeat(Math.max(3, longest + 1));
    const close = fence.length + 1;   // the closing fence's line, kept in reserve
    if (out.length + 5 > lineRoom || !fits('\n' + label + '\n' + fence + 'diff\n' + r.lines[0] + '\n' + fence)) { cut = true; cutAt = ri; break; }
    startOf.set(ri, out.length);
    out.push('', label, fence + 'diff');
    bytes += Buffer.byteLength(label) + fence.length + 7;
    for (const l of r.lines) {
      if (out.length + 1 >= lineRoom || bytes + Buffer.byteLength(l) + 1 + close > byteRoom) { cut = true; cutAt = ri; break; }
      out.push(l);
      bytes += Buffer.byteLength(l) + 1;
    }
    out.push(fence);
    bytes += close;
    if (cut) break;
  }
  /* kosmos#8743: every change was a moved line: say so, and nothing else (no fence with nothing in it). */
  if (!out.length && movedNote && !runs.length) return movedNote;
  if (!out.length && !movedNote && !runs.length) return '';   // review 3: only blank lines under the moved heading: the same
  // Review 3: nothing fit (one line larger than the cap): too large, so the line names no file.
  if (!out.length) return null;
  if (!cut) { if (movedNote) out.push('', movedNote); return out.join('\n'); }
  /* kosmos#8912: the cut note names every section whose changes it left out (the run it cut inside, and every run after
     it), so the reader re-reads those sections, not every section the notice names. The names can make the note longer
     than the room kept above, so the whole is measured against both caps, and while it does not fit, in this order:
       1. the last shown run gives way (the first time, that is the run it cut inside, already named), down to one run;
       2. that one run's lines give way from its end, down to one line (its section is then named);
       3. the list shortens, ending "and N more sections", down to one name;
       4. the plain note, whose room is kept above, so the file always fits. */
  const nameOf = (k) => (runs[k].head ? '"' + runs[k].head.replace(/^#+ /, '') + '"' : 'the part before the first heading');
  const namesFrom = (at) => [...new Set(runs.slice(at).map((r, k) => nameOf(at + k)))];
  const cutNote = (names, more) => '[More changed than fits here. Not shown: changes in ' + names.join('; ')
    + (more ? '; and ' + more + (more === 1 ? ' more section' : ' more sections') : '')
    + '. Read ' + (more ? 'those, and every section the notice names,' : names.length === 1 ? 'that section' : 'those sections')
    + ' in full.]';
  let kept = out.slice();
  let from = cutAt;
  const compose = (note) => {
    const parts = kept.slice();
    if (movedNote) parts.push('', movedNote);
    parts.push('', note);
    return parts.join('\n');
  };
  const named = (keep) => { const names = namesFrom(from); return compose(cutNote(names.slice(0, keep), names.length - keep)); };
  const within = (t) => t.split('\n').length <= CHANGES_LINES_MAX && Buffer.byteLength(t) <= CHANGES_BYTES_MAX;
  const fullKeep = () => Math.min(CUT_NAMES_MAX, namesFrom(from).length);
  const shown = [...startOf.keys()];
  let text = named(fullKeep());
  while (!within(text) && shown.length > 1) {
    const k = shown.pop();
    kept = kept.slice(0, startOf.get(k));
    from = Math.min(from, k);
    text = named(fullKeep());
  }
  // The one run left: '' , label, fence + 'diff', its lines, then its closing fence as the last entry of `kept`.
  const only = shown[0];
  const firstLine = startOf.get(only) + 3;
  while (!within(text) && kept.length - 1 - firstLine > 1) {
    kept.splice(kept.length - 2, 1);
    from = Math.min(from, only);
    text = named(fullKeep());
  }
  let keep = fullKeep();
  while (!within(text) && keep > 1) { keep -= 1; text = named(keep); }
  if (!within(text)) text = compose(NOTE);
  return text;
}
/* kosmos#8912 slice 2: the changes file's own header. Reviews 14-17 of kosmos#7149: a pointer, ranking nothing, and never
   calling a removed line current. With entries, a later one wins over an earlier one. */
const CHANGES_TITLE = '# What changed in your instructions file since you last read it\n';
const CHANGES_HEADER = CHANGES_TITLE + '\n'
  + 'Kosmos wrote this when it told you the file changed. A line starting with - was removed, one starting with + was added.\n'
  + 'This is a pointer only: read the sections the notice named. It lists the changes since you last read the file, changes elsewhere in it included: a line marked + is in your instructions now, wherever it is, and a line marked - no longer applies, unless a note in this file says where it went. If it ends with a note that more changed, it is not complete: that note names the sections to read in full.\n'
  + 'Each notice since your session started that names this file has its own entry below, numbered, oldest first; the notice names the one it is about. A later entry wins over an earlier one: a line one entry marks + may be marked - in a later one.\n\n';
// The whole file's bound: the oldest entries go first, and the file says so.
const CHANGES_FILE_MAX = 4 * CHANGES_BYTES_MAX;
const NOTICE_LINE = /^## Notice (\d+), written /;
/* kosmos#8912 slice 2 review 1: what Kosmos last wrote to an agent's changes file, as a hash kept in the board's own data
   folder beside the `seen` copy, so a file in the agent's folder is carried into the next one only when it is exactly
   that (a file anyone else wrote there, even one starting with the title, is never republished as Kosmos's). */
const bodyHash = (t) => require('node:crypto').createHash('sha256').update(String(t)).digest('hex');
function bodyFile(session) { const p = seenFile(session); return p ? p.replace(/\.md$/, '.changes') : null; }
/* Round 2: the last notice number is kept with the hash, so a changes file that is gone (the agent deleted or edited it,
   or Kosmos removed it: dropChanges keeps the number) does not make the next notice Notice 1 again. Only a session start
   (rememberRead) and deleting the agent (forget) clear it, and numbering then starts at 1, as the line's "since you
   started" says. If this file itself cannot be written, both are lost and the next notice is Notice 1: the line then
   still says to read the sections themselves. kosmos#8916 item 5: that label can repeat one the agent already holds (an
   earlier Notice 1 in its context); the file then holds only the new one, so the line's pointer is still to the right
   entry, but "Notice 1" alone does not tell the two apart. */
function rememberBody(session, body, notice) {
  const f = bodyFile(session);
  if (!f) return;
  try { fs.mkdirSync(seenDir(), { recursive: true, mode: 0o700 }); require('./securewrite').writeSecret(f, bodyHash(body) + '\n' + (Number.isSafeInteger(notice) && notice > 0 ? notice : 0) + '\n', 0o600, { atomicOnly: true, ownTempsOnly: true }); }
  catch { forgetBody(session); }
}
/* What rememberBody kept: { hash, notice }, or null. */
function readBody(session) {
  const f = bodyFile(session);
  try {
    const [hash, n] = fs.readFileSync(f, 'utf8').split('\n');
    const notice = Number(n);
    return { hash: String(hash || '').trim(), notice: Number.isSafeInteger(notice) && notice > 0 ? notice : 0 };
  } catch { return null; }
}
function forgetBody(session) { const f = bodyFile(session); if (f) { try { fs.unlinkSync(f); } catch { /* none kept */ } } }
/* The file at `p` read without following a link or waiting on a pipe (O_NOFOLLOW and O_NONBLOCK where the platform has
   them, then the open file itself must be a plain file), and no larger than a file Kosmos writes, or null. */
function readPlain(p) {
  let fd = null;
  try {
    // Round 3 BLOCKER: O_NONBLOCK, so a named pipe left at the path cannot hold the board's one thread in open().
    fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const st = fs.fstatSync(fd);
    const limit = CHANGES_FILE_MAX + 64 * 1024;
    if (!st.isFile() || st.size > limit) return null;
    // kosmos#8916 item 2: read at most limit + 1 bytes, so a file that grows after the fstat is refused, not read past it.
    const buf = Buffer.alloc(limit + 1);
    let got = 0;
    for (let n; got < buf.length && (n = fs.readSync(fd, buf, got, buf.length - got, null)) > 0;) got += n;
    return got > limit ? null : buf.toString('utf8', 0, got);
  } catch { return null; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}
/* The changes file as Kosmos last wrote it, or null (absent, a link, too large, or not what Kosmos wrote). */
function readOwnChanges(session, p) {
  const t = readPlain(p);
  if (t === null || !t.startsWith(CHANGES_TITLE)) return null;
  const kept = readBody(session);
  return kept && kept.hash && kept.hash === bodyHash(t) ? t : null;
}
/* Pure: the entries of a changes file, each { n, text } with its text from its own heading line to the next. A heading
   line can only be Kosmos's: every diff line starts with + or -, and every note with a word or a bracket. */
function entriesOf(body) {
  const lines = String(body).split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = NOTICE_LINE.exec(line);
    if (m) { if (cur) out.push(cur); cur = { n: Number(m[1]), lines: [line] }; }
    else if (cur) cur.lines.push(line);
  }
  if (cur) out.push(cur);
  return out.map((e) => ({ n: e.n, text: e.lines.join('\n').replace(/\n*$/, '') + '\n\n' })).filter((e) => Number.isSafeInteger(e.n) && e.n > 0);
}
/* When a notice was written, on the board's own clock: 17:40 on 22 Nov 2026. */
function noticeStamp(now) {
  const d = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' on ' + dayOf(d);
}
function dayOf(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}
/* A line that did not land: the changes file as it was before this notice's entry (`previous`), or none when there was
   none. Review 1 BLOCKER: only while the file is still the one this notice wrote (`wrote`). A session start during the
   send (rememberRead, from the started report) removes the file; putting the pre-start entries back would tell the agent
   "since you started" about changes from before it started. Anything else there is left as it is. */
function restoreChanges(session, previous, wrote) {
  const p = changesPath(session);
  if (!p || typeof wrote !== 'string') return;
  // Round 3: the number goes back to the one before this notice's, which never reached the agent.
  const mine = entriesOf(wrote);
  const before = mine.length ? mine[mine.length - 1].n - 1 : 0;
  if (readPlain(p) !== wrote) {
    /* Not this notice's file any more. A session start forgot the kept hash too, and then nothing is touched. Otherwise
       the agent or someone else changed the file: it is left as it is, and only the number goes back. */
    const k = readBody(session);
    // The hash of '' can match no file Kosmos reads (every one starts with the title), so only the number is kept.
    if (k && k.hash === bodyHash(wrote)) rememberBody(session, '', before);
    return;
  }
  if (typeof previous !== 'string') { dropChanges(session); rememberBody(session, '', before); return; }
  try {
    require('./securewrite').writeSecret(p, previous, 0o600, { atomicOnly: true, ownTempsOnly: true });
    rememberBody(session, previous, before);
  }
  catch { dropChanges(session); rememberBody(session, '', before); }
}
/* Before a line: the current file, and (when a copy of what the agent last read exists and differs) the path of the
   changes file written beside it. { text, path, notice, previous, wrote } (kosmos#8912 slice 2: the entry's number, the
   file before it and the file as written; path null when it names none) or null when the file cannot be read. Never
   throws. */
function prepareChanges(session, now = new Date()) {
  try {
    const instructions = require('./instructions');
    const got = instructions.read(session);
    if (!got || got.exists !== true || typeof got.text !== 'string') return null;
    const p = changesPath(session);
    // Review 1: an older changes file is removed whenever this notice names none, so the agent never finds a stale one.
    const none = () => { dropChanges(session); return { text: got.text, path: null }; };
    const seen = readSeen(session);
    if (seen === null) return none();
    /* kosmos#8743: the community routine moved to `kosmos community --how` (kosmos#8735); its lines are left out of the
       list as moved, not marked - as if they no longer applied. A guide that cannot be read moves nothing. */
    let moved = null;
    /* Review 3 (BLOCKER): only while the agent still takes part. When the new section is the stopped form (a policy, a
       family Kosmos) or is gone, the routine does not still apply anywhere, so nothing is left out as moved. */
    const cbm = (() => { try { return require('./communityblock'); } catch { return null; } })();
    const projectsMod = (() => { try { return require('./projects'); } catch { return null; } })();   // review 7: as cbm
    // Review 4: an ambiguous section (two blocks, a damaged file) carries no single routine either.
    const found = cbm && projectsMod ? projectsMod.findBlock(got.text, cbm.START, cbm.END) : null;
    const stillTakesPart = Boolean(found) && !found.ambiguous && !cbm.isStoppedSection(got.text);
    if (stillTakesPart) try {
      const guideLines = require('./communityguide').guideText().split('\n').map((l) => l.trim()).filter((l) => l !== '');
      // Review 1: the heading from the block itself, not a third spelling. Review 3: it is compared with the heading a
      // removed line had in the OLD text, so on the one restart that carries a heading rename nothing matches and the
      // lines are listed as removed (the plain diff), never hidden.
      moved = { under: require('./communityblock').blockBody().split('\n')[0], lines: new Set(guideLines), where: 'kosmos community --how' };
    } catch { moved = null; }
    /* kosmos#8735 slice 2 (review 5): the parts of "Put the work on a task first" for one situation each moved to
       `kosmos task --how` (engine/taskguide.js), and a running agent was told its 47 lines no longer apply. Unlike the
       community routine, the working rules apply to every agent, so the one condition is that the new file still has
       that heading: a person who deleted the section did drop it, and the plain diff says so. */
    let movedTask = null;
    try {
      const taskHead = (require('./defaults').sections().find((x) => x.heading === '### Put the work on a task first') || {}).heading;
      if (taskHead && got.text.split('\n').some((l) => l.replace(/\r$/, '') === taskHead)) {   // review 6: a CRLF file too
        const taskLines = require('./taskguide').guideText().split('\n').map((l) => l.trim()).filter((l) => l !== '');
        movedTask = { under: taskHead, lines: new Set(taskLines), where: 'kosmos task --how' };
      }
    } catch { movedTask = null; }
    /* kosmos#8735 slice 3, item 1: doctrine 54 took two repeats out of "Answering the person who messaged you"; the rule
       they stated is in "Answering where you were asked", reworded. No rule line is left out (an empty set): the removed lines
       stay marked, and the note says where the rule may be. Only for that removal: the agent's last-read copy holds the
       first v53 line, and the new file has both headings. */
    let movedAnswer = null;
    try {
      const PERSON_HEAD = '### Answering the person who messaged you';
      const V53_REPEAT = '**Answering in your own session sends nothing.** It looks like a finished';
      const lineSet = (t) => new Set(String(t).split('\n').map((l) => l.replace(/\r$/, '')));
      const was = lineSet(seen);
      const now = lineSet(got.text);
      if (was.has(V53_REPEAT) && !now.has(V53_REPEAT) && now.has(PERSON_HEAD) && now.has('### Answering where you were asked')) {
        movedAnswer = { under: PERSON_HEAD, lines: new Set(), where: 'the section "Answering where you were asked", earlier in this file' };
      }
    } catch { movedAnswer = null; }
    /* kosmos#8735 (doctrine 55): "Where the files you make go" kept only what the Files block does not say; the rest is
       in that block, reworded. The same form as the entry above: nothing hidden, a note, only for that removal (the
       last-read copy holds the first v54 line) and only while the new file has that heading and one whole Files block. */
    let movedFiles = null;
    try {
      const FILES_HEAD = '### Where the files you make go';
      const V54_FIRST = '**Work you do for a project goes in that project\u2019s folder. A file you make';
      const lineSet = (t) => new Set(String(t).split('\n').map((l) => l.replace(/\r$/, '')));
      const was = lineSet(seen);
      const now = lineSet(got.text);
      const dm = require('./dmfiles');
      const blk = projectsMod ? projectsMod.findBlock(got.text, dm.START, dm.END) : null;
      // The note names the Files block's heading, so that heading must be in the file, inside one whole block.
      const named = blk && !blk.ambiguous && now.has(String(dm.blockBody('x')).split('\n')[0]);
      if (was.has(V54_FIRST) && !now.has(V54_FIRST) && now.has(FILES_HEAD) && named) {
        movedFiles = { under: FILES_HEAD, lines: new Set(), where: 'the section "Where to save files you make for the person", in this file' };
      }
    } catch { movedFiles = null; }
    /* kosmos#8735 (doctrine 56): the claim protocol's cases moved from "Answering where you were asked" to `kosmos claim
       --how` (engine/claimguide.js), most lines word for word, so those are left out as moved, as the task guide's are.
       Only for that move: the last-read copy holds a v55-only claim line and the new file does not, and the new file
       still has that heading. The section also holds the rules for posting and reacting, so a later change to one of
       those must not be pointed at the claim guide. */
    let movedClaim = null;
    try {
      const V55_CLAIM_ONLY = 'did not answer, run the same claim again; if it still cannot be reached, say in';
      const claimLineSet = (t) => new Set(String(t).split('\n').map((l) => l.replace(/\r$/, '')));
      const claimWas = claimLineSet(seen);
      const claimNow = claimLineSet(got.text);
      const claimHead = (require('./defaults').sections().find((x) => x.heading === '### Answering where you were asked') || {}).heading;
      if (claimHead && claimNow.has(claimHead) && claimWas.has(V55_CLAIM_ONLY) && !claimNow.has(V55_CLAIM_ONLY)) {
        const claimLines = require('./claimguide').guideText().split('\n').map((l) => l.trim()).filter((l) => l !== '');
        movedClaim = { under: claimHead, lines: new Set(claimLines), where: 'kosmos claim --how' };
      }
    } catch { movedClaim = null; }
    /* kosmos#8735 slice 4 (doctrine 61): the render list moved from "Send readable messages" to `kosmos post --how`
       (engine/postguide.js), word for word, so those lines are left out as moved, as the claim guide's are. Only for
       that move: the last-read copy holds the old list's first line and the new file does not. */
    let movedPost = null;
    try {
      const V60_POST_ONLY = '**What a room shows you:** short paragraphs with a blank line between them,';
      const postLineSet = (t) => new Set(String(t).split('\n').map((l) => l.replace(/\r$/, '')));
      const postWas = postLineSet(seen);
      const postNow = postLineSet(got.text);
      const postHead = (require('./defaults').sections().find((x) => x.heading === '### Send readable messages, not a wall of text') || {}).heading;
      if (postHead && postNow.has(postHead) && postWas.has(V60_POST_ONLY) && !postNow.has(V60_POST_ONLY)) {
        const postLines = require('./postguide').guideText().split('\n').map((l) => l.trim()).filter((l) => l !== '');
        movedPost = { under: postHead, lines: new Set(postLines), where: 'kosmos post --how' };
      }
    } catch { movedPost = null; }
    /* kosmos#8735 slice 5 (doctrine 62, review 1): "You do not stop" dropped the --held detail and "Kosmos sees every other
       state for itself". Both still hold: `kosmos report --help` prints the first, "And tell the board" says the second.
       Nothing is hidden (an empty set, as doctrine 54's movedAnswer); the note says where they are, only for that removal
       (the last-read copy holds the v61 line and the new file does not) and only while the section is there. */
    let movedHeld = null;
    try {
      const V61_SEES = '**Kosmos sees every other state for itself. It cannot see blocked or needs_you**,';
      const heldLineSet = (t) => new Set(String(t).split('\n').map((l) => l.replace(/\r$/, '')));
      const heldWas = heldLineSet(seen);
      const heldNow = heldLineSet(got.text);
      const stopHead = (require('./defaults').sections().find((x) => x.heading.startsWith('### You do not stop')) || {}).heading;
      if (stopHead && heldNow.has(stopHead) && heldWas.has(V61_SEES) && !heldNow.has(V61_SEES)) {
        movedHeld = { under: stopHead, lines: new Set(), where: '`kosmos report --help` and the rest of that section' };
      }
    } catch { movedHeld = null; }
    const diff = changedLines(seen, got.text, [moved, movedTask, movedAnswer, movedFiles, movedClaim, movedPost, movedHeld]);
    // A path with a double quote is not named: the #5304 reader takes quoted text in the line for section headings.
    // Review 2: nor one with whitespace or a control character, which would make the unquoted path in the line ambiguous.
    if (!diff || !p || /["\s\u0000-\u001f\u007f]/.test(p)) return none();
    /* kosmos#8912 slice 2: each notice is its own entry, numbered, under the earlier ones since the agent's last session
       start, so a notice whose turn never read the file (a limit, say) is not replaced by the next one. `previous` is the
       file as it was, so a line that does not land puts it back (restoreChanges) rather than deleting earlier entries. */
    const previous = readOwnChanges(session, p);
    let earlier = previous === null ? [] : entriesOf(previous);
    const kept = readBody(session);
    const notice = Math.max(earlier.length ? earlier[earlier.length - 1].n : 0, kept ? kept.notice : 0) + 1;
    const entry = '## Notice ' + notice + ', written ' + noticeStamp(now) + '\n' + diff + '\n\n';
    const compose = (list) => {
      const firstKept = list.length ? list[0].n : notice;
      const gone = firstKept > 1
        ? (firstKept === 2 ? 'Notice 1 is' : 'Notices 1 to ' + (firstKept - 1) + ' are') + ' no longer in this file. If you did not read '
          + (firstKept === 2 ? 'it' : 'them') + ', read the sections ' + (firstKept === 2 ? 'its notice' : 'their notices') + ' named in full.\n\n'
        : '';
      return CHANGES_HEADER + gone + list.map((e) => e.text).join('') + entry;
    };
    // The bound counts the whole file (review 1): the header and the removed note too.
    let body = compose(earlier);
    while (earlier.length && Buffer.byteLength(body) > CHANGES_FILE_MAX) { earlier = earlier.slice(1); body = compose(earlier); }
    // Review 1 BLOCKER (kosmos#7149): through securewrite, so a link planted in the agent's folder is never followed; 0600.
    require('./securewrite').writeSecret(p, body, 0o600, { atomicOnly: true, ownTempsOnly: true });
    rememberBody(session, body, notice);
    return { text: got.text, path: p, notice, previous, wrote: body, carried: earlier.length > 0 };
  } catch { return null; }
}

/* kosmos#8416: a notice named six sections to re-read when none had changed and one was not in the agent's file. A
   section is owed when Kosmos rewrites its block, and a rewrite can leave the words as they were (a board-start sweep
   writes every block), so at delivery each owed section is checked against the file (trueSections, below): it is named
   only when it is in the file now and its fingerprint differs from the mark of what the agent was last told about it. */
function headingsOf(section) {
  if (section === 'rules') {
    try { return require('./defaults').sections().map((x) => String(x.heading).replace(/^#{1,6}\s+/, '').trim()).filter(Boolean); } catch { return null; }
  }
  if (!Object.prototype.hasOwnProperty.call(SECTIONS, section)) return null;
  const words = section === 'policy' ? policySection() : SECTIONS[section];
  const titles = [...String(words).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return titles.length ? titles : null;
}
/* Pure: the text under the heading titled `title` (from its heading line to the next heading of its level or higher,
   outside fenced code), or null when the text has no such heading. */
function sectionBody(text, title) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  let fence = null;
  let level = 0;
  let out = null;
  for (const line of lines) {
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (f && fence === null) fence = f[1];
    else if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
    else if (fence === null) {
      const h = /^(#{1,6}) +(.*?) *#* *$/.exec(line);
      if (h) {
        if (out !== null && h[1].length <= level) return out.join('\n');
        if (out === null && h[2] === title) { level = h[1].length; out = []; continue; }
      }
    }
    if (out !== null) out.push(line);
  }
  return out === null ? null : out.join('\n');
}
/* Each section's own block markers (engine/projects.js), so a heading the person or company wrote inside a
   block (an AI policy's "## Data handling", an About-you answer) never ends it early, and a heading of the same name
   elsewhere in the file never stands in for it. */
function markersOf(section) {
  const p = require('./projects');
  const pairs = {
    projects: [[p.BLOCK_START, p.BLOCK_END]], you: [[p.YOU_START, p.YOU_END]], reports: [[p.REPORTS_START, p.REPORTS_END]],
    connections: [[p.CONNECTIONS_START, p.CONNECTIONS_END]], dmfiles: [[p.DMFILES_START, p.DMFILES_END], [p.DMFILES_TOP_START, p.DMFILES_TOP_END]],
    policy: [[p.POLICY_START, p.POLICY_END]], rules: [[p.DOCTRINE_START, p.DOCTRINE_END]], community: [[p.COMMUNITY_START, p.COMMUNITY_END]],
    language: [[p.LANGUAGE_START, p.LANGUAGE_END]],
  }[section];
  return Array.isArray(pairs) && pairs.every((x) => typeof x[0] === 'string' && x[0] && typeof x[1] === 'string' && x[1]) ? pairs : null;
}
/* The section's block text in `text`: { found: text } when its markers pair, { ambiguous: true } when they cannot be
   paired safely (projects.findBlock refuses), or null when the file has none of them. */
function blockOf(text, section) {
  const pairs = markersOf(section);
  if (!pairs) return null;
  const find = require('./projects').findBlock;
  const parts = [];
  const t = String(text == null ? '' : text);
  for (const [a, b] of pairs) {
    const got = find(t, a, b);
    if (got && got.ambiguous) return { ambiguous: true };
    if (got) parts.push(t.slice(got.start, got.end));
    // A pair with a lone marker is a damaged part of the block (dmfiles has two pairs): it cannot be told.
    else if (t.includes(a) || t.includes(b)) return { ambiguous: true };
  }
  return parts.length ? { found: parts.join('\n') } : null;
}
/* A section's fingerprint in `text` (pure but for the heading names, read from defaults and the policy kind): a hash of its block (or, with no markers for it, of the text under its
   heading), null when the file does not have it, or 'unknown' when it cannot be told (markers that do not pair). */
function printOf(text, sec) {
  const hash = (t) => require('node:crypto').createHash('sha256').update(String(t).replace(/\r\n?/g, '\n')).digest('hex').slice(0, 16);
  let block = null;
  try { block = blockOf(text, sec); } catch { return 'unknown'; }
  if (block && block.ambiguous) return 'unknown';
  if (block) return hash(block.found);
  // A backstop (blockOf already answers ambiguous for a lone marker): one of its markers with no pair is a damaged
  // block, not a missing one.
  const pairs = markersOf(sec) || [];
  if (pairs.some(([a, b]) => String(text).includes(a) || String(text).includes(b))) return 'unknown';
  const titles = headingsOf(sec);
  if (!titles) return 'unknown';
  // A heading written twice (the person's own and Kosmos's, with no markers) cannot tell which is which.
  if (titles.some((t) => headingCount(text, t) > 1)) return 'unknown';
  const bodies = titles.map((t) => sectionBody(text, t));
  return bodies.every((b) => b === null) ? null : hash(titles.map((t, k) => t + '\n' + (bodies[k] === null ? '' : bodies[k])).join('\n'));
}
/* Pure: how many times a heading titled `title` appears outside fenced code. */
function headingCount(text, title) {
  let n = 0;
  let fence = null;
  for (const line of String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (f && fence === null) fence = f[1];
    else if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
    else if (fence === null) { const h = /^(#{1,6}) +(.*?) *#* *$/.exec(line); if (h && h[2] === title) n += 1; }
  }
  return n;
}
/* The owed sections worth naming (pure but for printOf's heading names), given the file now and the fingerprints of what the agent was last told (marks:
   { section: print }, or null when Kosmos holds none for it). The marks move only for a section the agent was
   told about (or read whole at a session start), so a block rewritten after a line landed, and owed later, still differs
   from its mark. A section not in the file now is not named: a block Kosmos removed owes nothing (oweEach's rule, there
   is no section left to read; the agent drops it at its next start). */
function trueSections(sections, now, marks) {
  return (Array.isArray(sections) ? sections : []).filter((sec) => {
    const p = printOf(now, sec);
    if (p === 'unknown') return true;   // cannot tell: named, as before
    if (p === null) return false;       // not in the file
    if (!marks || typeof marks !== 'object' || typeof marks[sec] !== 'string') return true;   // never marked: named
    return marks[sec] !== p;
  });
}
function marksFile() { return path.join(require('./store').ROOT, 'instruction-reread-marks.json'); }
function readMarks() {
  try {
    const d = JSON.parse(fs.readFileSync(marksFile(), 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }
}
function writeMarks(all) {
  try { require('./store').saveFlushed(marksFile(), JSON.stringify(all) + '\n'); return true; } catch { return false; }
}
/* The agent was just told about `sections` (or read its whole file): their marks become their prints in `text`. A
   section not in the text loses its mark. Never throws. */
function markRead(session, sections, text) {
  try {
    if (!session || typeof text !== 'string') return false;
    const all = readMarks();
    const cur = all[session] && typeof all[session] === 'object' ? { ...all[session] } : {};
    for (const sec of Array.isArray(sections) ? sections : []) {
      if (!Object.prototype.hasOwnProperty.call(SECTIONS, sec)) continue;
      const p = printOf(text, sec);
      if (typeof p === 'string' && p !== 'unknown') cur[sec] = p; else delete cur[sec];
    }
    all[session] = cur;
    return writeMarks(all);
  } catch { return false; }
}
/* Drop the marks of `sections` (every section when none are given). Not knowing what the agent read is no mark, never
   an old one: an old mark can equal the file again later (a change undone), and that change would go unnamed. */
function forgetMarks(session, sections) {
  // When the file cannot be read or written, every mark goes (the whole file): more notices, never a hidden change.
  const dropAll = () => { try { fs.unlinkSync(marksFile()); } catch { /* none there, or the disk refuses everything */ } };
  try {
    let all;
    try { all = JSON.parse(fs.readFileSync(marksFile(), 'utf8')); } catch (e) { if (e && e.code === 'ENOENT') return; dropAll(); return; }
    if (!all || typeof all !== 'object' || Array.isArray(all)) { dropAll(); return; }
    if (!all[session]) return;
    if (Array.isArray(sections)) { const cur = { ...all[session] }; for (const sec of sections) delete cur[sec]; all[session] = cur; }
    else delete all[session];
    if (!writeMarks(all)) dropAll();
  } catch { dropAll(); }
}
/* The default for passOnce's trueSections: null (name them all, as before) when the file cannot be read. */
function trueSectionsFor(session, sections) {
  try {
    const got = require('./instructions').read(session);
    if (!got || got.exists !== true || typeof got.text !== 'string') return null;
    // A file with no Kosmos block and none of the sections Kosmos writes is empty or half-written: it cannot be told.
    if (!got.text.includes('<!-- kosmos:') && Object.keys(SECTIONS).every((sec) => printOf(got.text, sec) === null)) return null;
    const all = readMarks();
    const marks = all[session] || null;
    const out = trueSections(sections, got.text, marks);
    /* A section gone from the file loses its mark, so if it comes back with the same words it is named then. */
    if (marks) {
      const gone = (Array.isArray(sections) ? sections : []).filter((sec) => typeof marks[sec] === 'string' && printOf(got.text, sec) === null);
      if (gone.length) { const cur = { ...marks }; for (const sec of gone) delete cur[sec]; all[session] = cur; writeMarks(all); }
    }
    return out;
  } catch { return null; }
}

/* The one line for an agent's debt, naming every section it owes. */
function lineFor(sections, { communityStopped = false, changesAt = null, notice = null, carried = false } = {}) {
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
        + 'its new text applies the next time you take part. '
        /* kosmos#8735 review 1: since the routine moved to the guide, a line about HOW to take part that left this section
           is printed by `kosmos community --how`, so the notice says where to read it. The changes file leaves such a line out as moved
           (kosmos#8743, changedLines), and the file's header and this clause both say a - line no longer applies unless a Left out
           note in it says where it went. */
        + 'How to take part (the steps, the commands, what to do when something is held) is printed by kosmos community --how: '
        + 'read it there before you next take part. ';
  // kosmos#7149: where the changed lines are, so the agent need not re-read a long block to find a short change.
  const changes = typeof changesAt === 'string' && changesAt
    ? 'To help you find what changed, the changed lines are listed in ' + changesAt
      // kosmos#8912 slice 2: the entry this notice is about, so an agent can tell whether it has read it.
      + (Number.isSafeInteger(notice) && notice > 0 ? ', under Notice ' + notice : '')
      + ' (a pointer only: still read the sections themselves; a line it marks + elsewhere is current too, and a line it marks - no longer applies, unless a note in it says where it went). '
      // Round 4: only when the file holds earlier entries (after a dropped or deleted file it holds none, and says so).
      + (Number.isSafeInteger(notice) && notice > 1 && carried === true ? 'The entries above Notice ' + notice + ' in that file are earlier notices since you started: read one only if you have not. ' : '')
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
 *   trueSections(s, sections) kosmos#8416: the sections still worth naming (trueSectionsFor); none ends the debt with no line
 *   markRead(s, sections, text) / readText(s) / forgetMarks(s, sections)   kosmos#8416: a PLACED line moves the named
 *                             sections' marks; an unconfirmed one drops them
 *   read()/write(owed)        the debt file (readOwed / writeOwed by default)
 * Returns [{ session, act }] for the log: 'sent' | 'kept' | 'not-idle' | 'stood-down' | 'section-off' | 'missing' | 'restarted' | 'gone' | 'expired' | 'unchanged'.
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
      /* kosmos#8416: only the sections that are in the file and changed are named; none left ends the debt without a line
         (the agent's copy is unchanged, so the next notice still diffs against what it read). */
      let real = debt.sections;
      if (typeof o.trueSections === 'function') {
        let got = null;
        try { got = o.trueSections(session, debt.sections); } catch { got = null; }
        if (Array.isArray(got)) real = debt.sections.filter((sec) => got.includes(sec));
      }
      if (!real.length) { end(session, 'unchanged'); continue; }
      const on = typeof o.sectionOn === 'function' ? real.filter((sec) => { try { return o.sectionOn(sec) === true; } catch { return false; } }) : real;
      if (!on.length) { out.push({ session, act: 'section-off' }); continue; }
      const off = real.filter((sec) => !on.includes(sec));   // stay owed after a line for the others lands
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
      const line = lineFor(on, { communityStopped: stoppedNow, changesAt: prepared && prepared.path, notice: prepared && prepared.path ? prepared.notice : null, carried: !!(prepared && prepared.path && prepared.carried) });
      /* kosmos#8416: the text the line is about, read before it is typed, so a block rewritten while it is sent keeps
         its old mark and is named when it is owed. */
      let toldText = prepared && typeof prepared.text === 'string' ? prepared.text : null;
      const toldAt = Date.now();   // a session start after this marked everything from a newer file
      if (toldText === null && typeof o.readText === 'function') { try { const t = o.readText(session); toldText = typeof t === 'string' ? t : null; } catch { toldText = null; } }
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
        /* kosmos#8912 slice 2: only this notice's entry goes; the earlier ones were named by lines that landed. A caller
           with no restoreChanges drops the whole file, as before. */
        if (prepared && prepared.path && typeof o.restoreChanges === 'function') { try { o.restoreChanges(session, prepared.previous, prepared.wrote); } catch { /* the next start removes it */ } }
        else if (prepared && prepared.path && typeof o.dropChanges === 'function') { try { o.dropChanges(session); } catch { /* the next start removes it */ } }
      }
      else {
        end(session, 'sent');
        if (off.length) keep[session] = { at: debt.at, last: debt.last, n: 1, sections: off };
        if (typeof o.recordSent === 'function') { try { o.recordSent(session, sentAt); } catch { /* only the turn's label is lost */ } }
        // kosmos#8416: only the sections this line named move their marks.
        /* A line known to be typed (PLACED) moves the named sections' marks. One that may or may not have reached the
           agent (UNCONFIRMED), or a PLACED one whose text is not known, drops them: what the agent read is unknown, so
           the next notice names them whatever their words. */
        const placed = v && o.DELIVERY && v.state === o.DELIVERY.PLACED;
        let marked = false;
        // A session start recorded while the line was sent marked every section from a newer file: leave those marks.
        let restartedSince = false;
        try { restartedSince = startedSince(o.history(session), toldAt) === true; } catch { restartedSince = false; }
        if (restartedSince) marked = true;
        else if (placed && toldText !== null && typeof o.markRead === 'function') { try { marked = o.markRead(session, on, toldText) === true; } catch { marked = false; } }
        // A mark that could not be saved is dropped too, never left old.
        if (!marked && typeof o.forgetMarks === 'function') { try { o.forgetMarks(session, on); } catch { /* the next notice names them again */ } }
        /* kosmos#7149: the agent reads the file now, so this is what it last read (the next diff starts here). kosmos#8416:
           not when a section was owed again while this pass ran (its n moved): the text read above may already
           hold that change, which the line did not name, and the next changes file would then leave it out. The
           next diff is then wider, never narrower. */
        let owedAgain = true;
        try { const latest = typeof o.read === 'function' ? read() : readOwedStrict(); owedAgain = !latest || !!(latest[session] && latest[session].n !== debt.n); } catch { owedAgain = true; }
        if (!owedAgain && prepared && typeof prepared.text === 'string' && typeof o.remember === 'function') { try { o.remember(session, prepared.text); } catch { /* the next diff is wider */ } }
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

module.exports = { startedUnrecorded, forgetBody, CHANGES_LINES_MAX, CHANGES_BYTES_MAX, trueSections, trueSectionsFor, sectionBody, markRead, readMarks, forgetMarks, printOf, changedLines, prepareChanges, restoreChanges, entriesOf, remember, rememberRead, forget, dropChanges, readSeen, GIVE_UP_MS, MAX_PER_PASS, SECTIONS, file, readOwed, readOwedStrict, writeOwed, owe, oweNow, settle, startedSince, mergeCleared, oweChanged, oweEach, lineFor, passOnce, recordSent, sentTimes, sentFile };
