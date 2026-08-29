#!/usr/bin/env node
'use strict';
/**
 * Where does the board's one RED state actually come from?
 *
 * 🛑 WHY THIS EXISTS. `needs_you` has three possible sources -- the
 * PermissionRequest hook, an agent typing `kosmos report needs_you`, and the
 * pane reader -- and the code reads as though all three are live. Only one of
 * them produces it in practice. #1253 measured that once, in a card comment,
 * as a frozen number; a number in a comment is true on the day it is written
 * and unfalsifiable afterwards. This is the same measurement as a command, so
 * the claim in `status.js`'s rule 3 can be re-run instead of believed.
 *
 *   node tools/needs-you-source.js [--dir <selfreports dir>]
 *
 * Read-only. It parses the append-only record and writes nothing.
 * Exit codes, because `tools/test-needs-you-source.sh` gates on them:
 *   0  a record was read and a verdict printed
 *   1  a NON-RESULT rather than a no: the record is missing, empty or
 *      unreadable, OR the hook marker has drifted so the split would be wrong
 *   2  the arguments were wrong, so nothing was read at all
 * Refusals go to stderr; only a real reading goes to stdout.
 *
 * 🔑 WHAT IT CAN AND CANNOT SEE. It reads the SELF-REPORT record, so it can
 * separate a hook-written `needs_you` from an agent-typed one and count both.
 * It CANNOT see the pane reader at all -- a scraped `needs_you` never touches
 * this record, it is composed in `status.classify` at read time (`reconcileReport` is
 * where that verdict is given precedence over a report, a different step). So the
 * argument this tool supports is by ELIMINATION: if the record shows almost no
 * agent-typed `needs_you`, then the reds the board shows are coming from the
 * one source that leaves no trace here.
 *
 * ⚠️ THE PROVENANCE SPLIT HAS THREE DERIVATIONS AND THEY ARE NOT EQUALLY
 * STRONG. Say which is which, because the next person cannot tell by looking:
 *
 *   fixture records   by AGENT NAME, on an UNLINKED CONVENTION: the record is
 *                     one file per agent and the walkthrough agents happen to
 *                     be named `walk-*`. Nothing in this repo reserves that
 *                     prefix, so a real agent could take it. Weaker than it
 *                     looks, and weak in the flattering direction (see below).
 *   hook records      by a STRING MATCH on the hook's own sentence
 *                     (`install/kosmos-report-hook.sh`), re-checked against
 *                     that file at run time by `hookPrefixIsLive`.
 *   agent-typed       the remainder, so every classification error above
 *                     lands here.
 *
 * 🛑 AND BOTH MARKERS ERR IN THE DIRECTION THAT FLATTERS THIS TOOL'S OWN
 * CONCLUSION, WHICH IS THE ONE DIRECTION A CAVEAT MUST NOT BE WRONG IN. An
 * earlier version of this header called it "the safe direction" and had it
 * exactly backwards. The conclusion here IS "agent-typed is near zero", so
 * anything that moves a record OUT of agent-typed makes the sentence look
 * better supported than it is -- and that is what an over-broad hook match and
 * an over-broad fixture prefix both do.
 * ⚠️ Scoped, because the opposite error exists too and an unqualified "can
 * only" would be false: a REWORDED hook moves records the other way, into
 * agent-typed, which is why `hookPrefixIsLive` exists and refuses to be
 * silent. A `because` that is absent or truncated also lands in agent-typed.
 * 🛑 AND THE WORST CASE DOES NOT SURVIVE. AN EARLIER VERSION OF THIS HEADER
 * SAID IT DID, AND THAT SENTENCE WAS THE SAME ERROR ONE LAYER UP: A BOUND
 * COMPUTED AGAINST ONLY THE CUTOFF THAT LET IT PASS. Granting every
 * hook-classified record to its agent keeps the SHARE clause comfortably
 * (about a third of `SHARE_CUTOFF`) and BREAKS the `TYPERS_CUTOFF` clause,
 * because those records are spread across six agents rather than one. Measured
 * by building that exact fixture and running this tool on it: it prints the
 * OPPOSITE verdict. So the defence is not a bound, and calling it one was the
 * flattering direction again, in the sentence written to guard against it.
 * ⭐ What there is instead is an ARGUMENT, labelled as one because it is not a
 * measurement: those records carry the hook's GENERATED SHAPE -- a tool name
 * plus a verbatim command -- which a person does not type by hand, and
 * `hookPrefixIsLive` guards the marker itself against drift. To judge that
 * shape you have to read the `because` strings in the record itself: this tool
 * never prints them, deliberately, so agent-authored text cannot land in its
 * output or a CI log. The per-agent table tells you WHO, not WHAT.
 *
 * ⚠️ WHY A STRING MATCH AT ALL: the record does not store who wrote a line.
 * `report --auto` is a write-time discriminator (`selfreport.js`) and is not
 * persisted, so the hook's own sentence is the only mechanical marker left.
 * That is kosmos#1453. This tool CHECKS that marker against the hook's source
 * at run time (see `hookPrefixIsLive`) rather than trusting it, because
 * otherwise a reworded hook would silently reclassify every record.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
/* The record's location is `engine/selfreport.js`'s to own, root AND leaf: it
   exports the very directory this tool reads. Requiring it rather than
   re-deriving `~/Library/Application Support/.../selfreports` means this tool
   cannot drift from the app (an earlier version used `process.env.HOME` where
   `store.js` uses `os.homedir()`, and a later one re-joined the leaf by hand),
   and `AGENT_WORKFORCE_DATA` is honoured for free.
   `tools/check-block-delivery.js` requires from `engine/` the same way. */
const selfreport = require(path.join(REPO, 'engine', 'selfreport.js'));

/* `install/kosmos-report-hook.sh` writes exactly this prefix on a
   PermissionRequest. 🛑 A CONSTANT DOES NOT MAKE THIS SAFE ON ITS OWN -- the
   hook is a separate file and nothing links them, so a reworded hook would
   make this read 0, reclassify every hook record as agent-typed, and print the
   same verdict with an inverted split. `hookPrefixIsLive` below is the link. */
const HOOK_PREFIX = 'asking permission to use ';
/* Overridable ONLY so the drift refusal below can be exercised from both arms
   in `tools/test-needs-you-source.sh`. A refusal that cannot be tested is the
   same decoration as a control that cannot fail. */
/* ⚠️ THE ENV VAR IS FOR TESTS ONLY. Repointing it at a file that happens to
   contain the prefix would suppress a genuine mismatch refusal. Low risk on a
   read-only dev tool, and it is what makes arm 9 drivable from both sides,
   which is the trade taken deliberately. */
const HOOK_SOURCE = process.env.KOSMOS_HOOK_SOURCE || path.join(REPO, 'install', 'kosmos-report-hook.sh');

/* Walkthrough agents (#1253's own evidence: `walk-birch`, `walk-cedar`) are
   FIXTURES, not colleagues. They are named here rather than eyeballed off the
   per-agent table, because the verdict must not be flippable by a fixture run:
   nearly every agent-typed record on this machine is theirs, and one more
   walkthrough at the same volume would otherwise print "agents ARE reporting
   this state themselves" on the strength of test traffic. No count here on
   purpose: the numbers live in `status.js` rule 3, once, beside the
   instruction not to trust them. */
const FIXTURE_PREFIX = 'walk-';
/* ⚠️ AND THIS PREFIX IS NARROWER THAN THE CLASS IT NAMES, WHICH IS A REAL
   LIMIT AND NOT A HYPOTHETICAL. The live record already holds synthetic agents
   that do NOT match it (`angeltest1315`, `angelcreate1329`, `quiet-quill`,
   `quiet-reed`, `scoutlive`, `msgcodex`). None has typed `needs_you`, so the
   verdict is unaffected today -- but a future fixture named outside `walk-`
   lands in `typedReal` and flips the verdict toward "agents ARE reporting",
   which is the exact failure this constant exists to prevent, in the direction
   that tells a reader correct documentation is stale.
   ✅ Mitigated rather than solved: the verdict below NAMES the working agents
   it counted, so a reader can see at a glance whether a flip came from a
   colleague or from something synthetic. Enumerating fixtures by name would be
   guessing at which of those six are tests. */

const RED = 'needs_you';
/* A state name no writer can produce: `selfreport.js` STATES is a closed list,
   and an unknown word is skipped on read. Its count MUST be 0, and a non-zero
   means this tool is counting something other than what it says it is. */
const IMPOSSIBLE = 'zzz_no_such_state';
/* Self-guarding, because the justification above is "STATES is a closed list"
   and the module is already required: assert it rather than assume it. If the
   word were ever added to STATES the control would silently stop being one. */
if (selfreport.STATES.includes(IMPOSSIBLE)) {
  throw new Error('needs-you-source: IMPOSSIBLE (' + IMPOSSIBLE + ') is a real state, so the control is not a control');
}

/* 🔑 THE VERDICT DOES NOT REST ON THE SHARE, AND THAT IS DELIBERATE. Most of
   the record is `working` heartbeats -- printed as a proportion on every run,
   beside the count, so no number is quoted here -- and a share-only threshold
   therefore gets harder to trip every day for reasons that have nothing to do
   with whether agents use the verb: the same real adoption rate would need
   several times as many typed reports a month from now. DISTINCT NON-FIXTURE
   AGENTS does not drift: it is one if one agent has ever typed it, whatever
   the heartbeat volume. */
const SHARE_CUTOFF = 0.001;   // 0.1% of all records
const TYPERS_CUTOFF = 2;      // distinct non-fixture agents that have ever typed it

function parseArgs(argv) {
  let dir = null;
  for (let i = 0; i < argv.length; i++) {
    /* 🛑 AN UNRECOGNISED ARGUMENT IS AN ERROR, NEVER IGNORED. Ignoring it is
       the empty-`--dir` failure through a second door: `--dirr /tmp/fixture`
       and a bare positional path both used to read the LIVE record while the
       caller believed they were reading a fixture, which silently breaks the
       shell test's promise that nothing there touches production data. */
    if (argv[i] !== '--dir') {
      return { error: 'unrecognised argument: ' + argv[i] + '. The only option is --dir <path>. Nothing was read.' };
    }
    {
      /* 🛑 PRESENT-BUT-EMPTY IS AN ERROR, NEVER A FALLBACK. `--dir "$UNSET"`
         used to fall through to the LIVE record while the caller believed it
         was reading a fixture, which silently breaks the shell test's promise
         that nothing there touches production data. */
      const value = argv[i + 1];
      if (value === undefined || String(value).trim() === '') {
        return { error: '--dir was given with no value. Pass a directory, or omit --dir to read the live record.' };
      }
      if (dir !== null) {
        return { error: '--dir was given twice. Refusing rather than silently taking the last one.' };
      }
      dir = value;
      i++;
    }
  }
  return { dir: dir || selfreport.DIR };
}

/* Is the marker this tool classifies by still the marker the hook writes?
   Returns true/false/null (null = the hook source could not be read, which is
   not the same as a mismatch and must not be reported as one). */
function hookPrefixIsLive(hookSource) {
  let text;
  try { text = fs.readFileSync(hookSource, 'utf8'); } catch { return null; }
  return text.includes(HOOK_PREFIX);
}

function readRecord(dir) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  } catch (err) {
    /* ⚠️ ABSENT AND UNREADABLE HAVE DIFFERENT FIXES, so they get different
       sentences. Reporting an EACCES as "not there" sends the reader to
       create something that already exists. */
    const why = (err && err.code === 'ENOENT')
      ? 'there is no self-report record at'
      : 'the self-report record could not be read (' + ((err && err.code) || 'unknown error') + ') at';
    return { ok: false, why, dir, files: [], rows: [], unparseable: 0 };
  }
  const rows = [];
  let unparseable = 0;
  /* ⚠️ AN UNREADABLE FILE USED TO BE SKIPPED WITH NO COUNTER while an
     unreadable LINE was counted and surfaced. An EACCES on one agent's file
     would then remove that agent's records -- its reds included -- from every
     number below, with no signal, while "agent files" still counted it. */
  const unreadableFiles = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { unreadableFiles.push(f); continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { unparseable++; continue; }
      /* An array parses fine and is not a record; an object with no `state` is
         not one either. Both used to land in the totals as `state: ''`, which
         inflates the share DENOMINATOR -- again the flattering direction. */
      if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.state !== 'string' || !o.state.trim()) { unparseable++; continue; }
      rows.push({
        agent: f.replace(/\.jsonl$/, ''),
        state: String(o.state || ''),
        because: String(o.because || ''),
        at: String(o.at || ''),
      });
    }
  }
  return { ok: true, why: null, dir, files, rows, unparseable, unreadableFiles };
}

const hookWritten = (row) => row.because.startsWith(HOOK_PREFIX);
const isFixture = (agent) => agent.startsWith(FIXTURE_PREFIX);

function summarise(rows) {
  const byState = new Map();
  for (const r of rows) byState.set(r.state, (byState.get(r.state) || 0) + 1);

  const reds = rows.filter((r) => r.state === RED);
  const hook = reds.filter(hookWritten);
  const typed = reds.filter((r) => !hookWritten(r));
  const typedFixture = typed.filter((r) => isFixture(r.agent));
  const hookFixture = hook.filter((r) => isFixture(r.agent));
  const typedReal = typed.filter((r) => !isFixture(r.agent));

  const perAgent = new Map();
  for (const r of reds) {
    const e = perAgent.get(r.agent) || { hook: 0, typed: 0, fixture: isFixture(r.agent) };
    if (hookWritten(r)) e.hook++; else e.typed++;
    perAgent.set(r.agent, e);
  }
  const typersReal = new Set(typedReal.map((r) => r.agent));
  const lastTypedReal = typedReal.map((r) => r.at).filter(Boolean).sort().pop() || null;
  const lastTypedAny = typed.map((r) => r.at).filter(Boolean).sort().pop() || null;
  return { byState, reds, hook, hookFixture, typed, typedFixture, typedReal, typersReal, perAgent, lastTypedReal, lastTypedAny };
}

function pad(n) { return String(n).padStart(7); }

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exitCode = 2;
    return;
  }
  const dir = args.dir;
  const data = readRecord(dir);
  if (!data.ok) {
    console.error(data.why + ' ' + dir);
    console.error('That is not an answer -- it is a missing instrument. Nothing below can be concluded.');
    process.exitCode = 1;
    return;
  }
  const s = summarise(data.rows);
  const total = data.rows.length;

  /* 🛑 EVERY GATE RUNS BEFORE ANY stdout. An earlier version printed the header
     block first and then refused, so a caller redirecting stdout got a
     TRUNCATED READING on a refusal, while this file's header promised "only a
     real reading goes to stdout". The promise was false for two of the four
     refusal paths and no arm caught it, because the shell test merges the
     streams. Gates first, printing second: the promise is now structural. */
  const live = hookPrefixIsLive(HOOK_SOURCE);
  if (total === 0) {
    console.error('The record exists and is EMPTY: 0 parseable reports.');
    console.error('That is not an answer -- an empty record has no reds for the same reason it has');
    console.error('no anything. Nothing below can be concluded. Check --dir, or AGENT_WORKFORCE_DATA.');
    process.exitCode = 1;
    return;
  }

  if (live === false) {
    /* 🛑 REFUSE, DO NOT WARN AND CONTINUE. An earlier version printed "the
       verdict cannot be trusted" and then printed the verdict anyway, exiting
       0 -- which is the editorialising-past-your-own-data defect this file
       names below, committed by the very line written to prevent it. A drifted
       marker is a BROKEN INSTRUMENT, not a finding, and it gets the same
       treatment as an empty record. */
    console.error('🛑 MISMATCH: ' + HOOK_SOURCE + ' no longer contains "' + HOOK_PREFIX.trim() + '".');
    console.error('   Every hook-written record would be counted as agent-typed, so the split and the');
    console.error('   verdict would both be wrong. Nothing is printed. Update HOOK_PREFIX to match the hook.');
    process.exitCode = 1;
    return;
    process.exitCode = 1;
    return;
  }

  console.log('SELF-REPORT RECORD   ' + dir);
  console.log('  agent files' + pad(data.files.length));
  console.log('  records' + pad(total));
  console.log('  unparseable lines' + pad(data.unparseable));
  console.log('  UNREADABLE files' + pad(data.unreadableFiles.length)
    + (data.unreadableFiles.length ? '   <- their records are in NO number below: ' + data.unreadableFiles.join(', ') : ''));
  console.log('');

  /* 🛑 ZERO RECORDS IS A NON-RESULT, AND IT USED TO PRINT THIS TOOL'S
     STRONGEST CONCLUSION. An empty-but-existing directory (a fresh machine, a
     wrong --dir, AGENT_WORKFORCE_DATA pointed at a seeded test root) has no
     reds, which is arithmetically the same as "agents never use the verb" and
     factually the opposite. Refused for the same reason a missing directory
     is: "no reds found" and "no record found" are the same number and opposite
     facts, and only the first is evidence. */

  console.log('BY STATE');
  /* Ties broken by name so the control line is deterministic: on a small
     fixture two states can share a count and Map order would decide it. */
  const states = [...s.byState.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  for (const [k, v] of states) console.log('  ' + pad(v) + '  ' + k + (k === RED ? '   <- the board\'s one red state' : ''));
  console.log('');

  console.log('CONTROLS, so a zero below means something');
  console.log('  ' + pad(s.byState.get(IMPOSSIBLE) || 0) + '  a state no writer can produce (' + IMPOSSIBLE + ')  <- must be 0');
  /* ⚠️ NOT LABELLED A CONTROL, BECAUSE IT CANNOT FAIL. `total === 0` is
     already refused above, so the maximum of a non-empty tally is positive by
     construction. It is informative (it names which state dominates) and this
     file's own standard is that a check whose two outcomes are
     indistinguishable is decoration, so it does not get to wear the word. */
  console.log('  ' + pad(states[0][1]) + '  for scale, the most common state (' + states[0][0] + '), '
    + ((states[0][1] / total) * 100).toFixed(1) + '% of the record'
    + '  <- why the verdict does not rest on a share alone');
  if (live === true) {
    console.log('       ok  the hook still writes "' + HOOK_PREFIX.trim() + '" (checked in ' + path.relative(REPO, HOOK_SOURCE) + ')');
  } else {
    console.log('  ?  could not read ' + path.relative(REPO, HOOK_SOURCE) + ', so the marker is UNVERIFIED (not mismatched)');
  }
  console.log('');

  console.log(RED + ' BY PROVENANCE');
  console.log('  ' + pad(s.hook.length) + '  written by the permission hook   (by string match, see header)'
    + (s.hookFixture.length ? '   [' + s.hookFixture.length + ' of them on fixture agents]' : ''));
  console.log('  ' + pad(s.typedFixture.length) + '  typed by a walkthrough FIXTURE  (agent name starts "' + FIXTURE_PREFIX + '", an'
    + ' unlinked convention -- see the [FIXTURE] tags below and judge them)');
  console.log('  ' + pad(s.typedReal.length) + '  typed by a working agent        <- the number rule 3 quotes');
  console.log('  ' + pad(s.typersReal.size) + '  distinct working agents that have EVER typed it');
  console.log('  last typed by a working agent:    ' + (s.lastTypedReal || 'never'));
  console.log('  last typed by anyone (incl fixtures): ' + (s.lastTypedAny || 'never'));
  console.log('');

  if (s.perAgent.size) {
    console.log(RED + ' BY AGENT');
    for (const [name, e] of [...s.perAgent.entries()].sort((a, b) => (b[1].hook + b[1].typed) - (a[1].hook + a[1].typed))) {
      console.log('  ' + pad(e.hook + e.typed) + '  ' + name + (e.fixture ? '  [FIXTURE]' : '') + '   (' + e.hook + ' hook, ' + e.typed + ' typed)');
    }
    console.log('');
  }

  /* 🛑 THE CONCLUSION IS ASSERTED AGAINST THE NUMBERS ABOVE, NOT PRINTED
     REGARDLESS. A tool that editorialises past its own data is the defect one
     layer up, and it has bitten this repo. Both branches are real: if agents
     start typing the verb, this prints so and the sentence in status.js needs
     revisiting rather than repeating. */
  const share = s.typedReal.length / total;
  console.log('WHAT THAT SUPPORTS');
  console.log('  cutoffs, printed so the boundary is not mine to explain:');
  console.log('    working-agent-typed share of all records   under ' + (SHARE_CUTOFF * 100).toFixed(1) + '%');
  console.log('    distinct working agents that have typed it  at most ' + TYPERS_CUTOFF);
  console.log('    observed: ' + (share * 100).toFixed(4) + '% and ' + s.typersReal.size + ' agent(s)'
    + (s.typersReal.size ? ': ' + [...s.typersReal].sort().join(', ') : ''));
  console.log('    (the fixture prefix is "' + FIXTURE_PREFIX + '" and nothing else -- if a name above'
    + ' looks synthetic, the verdict is counting a test as a colleague)');
  console.log('');
  if (s.typedReal.length === 0) {
    console.log('  No working agent has EVER typed ' + RED + ' in this record.');
    console.log('  => the state exists in the vocabulary and has no self-reported source at all.');
  } else if (share < SHARE_CUTOFF && s.typersReal.size <= TYPERS_CUTOFF) {
    console.log('  => ' + RED + ' has, in practice, almost no self-reported source. The board\'s red');
    console.log('     state is load-bearing on the PANE READER today, and narrowing the classifier');
    console.log('     narrows the only path that produces it (status.js rule 3, #1253).');
  } else {
    console.log('  => working agents ARE reporting this state themselves. The claim in status.js');
    console.log('     rule 3 that the red is load-bearing on the pane reader no longer matches the');
    console.log('     record and should be RE-ARGUED rather than repeated.');
  }
}

if (require.main === module) main();

/* Only what the shell test drives. `summarise`, `readRecord`, `hookWritten`
   and `isFixture` were exported and imported by nothing: a name nothing
   consumes is a maintenance promise nobody asked for. */
module.exports = { HOOK_PREFIX, HOOK_SOURCE, FIXTURE_PREFIX, SHARE_CUTOFF, TYPERS_CUTOFF, hookPrefixIsLive };
