'use strict';

/**
 * The agent's own account of what it is doing (#188's third verb; the
 * vocabulary and honesty rules are the 2026-08-24 comment on #253).
 *
 * Josh's 08-19 ruling said store every word and have the agent MARK it
 * rather than us parsing the pane. `kosmos msg` and `kosmos post` deliver,
 * `kosmos reply` records into a thread; this is the record for STATE:
 * `kosmos report <state>` appends one line here and delivers nothing.
 *
 * 🔑 SIX WORDS, A CLOSED LIST, exactly like notify.js's KINDS: started,
 * working, idle, needs_you, blocked, stopped. Four are already the board's
 * words (status.js STATE) and needs_you is already the phone's word
 * (notify.js KINDS), so a report teaches the board and the phone the same
 * fact with no translation layer. An unknown word is a writer's typo and is
 * skipped with one line to stderr on read, notify.js's posture for the same
 * mistake.
 *
 * ⚠️ THIS MODULE RECORDS AND READS; IT NEVER DECIDES STATE. What a fresh
 * report outranks, what a stale one decays to, and what the pane reader is
 * still trusted for are state decisions, and they live where state
 * decisions live: `status.reconcileReport`, beside STATE and CONFIDENCE.
 * Requiring status from here would also be a cycle, since status consults
 * this record.
 *
 * ⚠️ APPEND-ONLY, ONE FILE PER AGENT, keyed by the board name the sender
 * resolved to (store.safeKey'd: names come from tmux session names and are
 * untrusted in paths). The record is the fact; the reader reads a bounded
 * TAIL of it (a working agent heartbeats, so the file grows and the truth
 * is at the end -- and codexsession.js already paid for the lesson that
 * reading the wrong end of a log costs a bug).
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/* ⚠️ SIX WORDS, AND ONE OF THEM HAS ALMOST NO WRITER. A reader of a closed
   list assumes each word arrives the same way. `needs_you` does not: nearly
   every one in the record was written by the permission hook or by a
   walkthrough fixture, and the board's red state is load-bearing on the PANE
   READER rather than on this file (#1253, option 3). The measurement and the
   argument live at `status.js` rule 3 -- ONE copy, deliberately, because the
   number goes stale and three copies go stale separately. Re-run it with
   `node tools/needs-you-source.js`. */
const STATES = Object.freeze(['started', 'working', 'idle', 'needs_you', 'blocked', 'stopped']);

/* #900: the two words that mean A PERSON IS THE BLOCKER. They are the states
   `status.reconcileReport` already declines to decay, and they are the only
   ones an automatic writer may not erase. */
const WAITING_ON_A_PERSON = Object.freeze(['blocked', 'needs_you']);

const DIR = path.join(store.ROOT, 'selfreports');

/* The reader's window. 64KB holds hundreds of transitions; anything older
   is history the CURRENT state cannot depend on, because a `started` line
   resets the run and a run that big has heartbeats filling the tail. */
const TAIL_BYTES = 64 * 1024;

/* Field caps, so one runaway caller cannot turn the record into a dump.
   `because` is a sentence, not a transcript: the words live on this Mac
   (unlike notify.js's payload, which strips them before anything leaves),
   but a report is still a claim about state, not a place to store output. */
const CAPS = { because: 1000, on: 200, owner: 200, until: 100, project: 120, instance: 40 };

const NO_READING = {
  NEVER_REPORTED: 'it has never reported',
  UNREADABLE: 'could not read its self-report',
};

function fileFor(sessionName) {
  return path.join(DIR, store.safeKey(sessionName) + '.jsonl');
}

function capped(value, cap) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/[\n\t\r]/g, ' ').trim();
  return s ? s.slice(0, cap) : null;
}

/**
 * Append one transition. Returns { recorded, at } or { recorded:false,
 * because } in a sentence, the same contract every engine write keeps.
 *
 * The sessionName is the RESOLVED sender, never a claim from a body: the
 * route derives it from the pane (messages.resolveSender), so an agent can
 * only ever report as itself. That property is what makes this record
 * evidence rather than something anyone on the machine can forge.
 */
function record(sessionName, entry) {
  let file;
  try { file = fileFor(sessionName); } catch {
    return { recorded: false, because: 'that agent name is not one we can keep a record under' };
  }
  const state = entry && entry.state;
  if (!STATES.includes(state)) {
    return { recorded: false, because: 'that is not a state we know. The states are: ' + STATES.join(', ') };
  }
  /* 🛑 #900: AN AUTOMATIC `idle` MAY NOT ERASE A DELIBERATE `blocked` OR
     `needs_you`. The Stop hook fires at the end of EVERY turn and writes idle,
     so a waiting state an agent filed mid-turn survived only until its own turn
     ended, seconds later. Latest-report-wins then rendered an agent waiting on
     a person as at-rest and finished. Two throwaway walk agents found this
     about themselves on 0.5.34 and traced it correctly.

     ⚠️ THE DISCRIMINATOR IS `auto`, NOT THE WORD. A person or an agent
     deliberately saying `idle` still clears a waiting state, which is how a
     block gets cleared at all; only the machine writing on its behalf is
     refused. Marking the writer is the only way to tell those apart, because
     the two produce an identical line.

     ⚠️ AND IT REFUSES ONLY `idle`. `working` (the next prompt), `stopped`
     (session end) and `started` (a new run) all still land, so a real block
     clears the moment the agent actually does something. A rule that refused
     every automatic write would strand the agent blocked forever. */
  if (entry.auto === true && state === 'idle') {
    const standing = read(sessionName);
    if (standing.found === true && WAITING_ON_A_PERSON.includes(standing.state)) {
      return {
        recorded: false,
        skipped: 'waiting',
        because: 'it is waiting on a person (' + standing.state + '), so an automatic idle did not overwrite that',
      };
    }
  }
  const at = new Date().toISOString();
  const line = {
    v: 1,
    state,
    because: capped(entry.because, CAPS.because),
    on: capped(entry.on, CAPS.on),
    owner: capped(entry.owner, CAPS.owner),
    until: capped(entry.until, CAPS.until),
    /* #763: the project this report is about (a project id), when the agent
       says. A needs_you that names one lights that project alone; one that
       names none lights no project and is read on the Agents page. */
    project: capped(entry.project, CAPS.project),
    /* #570: WHICH RUN of this agent said it. Two live runs of one agent used to
       interleave into this file with nothing marking two actors, so a pair of
       them disagreeing read as one agent changing its mind. The route fills
       this from the launch token it resolved; a pane-derived sender has no
       instance and leaves it null, which is the honest answer rather than a
       manufactured one. */
    instance: capped(entry.instance, CAPS.instance),
    /* #1453: WHO WROTE THIS LINE. The comment on #900's rule above says the
       necessary thing -- marking the writer is the only way to tell an
       automatic report from a deliberate one, BECAUSE THE TWO PRODUCE AN
       IDENTICAL LINE -- and until now the mark was used at write time and
       dropped before the write. So anything auditing whether that rule worked
       had to reconstruct by string-matching the hook's own sentence what this
       function already knew and threw away.

       It is the SAME predicate the rule above branches on, deliberately: this
       field records what the rule SAW, never a re-derivation of it, so the two
       cannot drift.

       ⚠️ THREE VALUES, NOT A BOOLEAN, and that is the whole reason it is not
       `auto: true`. A line written before this field existed carries no `by`
       and reads as null -- unknown provenance, which is the honest answer
       rather than a manufactured one, and the same posture `instance` takes
       two fields up. An omitted boolean would collapse "the agent typed it"
       into "we do not know", which is the ambiguity this exists to remove.

       Append-only, so no migration and no rewrite of history. `v` stays 1:
       read() picks fields by name and no reader asserts a key set, so a bump
       would make every reader handle two shapes for a change none of them has
       to handle. */
    by: entry.auto === true ? 'auto' : 'agent',
    at,
  };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
  } catch {
    return { recorded: false, because: 'we could not save that report' };
  }
  return { recorded: true, at };
}

/**
 * The latest run's latest report, raw. `found:false` means the agent has
 * never reported (or the record is unreadable, with its own sentence), and
 * the caller falls back to whatever it does today -- an agent that never
 * adopted the verb renders exactly as before, which is the no-regression
 * rule the #253 comment promises.
 *
 * A `started` line begins a run; only the latest run speaks for the current
 * state, so yesterday's `stopped` never shadows today's work. Within the
 * window, file order is report order: one server process appends
 * serially, which is the ordering guarantee, and a seq field would be a
 * second copy of the same fact.
 *
 * ⚠️ Every field is null when unknown, never a default (codexsession's
 * rule): a defaulted `at` would give a stale report a fresh timestamp,
 * which is exactly the lie the decay rule exists to catch.
 */
function read(sessionName) {
  let file;
  try { file = fileFor(sessionName); } catch { return { found: false, because: NO_READING.NEVER_REPORTED }; }
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (err) {
    if (err && err.code === 'ENOENT') return { found: false, because: NO_READING.NEVER_REPORTED };
    return { found: false, because: NO_READING.UNREADABLE };
  }
  let text;
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    text = buf.toString('utf8');
    /* A tail that starts mid-file starts mid-line; the partial first line
       is not a report and JSON.parse would reject it anyway. Dropping it
       explicitly keeps "skipped a corrupt line" meaning corrupt. */
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
  } catch {
    return { found: false, because: NO_READING.UNREADABLE };
  } finally {
    try { fs.closeSync(fd); } catch { /* already gone */ }
  }
  let latest = null;
  /* #763: the project carried forward. A report that names a project sets the
     agent's current one; later reports that name none inherit it (the
     permission hook reports needs_you with no project of its own); a stopped
     report clears it, since nothing from a previous run may leak into this
     one. */
  let project = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; } // one bad line must not eat the record
    if (!row || typeof row !== 'object') continue;
    if (!STATES.includes(row.state)) {
      process.stderr.write('selfreport: unknown state ' + JSON.stringify(row.state) + ', line skipped\n');
      continue;
    }
    /* Later lines simply replace earlier ones; a `started` needs no reset
       logic for "latest", but it matters that it REPLACES rather than
       merges: nothing from the previous run may leak into this one. */
    latest = row;
    /* stopped ends a run; started begins one (a crash leaves no stopped row, so
       a new run must not inherit the old run's project and light it on the
       first question). The cost: the hook reports started on every session
       start, compaction and resume included, so after each the questions go
       unattributed until the agent names a project again. A missed light,
       never a wrong one (the direction ruled 2026-08-24 23:05). */
    if (row.state === 'stopped' || row.state === 'started') project = null;
    // read AFTER the clear, so `started --project X` starts the run on X.
    if (typeof row.project === 'string' && row.project) project = row.project;
  }
  if (!latest) return { found: false, because: NO_READING.NEVER_REPORTED };
  return {
    found: true,
    state: latest.state,
    because: latest.because || null,
    on: latest.on || null,
    owner: latest.owner || null,
    until: latest.until || null,
    at: latest.at || null,
    /* Null for a pane-derived report, which is most of them: the pane arm has
       no notion of a run. Null means "not known", never "only one run". */
    instance: latest.instance || null,
    /* #1453: 'auto' (a lifecycle hook wrote it), 'agent' (the agent chose to
       say it), or null for a line written before the field existed. Null is
       "not known", never "an agent typed it" -- a caller that treats absence
       as agent-typed reintroduces exactly the miscount this field removes. */
    by: latest.by || null,
    project,
    /* Whether the project came from the latest report itself (stated) or from
       an earlier one (inferred: no report attributed THIS reading to it). A tile lit by an inference must
       be tellable from one lit by a statement, or the first wrong carry-forward
       is unexplainable (Splinter, 2026-08-24 23:05). */
    projectInferred: project !== null && !(typeof latest.project === 'string' && latest.project),
  };
}

module.exports = { STATES, WAITING_ON_A_PERSON, DIR, NO_READING, TAIL_BYTES, record, read, fileFor };
