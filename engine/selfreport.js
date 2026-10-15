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
 * 🔑 SIX WORDS, A CLOSED LIST: started, working, idle, needs_you, blocked,
 * stopped. Four are already the board's words (status.js STATE), so a report
 * teaches the board the same fact with no translation layer. An unknown word is
 * a writer's typo and is skipped with one line to stderr on read. (#2623: this
 * used to be shared with engine/notify.js's KINDS, the phone-home seam; that
 * module was deleted, so the board's STATE is now the only shared vocabulary.)
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

const STATES = Object.freeze(['started', 'working', 'idle', 'needs_you', 'blocked', 'stopped']);

/* #900: the two words that mean A PERSON IS THE BLOCKER. They are the states
   `status.reconcileReport` already declines to decay, and they are the only
   ones an automatic writer may not erase. */
const WAITING_ON_A_PERSON = Object.freeze(['blocked', 'needs_you']);
/* #5959: a waiting report older than this is pointed out to the agent (kosmos report show). It is aged from when the
   waiting run began (askedAt below), or from the latest line when that is not known, which can only be shorter. */
const STALE_WAIT_MS = 24 * 3600 * 1000;

const DIR = path.join(store.ROOT, 'selfreports');

/* The reader's window. 64KB holds hundreds of transitions; anything older
   is history the CURRENT state cannot depend on, because a `started` line
   resets the run and a run that big has heartbeats filling the tail. */
const TAIL_BYTES = 64 * 1024;

/* Field caps, so one runaway caller cannot turn the record into a dump.
   `because` is a sentence, not a transcript: the words live on this Mac,
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

/* #1996 (K-13 residual): `because` is a SENTENCE and may carry paragraph breaks;
   the single-value fields above (on/owner/until/project/instance) are not and must
   not carry newlines. `capped` flattens ALL whitespace, which is right for those
   fields but was silently collapsing multi-line `because` to one line in the stored
   record (`bravo\nsecond line` came back as `bravo second line`) - #1927's goal of
   carrying paragraph breaks was undone at the store. This keeps internal newlines:
   normalise CRLF/CR to LF and tabs to a space (a stored sentence is not tab-aligned
   layout), then trim only the OUTER whitespace so leading/trailing blank lines do
   not survive while the internal breaks do. JSONL storage is unaffected -
   JSON.stringify escapes the `\n`, so one record still occupies one physical line.
   ⚠️ ALL line-terminators are normalised, not just `\r\n`: U+2028/U+2029 (LINE and
   PARAGRAPH SEPARATOR) also become `\n`, and the remaining control whitespace
   (`\t`, `\v`, `\f`) becomes a space. Otherwise one of those exotic terminators
   would survive raw inside the stored sentence, since `.trim()` only strips the
   outer edges - the newline we keep is `\n` and nothing else. */
function cappedSentence(value, cap) {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\t\v\f]/g, ' ')
    .trim();
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
/* 🛑 SECURITY BOUNDARY (#2575). `entry.by === 'operator'` is honored by this
   function for ANY caller that passes it -- record() cannot know who is calling,
   so it does not police the field. The invariant "only a board-token caller, via
   one of the two server writers, may set operator provenance" is therefore enforced
   ONE LAYER UP, at the HTTP boundary. There are two writers: the operator-only
   clear route (#2575), and server.js clearLeftovers (#5034), which clears the
   question an agent raised about a project when it leaves the project or the
   project is removed. Both routes sit behind the board token and neither takes
   `by` from the request. Every route builds `entry` field by field and never
   spreads an untrusted `req.body` into it. In particular /api/report (server.js)
   copies state/project/because/on/owner/until/instance/auto and deliberately NOT
   `by` (nor #5034's `left`, red-guarded in server.leave-leftovers-5034.test.js), so an agent cannot stamp its own report `operator` and
   bypass the #900 auto-guard. That boundary is red-guarded by the FORGERY GUARD
   test in server.clear-selfreport-2575.test.js (a /api/report with body
   by:'operator' must still store by:'agent'). ⚠️ Any NEW caller of record() must
   keep building entry explicitly -- spreading a request body here silently
   reopens the operator-provenance forgery. */
/* #2808 class-1: the ONE definition of "this standing report is an AUTO permission/
   trust wait" (a lifecycle-hook-written needs_you). record()'s #2456 clobber-guard
   below and engine/class1-autohandle.js's auto-handle BOTH key the class-1-vs-class-2
   line on it (#4169: the board's armed sweep narrows it further in standingFromAgent, where
   only the folder-trust dialog on screen is restarted; a by:auto report alone is a tool prompt
   and is left for a person), so it lives here once and is exported rather than inlined in two places
   (the two-derivations-of-one-fact defect this codebase names as its most-shipped).
   A DELIBERATE needs_you (by:'agent'/'operator') is NOT this; nor is a legacy by:null
   line (provenance unknown); nor any non-needs_you state. */
function isAutoPermissionWait(standing) {
  return !!standing
    && standing.found === true
    && standing.state === 'needs_you'
    && standing.by === 'auto';
}

/* #6209: an AUTOMATIC provider block (Claude Code's StopFailure hook: blocked on "provider api (...)", by auto). A turn
   that then ends normally (the Stop hook's automatic idle) proves the provider answered again, so that idle clears it;
   the mid-turn working heartbeat does not (the turn could still fail). A deliberate blocked is never this. */
function isAutoProviderBlock(standing) {
  return !!standing
    && standing.found === true
    && standing.state === 'blocked'
    && standing.by === 'auto'
    && /^provider api \(/.test(String(standing.on || ''));
}

/* #6209 review 1: true when a line under a standing automatic provider block is a wait on a person that an automatic
   idle may not clear (a deliberate or unmarked blocked/needs_you, not an automatic permission wait). */
function hidesWait(w) {
  if (!w || !w.found || !WAITING_ON_A_PERSON.includes(w.state)) return false;
  return !(w.state === 'needs_you' && w.by === 'auto');
}

/* #6209: what the trailing run of automatic provider blocks covered, read exactly as read() would have read the record
   just before the run (reviews 1 and 5: one window and one set of rules, so project carry, the cut-tail rule, until
   and askedAt agree): { wait } (read()'s reading, found or not), or { unknown: true } when the record cannot be read
   or the run reaches the front of a cut tail. */
function lineUnderProviderBlock(sessionName) {
  const tail = readTail(sessionName);
  if (!tail.rows) return { unknown: true };
  const rows = tail.rows;
  let i = rows.length - 1;
  while (i >= 0 && isAutoProviderBlock({ found: true, ...rows[i] })) i -= 1;
  if (i < 0) return tail.cut ? { unknown: true } : { wait: { found: false } };
  // Review 6: also the project the whole record carries now, so a restore that would inherit a different one says its own.
  return { wait: latestOf(rows.slice(0, i + 1), tail.cut), carriedNow: latestOf(rows, tail.cut).project };
}

/* #4569 fix 4: { n, yours } when the value is a sane queue count on a working report, else undefined (not written). */
function waitingOf(state, w) {
  if (state !== 'working' || !w || typeof w !== 'object') return undefined;
  const n = w.n; const yours = w.yours;
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000) return undefined;
  if (!Number.isSafeInteger(yours) || yours < 0 || yours > n) return undefined;
  return { n, yours };
}

/* #4612: a turn answer's text with control characters (but newline and tab) removed, as finalOf stores it.
   Exported so a caller that masks the text (#4733, the setup guide's answer) masks what will be stored:
   masking first would miss a secret split by one of these characters, which this then joins back. */
function finalTextClean(text) {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}

/* #4612: { text, startedAt } on an idle or working report, text 1..4000 characters (control characters but newline
   and tab removed), startedAt a time that parses; else undefined (not written). */
function finalOf(state, f) {
  if ((state !== 'idle' && state !== 'working') || !f || typeof f !== 'object' || typeof f.text !== 'string' || typeof f.startedAt !== 'string') return undefined;
  if (!Number.isFinite(Date.parse(f.startedAt))) return undefined;
  const text = Array.from(finalTextClean(f.text).trim()).slice(0, 4000).join('');   // characters, not UTF-16 units
  return text ? { text, startedAt: f.startedAt } : undefined;
}

function record(sessionName, entry) {
  let file;
  try { file = fileFor(sessionName); } catch {
    return { recorded: false, because: 'that agent name is not one we can keep a record under' };
  }
  const state = entry && entry.state;
  if (!STATES.includes(state)) {
    return { recorded: false, because: 'that is not a state we know. The states are: ' + STATES.join(', ') };
  }
  /* #1996 + #2001: the two "a person is the blocker" states MUST carry ACTIONABLE
     CONTENT. Until now a needs_you or blocked with an empty note recorded SUCCESS,
     so the agent believed it had explained itself while the reason was silently
     dropped (measured: `report needs_you` with an emptied text stored `because:
     null` and returned recorded:true) - a reasonless RED / attention state on the
     board, the same empty-input defect post/reply already REFUSE, only here it
     failed OPEN instead of closed.
     🔑 THIS MIRRORS #2001's CLI-SIDE RULE, WITH THE SAME SET (a note, --on, or
     --owner), deliberately. #2001 refuses an empty summons BEFORE the network; this
     is the SERVER-side half, so a summons arriving by any OTHER path - the SDK
     runner, a direct loopback API call, a CLI predating #2001 - is refused too
     rather than recorded as a reasonless red. A server rule STRICTER than #2001
     (e.g. requiring the note specifically) would reject a report the CLI just
     approved, like `report blocked --on some-task` with no note, so the sets must
     match. The other four states (started/working/idle/stopped) stay informational
     and free-form: a bare `report working` heartbeat carries nothing and that is
     fine. Scoped to WAITING_ON_A_PERSON so the rule lives on one existing list. */
  const because = cappedSentence(entry.because, CAPS.because);
  const on = capped(entry.on, CAPS.on);
  const owner = capped(entry.owner, CAPS.owner);
  if (WAITING_ON_A_PERSON.includes(state) && !because && !on && !owner) {
    return {
      recorded: false,
      because: 'a ' + state + ' report needs at least one of a reason, --on, or --owner - say what you need, what you are blocked on, or who must act, so the board and the person can see what the red is for',
    };
  }
  /* 🛑 #900/#1949: AN AUTOMATIC `idle` OR `working` MAY NOT ERASE A DELIBERATE
     `blocked` OR `needs_you`. (#2456 extends this rule below: an auto `needs_you`
     may not erase a deliberate wait either, and an AUTO wait that is itself a
     `needs_you` -- a permission prompt -- is NOT protected. Read to the #2456
     paragraph for the current, full gate before relying on this heading.)
     The Stop hook fires at the end of EVERY turn and
     writes idle, and the report hook fires working on EVERY PreToolUse, so a
     waiting state an agent filed mid-turn survived only until its own next
     command, seconds later. Latest-report-wins then rendered an agent waiting
     on a person as at-rest and finished. Two throwaway walk agents found the
     idle half about themselves on 0.5.34 and traced it correctly; #1949 added
     the working half (see below).

     ⚠️ THE DISCRIMINATOR IS `auto`, NOT THE WORD. A person or an agent
     deliberately saying `idle` still clears a waiting state, which is how a
     block gets cleared at all; only the machine writing on its behalf is
     refused. Marking the writer is the only way to tell those apart, because
     the two produce an identical line.

     ⚠️ IT REFUSES AUTOMATIC `idle` AND `working` (#1949). The hook fires
     `working` on EVERY PreToolUse -- it is CONTINUOUS, not "the agent did
     something deliberate" -- so while automatic `working` was allowed to land,
     a standing needs_you erased itself within seconds of the agent running any
     command (Splinter2 measured 16s; ~74 of 82 log rows are automatic). That is
     the worst case because the doctrine tells every agent to raise needs_you AND
     KEEP WORKING: obeying it destroyed the signal. `stopped` (session end) and
     `started` (a new run) still land -- they are one-time transitions, not
     continuous -- and CRUCIALLY an AGENT-WRITTEN report of ANY state still lands,
     because the guard tests `entry.auto`, not the word. A rule that refused
     every automatic write would strand the agent blocked forever; instead the
     agent that genuinely resumes clears its own block by reporting it itself.

     🔑 #2456: THE WAIT THIS PROTECTS IS A *DELIBERATE* ONE, which is what the
     heading above always said and the code did not check. A standing wait can
     itself be AUTOMATIC: the PermissionRequest hook writes a `needs_you`
     ("asking permission to use <tool>: ...", by:'auto'), and two things went
     wrong because this guard treated it like a deliberate summons.
       (1) NO-CLEAR: the auto working/idle that follows once the prompt resolves
           (the next PreToolUse, or the turn-end Stop -> idle) was refused over
           it, so the permission `needs_you` stuck on the board indefinitely
           though nobody had anything to act on (measured: it stayed red across a
           dozen further commands).
       (2) CLOBBER: an auto `needs_you` overwrote an agent's DELIBERATE
           `needs_you`, replacing the real question in `because` with the text of
           a shell command -- the board's one red state then named something no
           person needed to act on, and the real ask was gone.
     The fix is NARROW, keyed on WHO wrote the standing wait and on its STATE
     (`standing.by` + `standing.state`, both already stored). The ONE wait made
     clearable/overwritable is a standing AUTO `needs_you` -- the permission
     prompt, and the only thing #2456 measured. EVERYTHING ELSE stays protected
     exactly as #900/#1949 left it:
       - a DELIBERATE `needs_you`/`blocked` (by agent/operator): the agent's own
         summons, protected from auto idle/working AND now from an auto
         `needs_you` clobber;
       - a legacy line with no mark (by:null), whose provenance is unknown and so
         stays protected as before;
       - an AUTO `blocked` (a StopFailure provider outage): machine-written, and
         an auto WORKING must not clear it. Keying only on `by` would have dropped
         this protection silently -- the outage would vanish on the next PreToolUse
         heartbeat while still unresolved (caught in review; #2456 measured
         needs_you, never blocked). #6209: an auto IDLE does clear it (the Stop of a
         turn that ended normally proves the provider answered), unless the block
         had replaced a deliberate or unmarked wait, which is then shown again (review 3).
     An AGENT re-reporting its own `needs_you` is by:'agent' (entry.auto is
     falsey), so it still lands and can always update its own question; a
     permission prompt fired when nothing is waiting still shows, because there is
     no standing wait to protect. An INCOMING auto `blocked` is left unguarded, as
     today -- a provider outage should surface even over a standing wait. */
  if (entry.auto === true && (state === 'idle' || state === 'working' || state === 'needs_you')) {
    const standing = read(sessionName);
    /* #6209: a turn that ended normally after a provider failure. The provider answered again, so its automatic block
       is over: an automatic idle clears it (review 3) unless the block had replaced a deliberate or unmarked wait, which
       is then SHOWN AGAIN (its own line, re-appended with its own words and writer) instead of staying hidden behind a
       block nobody clears. What is under the block unknown (an unreadable record, a run of blocks past the tail read):
       the block stays, as before #6209. */
    if (state === 'idle' && isAutoProviderBlock(standing)) {
      const under = lineUnderProviderBlock(sessionName);
      if (under.unknown) {
        return { recorded: false, skipped: 'waiting', because: 'it is blocked on the provider and Kosmos could not tell what that block replaced, so an automatic idle did not overwrite it' };
      }
      if (hidesWait(under.wait)) {
        const w = under.wait;
        /* Review 5: a wait whose asking time is not known (its run reaches the front of a cut tail) cannot be shown
           again without re-dating it, so the block stays (fails closed). */
        if (!w.askedAt) {
          return { recorded: false, skipped: 'waiting', because: 'it is blocked on the provider over a wait whose start is not known, so an automatic idle did not overwrite it' };
        }
        try {
          /* Reviews 4 and 5: the wait as read() reads it: its own words, on, owner, until and writer, its ORIGINAL asking
             time (askedAt, which read() honours), and its project only when it stated one (a carried project still
             carries); never the old line's instance, left, waiting or final. */
          const back = { v: 1, state: w.state, because: w.because, on: w.on, owner: w.owner, until: w.until,
            project: w.projectInferred && under.carriedNow === w.project ? null : w.project, at: new Date().toISOString(), askedAt: w.askedAt, restored: 'provider block over' };
          if (w.by) back.by = w.by;   // an unmarked (legacy) wait stays unmarked
          fs.appendFileSync(fileFor(sessionName), JSON.stringify(back) + '\n');
          return { recorded: false, restored: true, skipped: 'waiting', because: 'the provider answered again, so the ' + w.state + ' it had covered is shown again' };
        } catch {
          return { recorded: false, skipped: 'waiting', because: 'the provider answered again, but the wait it had covered could not be shown again, so the block stays' };
        }
      }
    }
    const standingIsAutoPermissionWait = isAutoPermissionWait(standing);
    const standingIsProtectedWait = standing.found === true
      && WAITING_ON_A_PERSON.includes(standing.state)
      && !standingIsAutoPermissionWait
      && !(state === 'idle' && isAutoProviderBlock(standing));   // #6209: handled above (cleared, or the wait shown again)
    if (standingIsProtectedWait) {
      return {
        recorded: false,
        skipped: 'waiting',
        because: 'it is waiting on a person (' + standing.state + '), so an automatic ' + state + ' did not overwrite that',
      };
    }
  }
  const at = new Date().toISOString();
  const line = {
    v: 1,
    state,
    /* #1996: because/on/owner precomputed above (because keeps paragraph breaks;
       on/owner reused from the WAITING_ON_A_PERSON content check). */
    because,
    on,
    owner,
    until: capped(entry.until, CAPS.until),
    /* #763: the project this report is about (a project id), when the agent
       says. A needs_you that names one lights that project alone; one that
       names none lights no project and is read on the Agents page. */
    project: capped(entry.project, CAPS.project),
    /* #5034 review 3: the project this line says the agent LEFT. read() stops carrying that project forward from here,
       so a later report naming none (an automatic permission wait) is not tied to a project the agent is no longer
       on. Written only by server.js clearLeftovers; null on every other line. */
    left: capped(entry.left, CAPS.project),
    /* #4569 fix 4: a busy Muse agent's queue, { n, yours } (whole numbers, yours <= n), on a working report only.
       The Muse front sends it; any agent's own report could too, but it is checked here, the page builds its line
       from these two numbers and fixed words only (no agent text reaches it), and it shows on the reporter's own
       card alone, so a false one is no worse than a false "working". */
    waiting: waitingOf(state, entry.waiting),
    /* #4612: a turn's answer, { text, startedAt }, on an idle or working report. The Muse front sends it; any agent's
       own report could too, but it shows only under that agent's own DM, escaped, and only when the person's latest
       message there is unanswered and startedAt is not before it (server.js), so a false one says nothing the agent
       could not already post there itself. */
    final: finalOf(state, entry.final),
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

       ⚠️ THREE WRITTEN VALUES, NOT A BOOLEAN, and that is the whole reason it
       is not `auto: true`. 'auto' (a lifecycle hook), 'agent' (the agent chose
       to say it), and 'operator' (a person cleared a stale self-report on the
       agent's behalf, via the operator-only clear route -- #2575 -- or Kosmos
       cleared it when the agent left the project it was about -- #5034). A line
       written before this field existed carries no `by` and reads as null --
       unknown provenance, which is the honest answer rather than a manufactured
       one, and the same posture `instance` takes two fields up. An omitted
       boolean would collapse "the agent typed it" into "we do not know", which
       is the ambiguity this exists to remove.

       🔑 #2575: 'operator' is the ONE value a caller may assert on the entry
       (`entry.by === 'operator'`), and only the operator-only clear route and
       server.js clearLeftovers (#5034) set it. An operator clear has `auto` falsey, so the #900 guard above does NOT
       refuse it -- it lands and supersedes a standing needs_you. It is safe
       because the cleared state RE-DERIVES on the next poll (a scraped working
       outranks a reported idle, #1995; a genuine on-screen prompt re-raises
       needs_you; the agent's own next report re-raises), so an operator-clear
       removes the STICKY reported red, it does not permanently silence a real
       need. That re-derivation is why letting a person report AS the agent here
       does not break the evidence model the rest of this file keeps.

       Append-only, so no migration and no rewrite of history. `v` stays 1:
       read() picks fields by name and no reader asserts a key set, so a bump
       would make every reader handle two shapes for a change none of them has
       to handle. */
    by: entry.by === 'operator' ? 'operator' : (entry.auto === true ? 'auto' : 'agent'),
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
/* #6209 review 5: the record's tail as rows, shared by read() and lineUnderProviderBlock so both see one window.
   { rows, cut } or { found: false, because }. */
function readTail(sessionName) {
  let file;
  try { file = fileFor(sessionName); } catch { return { found: false, because: NO_READING.NEVER_REPORTED }; }
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (err) {
    if (err && err.code === 'ENOENT') return { found: false, because: NO_READING.NEVER_REPORTED };
    return { found: false, because: NO_READING.UNREADABLE };
  }
  let text;
  let cut = false;   // #5943: the tail began after the file's start, so lines before it are not seen
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    cut = start > 0;
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
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; } // one bad line must not eat the record
    if (!row || typeof row !== 'object') continue;
    if (!STATES.includes(row.state)) {
      process.stderr.write('selfreport: unknown state ' + JSON.stringify(row.state) + ', line skipped\n');
      continue;
    }
    rows.push(row);
  }
  return { rows, cut };
}

/* #6209 review 5: what read() reports for these rows (the tail, or a prefix of it), pure. */
function latestOf(rows, cut) {
  let latest = null;
  /* #763: the project carried forward. A report that names a project sets the
     agent's current one; later reports that name none inherit it (the
     permission hook reports needs_you with no project of its own); a stopped
     report clears it, since nothing from a previous run may leak into this
     one. */
  let project = null;
  /* #4612 review round 3: the latest turn answer THIS RUN, carried across the reports after it (a room turn that ran
     next must not make the DM forget what the agent answered), within the TAIL_BYTES this read looks at. A started
     or stopped report forgets it, like the project. */
  let final = null;
  /* #5943: when the standing question was first asked. The `at` of the FIRST line of the trailing run of identical
     reports (same state, same words, same project), so re-reporting the same question does not re-date it, and a
     different one (or the same words about another project) does. */
  let runKey = null;
  let runAt = null;
  let parsed = 0;
  let runFromFirst = false;   // the run began at the first line read: when the tail is cut, its start is unknown
  for (const row of rows) {
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
    if (row.state === 'stopped' || row.state === 'started') { project = null; final = null; }
    { const f = finalOf(row.state, row.final); if (f) final = f; }
    // read AFTER the clear, so `started --project X` starts the run on X.
    /* #5034: a line saying the agent left the carried project ends the carry (before this line's own project). Only
       clearLeftovers writes one, and only over a waiting report that named the project: a leave over a working or
       idle report writes nothing, so that carry survives (re-writing the state to end it would refresh its `at`,
       the lie the decay rule exists to catch), and a re-join does not bring an ended carry back until the agent
       names the project again. Both are accepted residuals, in the #5034 plan. */
    if (typeof row.left === 'string' && row.left && row.left === project) project = null;
    if (typeof row.project === 'string' && row.project) project = row.project;
    /* #5943 (with #5942, Mona Lisa): a run is the same state, the same words AND the same project (as carried), so one
       generic sentence filed about project A and later about project B is two asks, not one 10 days old. */
    {
      const key = row.state + '\u0000' + (typeof row.because === 'string' ? row.because : '') + '\u0000' + (project || '');
      if (key !== runKey) {
        runKey = key;
        // #6209 review 4: a wait re-shown after a provider block carries its original asking time.
        // #6209: only a wait re-shown after a provider block (row.restored) carries its original asking time.
        runAt = row.restored && typeof row.askedAt === 'string' && Number.isFinite(Date.parse(row.askedAt)) ? row.askedAt : (typeof row.at === 'string' ? row.at : null);
        runFromFirst = parsed === 0;
      }
      parsed += 1;
    }
  }
  if (!latest) return { found: false, because: NO_READING.NEVER_REPORTED };
  return {
    found: true,
    state: latest.state,
    waiting: waitingOf(latest.state, latest.waiting) || null,   // #4569 fix 4
    final,   // #4612: the run's latest turn answer (see the loop above)
    because: latest.because || null,
    on: latest.on || null,
    owner: latest.owner || null,
    until: latest.until || null,
    at: latest.at || null,
    // #5943: null unless the latest report waits on a person (see the loop above).
    // Not known (null) rather than too recent: a run that begins at the first line of a CUT tail began earlier (Mona Lisa).
    askedAt: WAITING_ON_A_PERSON.includes(latest.state) && runAt && Number.isFinite(Date.parse(runAt))
      && !(cut && runFromFirst) ? runAt : null,
    /* Null for a pane-derived report, which is most of them: the pane arm has
       no notion of a run. Null means "not known", never "only one run". */
    instance: latest.instance || null,
    /* #1453 + #2575: 'auto' (a lifecycle hook wrote it), 'agent' (the agent
       chose to say it), 'operator' (a person cleared a stale self-report on the
       agent's behalf), or null for a line written before the field existed.
       Null is "not known", never "an agent typed it" -- a caller that treats
       absence as agent-typed reintroduces exactly the miscount this field
       removes. */
    by: latest.by || null,
    project,
    /* Whether the project came from the latest report itself (stated) or from
       an earlier one (inferred: no report attributed THIS reading to it). A tile lit by an inference must
       be tellable from one lit by a statement, or the first wrong carry-forward
       is unexplainable (Splinter, 2026-08-24 23:05). */
    projectInferred: project !== null && !(typeof latest.project === 'string' && latest.project),
  };
}

function read(sessionName) {
  const tail = readTail(sessionName);
  if (!tail.rows) return tail;
  return latestOf(tail.rows, tail.cut);
}

/* kosmos#5297 (#5296): the states and times in the same bounded tail read() looks at, oldest first, for a caller that
   asks WHEN an agent was busy rather than what it is doing now (communityturn: has it worked since its last post).
   Same skips as read(): an unknown state or a bad line is left out. null when there is no record or it cannot be read,
   so "never reported" is never mistaken for "reported idle". `truncated` on the array is true when older rows exist
   beyond the tail. */
function history(sessionName) {
  let text;
  let cut = false;
  try {
    const file = fileFor(sessionName);
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally { try { fs.closeSync(fd); } catch { /* already gone */ } }
    if (start > 0) { cut = true; text = text.slice(text.indexOf('\n') + 1); }
  } catch { return null; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object' || !STATES.includes(row.state)) continue;
    const at = Date.parse(row.at || '');
    // #5635 F2: an operator's clear is marked, so a reader can tell it from the agent stopping (projectview.workExcused).
    if (Number.isFinite(at)) out.push(row.by === 'operator' ? { state: row.state, at, by: 'operator' } : { state: row.state, at });
  }
  out.truncated = cut;   // the record is longer than the tail: rows older than out[0] exist and are not here
  return out;
}


/* #5318: blocked and needs_you are not two tones of one state. blocked is a wait nobody chases (heartbeat.js leaves it
   alone, recommender.js acts only on needs_you), so a person put in --owner sends person-blocked work where it goes
   inert (0.7.22, a real install: --owner "Josh"). The report is still RECORDED as sent; this only returns a note the
   CLIs print under "Recorded." A person here is: the About-you name (whole, or its first word), a word that names a
   person (person, human, user, operator, boss, founder, me, you; optionally after the, my, our or your), or an email
   address. A name that is also an agent on this board is that agent, never a person. Anything else (a deploy, a
   review, a provider, an outside company) gets no note: a missed person costs the old behaviour, a false one only a
   line of advice. The note names no owner and holds no double quote or backslash, so the macOS CLI can lift it with
   sed; its question is in single quotes, as the nudge's is (unquoted, a ? stops zsh). */
const PERSON_WORDS = /^(?:(?:the|my|our|your) )?(?:person|human|user|operator|boss|founder|me|you)$/;
/* #5943 (Josh: questions an agent could settle itself should not reach a non-technical person): said back by the board
   at the moment of asking, as the report's `note`, which both CLIs print (install/kosmos and tools/windows/kosmos-cli.js).
   No quote or backslash: the bash CLI reads `note` with a sed that stops at the first quote. */
const NEEDS_YOU_ASK_NOTE = 'Before a person has to answer this: can you undo it yourself? Can you undo it before anyone acts on it? '
  + 'If both are yes, decide it, tell them what you decided, and run: kosmos report clear. '
  + 'When they answer, wherever they answer, run: kosmos report clear.';
const BLOCKED_PERSON_NOTE = 'Note: that owner looks like a person, and blocked is never followed up or escalated. '
  + 'If a person must decide or act, report it this way instead, and Kosmos follows it up: kosmos report needs_you \'<your question>\'';
function blockedOwnerNote(state, owner, opts) {
  if (state !== 'blocked') return '';
  const norm = (v) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase();
  const o = norm(owner);
  if (!o) return '';
  const agents = (opts && Array.isArray(opts.agentNames)) ? opts.agentNames.map(norm) : [];
  if (agents.includes(o)) return '';
  const person = norm(opts && opts.personName);
  const first = person.split(' ')[0];
  const isPerson = PERSON_WORDS.test(o) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o)
    || (person !== '' && (o === person || (first.length >= 2 && o === first)));
  return isPerson ? BLOCKED_PERSON_NOTE : '';
}

module.exports = { STATES, WAITING_ON_A_PERSON, STALE_WAIT_MS, DIR, NO_READING, TAIL_BYTES, record, read, history, fileFor, isAutoPermissionWait, finalTextClean,
  blockedOwnerNote, BLOCKED_PERSON_NOTE, NEEDS_YOU_ASK_NOTE };
