'use strict';
/**
 * kosmos#6506: the facts a `kosmos handoff` prints so an agent whose context is
 * filling up does not reconstruct them by hand (and get them stale). FACTS ONLY:
 * this module measures and renders; it writes nothing and changes no state. The
 * agent still writes its own judgement, deliberate gaps and review notes; this
 * fills only what it can measure.
 *
 * The output is Markdown shaped to drop into the SAME per-agent handoff file the
 * board's "Write a handoff, then restart" flow uses (engine/autohandoff-sweep.js
 * handoffPathFor), not a second location (#3492). The handoff CONTRACT is reused
 * verbatim from engine/autohandoff.js HANDOFF_CONTENTS, so there is no second
 * copy of that list to drift (the codebase's most-shipped defect).
 *
 * The four measured facts (the card's scope ruling), and why each is honest:
 *   - the agent's live state, from engine/selfreport.js. A missing report reads
 *     "never reported", NEVER a default "idle" (selfreport's six states are
 *     started/working/idle/needs_you/blocked/stopped; absence is a seventh thing,
 *     not the third). The assigned-task LIST is deferred (card ruling 2): there
 *     is no agent-token route for "all my tasks", so the self-report is the task
 *     state a handoff can measure.
 *   - when the instruction file last changed, from engine/instructions.js
 *     staleness().editedAt. A bad or epoch mtime reads "cannot tell", never 1970.
 *   - a fingerprint (engine/fileprint.js) for each artifact path the agent names, honest about a missing,
 *     directory or unreadable path (it says which), with paths kept intact so a
 *     path with spaces is never split.
 *   - whether the current folder is a git repository: "not a git repository" is
 *     printed ONLY when that is the real answer, kept distinct from git being
 *     absent and from git erroring.
 *
 * Every read is fail-soft and local (no board, no network): a handoff is often
 * written when the board is busy, so a fact that cannot be read says so rather
 * than throwing. The requires are lazy and guarded for the same reason -- a
 * partial install degrades one fact, it does not crash the command.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { fingerprint, plain, firstLine } = require('./fileprint');   // #6849: the shared fingerprint

/* A sane calendar year floors "cannot tell": an mtime at or before the epoch, or
 * one that does not parse, is not a date to show (#6506 axis 3: never 1970). */
const MIN_SANE_YEAR = 2000;

function iso(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/* An ISO timestamp only when the time is believable: at or after MIN_SANE_YEAR and not in
 * the future beyond a day's slack for clock skew. A zero or epoch time, a parse failure, or
 * a clock-skewed future time returns null, so the caller prints "cannot tell" rather than a
 * 1970 or a 2099 date. The future bound is not hypothetical: the fleet has measured agents
 * writing timestamps ahead of the real clock. */
function saneIso(ms, now) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (new Date(ms).getUTCFullYear() < MIN_SANE_YEAR) return null;
  const ceiling = (Number.isFinite(now) ? now : Date.now()) + 24 * 60 * 60 * 1000;
  if (ms > ceiling) return null;
  return iso(ms);
}

/* A path safe to echo inside a Markdown code span. The output is pasted into the handoff
 * file, so a path carrying a newline (filenames may) would otherwise inject arbitrary lines
 * into it, and a backtick would close the span early. Control characters are stripped and a
 * backtick is neutralised; the path stays recognisable. The RAW path is still what the fs
 * calls use, so this only touches what is shown. */
function cleanPath(p) {
  // Filtered by code point rather than a regex literal: the characters to strip include line
  // terminators (LF, CR, U+2028, U+2029), which cannot appear literally in a regex literal, and
  // building the class with escapes is fragile across encoders. Each control or C1 character and
  // each line/paragraph separator becomes a space; a backtick becomes an apostrophe so it cannot
  // close the Markdown code span early.
  let out = '';
  for (const ch of String(p == null ? '' : p)) {
    const c = ch.codePointAt(0);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) out += ' ';
    else if (ch === '`') out += "'";
    else out += ch;
  }
  return out;
}

/* Run git read-only, returning { ok, out } or { ok:false, code, stderr }. Never
 * throws: a missing binary is reported as code 'ENOENT'.
 *
 * LC_ALL/LANG=C so git's messages are English: the "not a git repository" and
 * "no commits yet" answers below are told apart by matching git's own text, and
 * under a translated locale the real answers would fall through to "git could not
 * read this folder", breaking the distinction the card asks for. A 10s timeout and
 * a generous maxBuffer so a slow or large work tree degrades to an honest "state
 * unknown" rather than hanging a command an agent runs when it is already under
 * pressure; GIT_OPTIONAL_LOCKS=0 so a status read never waits on a lock. */
function runGit(cwd, args) {
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', GIT_OPTIONAL_LOCKS: '0' },
    });
    return { ok: true, out: String(out) };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, code: 'ENOENT' };
    return { ok: false, code: (e && e.status) || null, stderr: String((e && e.stderr) || (e && e.message) || '') };
  }
}

/**
 * The repository fact for a folder. Four distinct answers (#6506 axis 4):
 *   - git is not installed
 *   - not a git repository (the real negative answer)
 *   - git could not read this folder (some other git failure)
 *   - branch + sha (+ clean/dirty) when it is a work tree
 */
function gitFact(cwd) {
  const inside = runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok) {
    if (inside.code === 'ENOENT') return 'git is not installed, so the repository state could not be read';
    if (/not a git repository/i.test(inside.stderr || '')) return 'not a git repository';
    const why = firstLine(inside.stderr);
    return 'git could not read this folder' + (why ? ': ' + why : '');
  }
  if (inside.out.trim() !== 'true') return 'inside a git directory but not a work tree';

  const head = runGit(cwd, ['rev-parse', 'HEAD']);
  if (!head.ok) {
    // A repository with no commits yet: rev-parse HEAD fails with "unknown revision".
    if (/unknown revision|ambiguous argument 'HEAD'|needed a single revision/i.test(head.stderr || '')) {
      return 'a git repository with no commits yet';
    }
    const why = firstLine(head.stderr);
    return 'a git repository, but its HEAD could not be read' + (why ? ': ' + why : '');
  }
  const sha = head.out.trim();
  const br = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = br.ok ? br.out.trim() : '';
  const dirty = runGit(cwd, ['status', '--porcelain']);
  const state = dirty.ok ? (dirty.out.trim() ? 'uncommitted changes present' : 'clean') : 'working-tree state unknown';

  let where;
  if (!br.ok) where = 'HEAD (branch could not be read)';        // not the same as detached: the read itself failed
  else if (!branch || branch === 'HEAD') where = 'detached HEAD';
  else where = 'branch `' + branch + '`';
  return where + ' at `' + sha + '`, ' + state;
}

/* The fingerprint, or an honest reason, for one artifact path (#6506 axis 5): engine/fileprint.js since #6849, the
   one `kosmos task built --file` and `kosmos fingerprint` give, so a PDF re-rendered from the same source matches. */
/* #7213: a PDF's fingerprint (pdf-normalized:) is not what shasum prints, and an approval usually cites a plain sha256,
   so the line gives both, each labelled, and a reader compares like with like. */
function artifactPrint(p) {
  const fp = fingerprint(p);
  if (!fp.startsWith('pdf-normalized:')) return fp;
  const raw = plain(p);
  return fp + ' (plain ' + (raw.startsWith('sha256:') ? raw : 'sha256 ' + raw) + ')';
}

/** The agent's live state from the self-report, "never reported" when absent
 * (#6506 axis 2). Never defaults to idle. */
function stateFact(session, now) {
  if (!session) return 'cannot tell which agent this is (no session), so no self-report was read';
  let self;
  try {
    self = require('./selfreport');
  } catch (e) {
    return 'could not load the self-report reader (' + firstLine(e && e.message) + ')';
  }
  let r;
  try {
    r = self.read(session);
  } catch (e) {
    return 'could not read the self-report (' + firstLine(e && e.message) + ')';
  }
  if (!r || !r.found) {
    // A genuinely never-reported agent reads "never reported" (selfreport's own NEVER_REPORTED
    // `because` already says "it has never reported", so it is not doubled). A record that EXISTS
    // but could not be read is NOT "never reported" (#6532 Raiden note 1): say so, still inventing
    // no state.
    const never = (self.NO_READING && self.NO_READING.NEVER_REPORTED) || '';
    const unreadable = (self.NO_READING && self.NO_READING.UNREADABLE) || '';
    const because = r && typeof r.because === 'string' ? r.because : '';
    if (!because || because === never) return 'never reported';
    // The UNREADABLE sentinel ("could not read its self-report") carries no detail, so its parenthetical
    // would only echo this prefix; append a because only when it adds something (e.g. a thrown error).
    return because === unreadable ? 'could not read the self-report' : 'could not read the self-report (' + because + ')';
  }
  const parts = [String(r.state || 'reported, state unknown')];
  if (typeof r.because === 'string' && r.because) parts.push(r.because);
  if (typeof r.on === 'string' && r.on) parts.push('on ' + r.on);
  if (typeof r.owner === 'string' && r.owner) parts.push('owner ' + r.owner);
  if (typeof r.until === 'string' && r.until) parts.push('until ' + r.until);
  const when = saneIso(Date.parse(r.at), now);   // same 1970/future floor as the instruction time: never print a bad date
  if (when) {
    parts.push('as of ' + when);
    /* kosmos#6593 item 2 (Josh's five-model reports on 0.7.59 and 0.7.60): GPT and Grok runners do not report working,
       so the last hand-written state stays, and a line from two weeks back read like the present. The age is said in
       words, and past a day the line says it may not describe now. Kept, not dropped: an old state is still a fact the
       reader can weigh, and leaving it out would read as "never reported". */
    const age = (Number.isFinite(now) ? now : Date.now()) - Date.parse(r.at);
    const said = agoWords(age);
    if (said) parts.push(age >= STALE_REPORT_MS ? said + ', so it may not describe what the agent is doing now' : said);   // from a full day on: so "a day ago" always carries it
  } else if (r.at) parts.push('reported at a time that cannot be read');
  return parts.join('; ');
}

/* #6593: a self-report older than this is said to be old. A day: a working session reports far more often than that,
   so an older line is the leftover of an earlier one. */
const STALE_REPORT_MS = 24 * 60 * 60 * 1000;
/* The age in plain words; '' for a time in the future (clock skew, which saneIso already bounds to a day). */
function agoWords(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min === 1 ? 'a minute ago' : min + ' minutes ago';
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : h + ' hours ago';
  const d = Math.floor(h / 24);
  return d === 1 ? 'a day ago' : d + ' days ago';
}

/** When the instruction file last changed, its sha256 version, and whether the
 * running agent is on an edited copy. A bad or epoch mtime reads "cannot tell"
 * (#6506 axis 3). Returns { file, line }. */
function instructionFact(session, now, exactSession) {
  if (!session) return { file: null, line: 'cannot tell which agent this is (no session), so the instruction file was not read' };
  let instr;
  try {
    instr = require('./instructions');
  } catch (e) {
    return { file: null, line: 'could not load the instructions reader (' + firstLine(e && e.message) + ')' };
  }
  let file = null;
  try {
    file = instr.fileFor(session);
  } catch (_) {
    file = null;
  }
  let st;
  try {
    // exactSession is the agent's real tmux session (what the roster passes as card.session), so the
    // STALE/current freshness line is reliable when the tmux session name differs from the sessionName
    // (#6532 Raiden note 2). When the CLI cannot resolve it, undefined lets staleness fall back to the
    // name-derived spellings. `session` (the sessionName) is still the agent key for the file itself.
    st = instr.staleness(session, null, exactSession);
  } catch (e) {
    return { file, line: 'could not read the instruction file (' + firstLine(e && e.message) + ')' };
  }
  st = st || {};
  const when = saneIso(st.editedAt ? Date.parse(st.editedAt) : NaN, now);

  const bits = [];
  if (when) bits.push('last changed ' + when);
  else bits.push('cannot tell when it last changed' + (st.because ? ' (' + st.because + ')' : ''));
  if (typeof st.version === 'string' && st.version) bits.push('version ' + st.version);
  if (st.state === 'stale') bits.push('STALE: edited since this agent started, so a restart is needed to re-read it');
  else if (st.state === 'current') bits.push('current with this agent');
  else if (st.state === 'unknown') bits.push('freshness unknown');
  return { file, line: bits.join('; ') };
}

/** The per-agent handoff file the board's restart flow uses, so the agent pastes
 * into the one place both features read. Null when it cannot be computed. */
function handoffPath(session) {
  if (!session) return null;
  try {
    const store = require('./store');
    const sweep = require('./autohandoff-sweep');
    return sweep.handoffPathFor(store, session);
  } catch (_) {
    return null;
  }
}

/** The shared handoff contract (engine/autohandoff.js HANDOFF_CONTENTS), reused
 * verbatim so there is no drifting copy (#6506 axis 1). */
function contractBullets() {
  try {
    const auto = require('./autohandoff');
    if (Array.isArray(auto.HANDOFF_CONTENTS)) return auto.HANDOFF_CONTENTS.slice();
  } catch (_) {
    /* fall through */
  }
  return null;
}

/* The open-tasks fact (kosmos#6506 ruling 3): the agent's own open tasks across its projects. This
 * is the ONE fact that needs the board, so the CLI makes the call (GET /api/tasks/mine, agent token)
 * and passes the response here as `resp` = { reached, status, body }. An unreachable board reads "the
 * board did not answer", NEVER an empty list; a refusal and an unreadable answer are each said as
 * themselves; a 200 yields the list (or "none open"). Returns { line, items }: when items is null,
 * print line; else print the items (or "none open" when empty). Board task fields are echoed through
 * cleanPath so a title with a control character cannot break the pasted handoff. */
function tasksFact(resp) {
  if (!resp) return { line: 'not checked (no board response)', items: null };
  if (resp.reached === false) return { line: 'the board did not answer, so your open tasks could not be read', items: null };
  const status = Number(resp.status);
  const body = resp.body && typeof resp.body === 'object' ? resp.body : null;
  if (status === 403) return { line: 'the board would not read them (' + cleanPath(String((body && body.error) || 'refused')) + ')', items: null };
  if (status !== 200 || !body || !Array.isArray(body.tasks)) return { line: 'the board gave an answer that could not be read (status ' + (Number.isFinite(status) ? status : '?') + ')', items: null };
  const items = body.tasks.map((raw) => {
    const t = raw || {};
    const proj = cleanPath(String(t.project != null ? t.project : (t.projectId != null ? t.projectId : '?')));
    const num = t.number != null ? '#' + cleanPath(String(t.number)) : '#?';   // defense in depth: clean every echoed field uniformly
    const title = cleanPath(String(t.title != null ? t.title : ''));
    return proj + ' ' + num + ': ' + title;
  });
  return { line: null, items };
}

/**
 * Render the handoff facts as Markdown. Pure of its environment except for the reads it is meant to
 * do: pass { session, cwd, artifacts, now, tasks } and it measures against those, so a test fully
 * controls the output. Defaults read the running environment, which is what the CLI wants. `tasks`
 * is the board response for the one non-local fact (see tasksFact); absent, it reads "not checked".
 */
function render(opts) {
  opts = opts || {};
  const session = typeof opts.session === 'string' ? opts.session : (process.env.KOSMOS_AGENT_SESSION || '');
  const cwd = opts.cwd || process.cwd();
  const artifacts = Array.isArray(opts.artifacts) ? opts.artifacts : [];
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const exactSession = typeof opts.exactSession === 'string' && opts.exactSession ? opts.exactSession : undefined;

  const lines = [];
  const stamp = iso(now) || new Date().toISOString();
  lines.push('<!-- Facts for your handoff, prefilled by `kosmos handoff` at ' + stamp + '. These are measured, not judged: write the rest yourself. This command changes nothing. -->');
  lines.push('');
  lines.push('# Handoff facts: ' + (session || 'this agent'));
  lines.push('');

  const hp = handoffPath(session);
  if (hp) {
    lines.push('Paste into: ' + cleanPath(hp));
    lines.push('');
  }

  const contract = contractBullets();
  lines.push('## What a handoff must cover');
  if (contract) {
    for (const b of contract) lines.push(b);
  } else {
    lines.push('- (the shared handoff contract could not be read on this install)');
  }
  lines.push('');

  lines.push('## Prefilled facts');
  lines.push('- Branch and sha (checked in `' + cleanPath(cwd) + '`): ' + gitFact(cwd));
  lines.push('- Live state (self-report): ' + stateFact(session, now));
  const tf = tasksFact(opts.tasks);
  if (tf.items === null) {
    lines.push('- Open tasks assigned to you (across your projects): ' + tf.line);
  } else if (tf.items.length === 0) {
    lines.push('- Open tasks assigned to you (across your projects): none open');
  } else {
    lines.push('- Open tasks assigned to you (across your projects):');
    for (const it of tf.items) lines.push('  - ' + it);
  }
  const instr = instructionFact(session, now, exactSession);
  lines.push('- Instruction file' + (instr.file ? ' (`' + cleanPath(instr.file) + '`)' : '') + ': ' + instr.line);
  if (artifacts.length) {
    lines.push('- Artifacts you named:');
    // The echoed path is cleaned so a newline in it cannot inject lines into the pasted
    // handoff; fingerprint() still uses the RAW path for the filesystem read.
    for (const p of artifacts) lines.push('  - `' + cleanPath(p) + '`: ' + artifactPrint(p));
  } else {
    lines.push('- Artifacts you named: none (pass artifact paths as arguments to fingerprint them)');
  }
  lines.push('');
  lines.push('Everything else in the contract above is yours to write; this command measures facts and changes nothing.');

  return lines.join('\n') + '\n';
}

module.exports = { render, gitFact, fingerprint, artifactPrint, stateFact, instructionFact, tasksFact, handoffPath, contractBullets, saneIso, cleanPath, MIN_SANE_YEAR };

/* Run as the CLI entry (install/kosmos cmd_handoff runs this file with the
 * artifact paths as arguments; the Windows CLI calls render directly). Session
 * and cwd come from the environment the agent invoked it in. Never throws out:
 * an unexpected failure prints one honest line and exits non-zero. */
if (require.main === module) {
  try {
    // cmd_handoff makes the one board call (GET /api/tasks/mine) and hands the response to this
    // process: the small scalars (reached, status) by env, and the task BODY on STDIN so it never
    // rides an environment variable that could grow (#6544 note). engine/handoff.js itself makes no
    // HTTP call. Absent env (an old caller) -> undefined -> tasksFact says "not checked".
    let tasks;
    if (process.env.KOSMOS_HANDOFF_TASKS_REACHED !== undefined) {
      let raw = '';
      try { raw = fs.readFileSync(0, 'utf8'); } catch (_) { raw = ''; }   // the tasks body, piped in on stdin (fs bound at top)
      let body = null;
      try { body = JSON.parse(raw || 'null'); } catch { body = null; }
      tasks = { reached: process.env.KOSMOS_HANDOFF_TASKS_REACHED === '1', status: Number(process.env.KOSMOS_HANDOFF_TASKS_STATUS || 0), body };
    }
    const exactSession = process.env.KOSMOS_HANDOFF_TMUX_SESSION || undefined;
    process.stdout.write(render({ artifacts: process.argv.slice(2), tasks, exactSession }));
  } catch (e) {
    process.stderr.write('kosmos handoff: could not gather the handoff facts (' + firstLine(e && e.message) + ')\n');
    process.exit(1);
  }
}
