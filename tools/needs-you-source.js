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
 *
 * 🔑 WHAT IT CAN AND CANNOT SEE. It reads the SELF-REPORT record, so it can
 * separate a hook-written `needs_you` from an agent-typed one and count both.
 * It CANNOT see the pane reader at all -- a scraped `needs_you` never touches
 * this record, it is composed in `status.reconcileReport` at read time. So the
 * argument this tool supports is by ELIMINATION: if the record shows almost no
 * agent-typed `needs_you`, then the reds the board shows are coming from the
 * one source that leaves no trace here.
 *
 * ⚠️ THE PROVENANCE SPLIT HAS THREE DERIVATIONS AND THEY ARE NOT EQUALLY
 * STRONG. Say which is which, because the next person cannot tell by looking:
 *
 *   fixture records   by AGENT NAME. The record is one file per agent and the
 *                     walkthrough agents are named `walk-*`. Identity. Sound.
 *   hook records      by a STRING MATCH on the hook's own sentence
 *                     (`install/kosmos-report-hook.sh`). NOT sound in
 *                     principle -- see below.
 *   agent-typed       the remainder.
 *
 * 🛑 AND THE STRING MATCH'S ERROR RUNS IN THE DIRECTION THAT FLATTERS THIS
 * TOOL'S OWN CONCLUSION, WHICH IS THE ONE DIRECTION A CAVEAT MUST NOT BE WRONG
 * IN. An earlier version of this header called it "the safe direction" and had
 * it exactly backwards. The conclusion here IS "agent-typed is near zero", and
 * a misclassification can only make agent-typed look SMALLER, so every error
 * makes the sentence look better supported than it is.
 * ✅ Bounded rather than argued: granting EVERY hook-classified record to the
 * agents leaves 8 of 26,269 outside the fixtures, 0.03%, a third of the cutoff
 * below. The conclusion survives its own worst case; the label was still wrong.
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
/* The data root is `engine/store.js`'s to own. Requiring it rather than
   re-deriving `~/Library/Application Support/...` here means this tool cannot
   drift from the app (an earlier version used `process.env.HOME` where store
   uses `os.homedir()`), and `AGENT_WORKFORCE_DATA` is honoured for free.
   `tools/check-block-delivery.js` requires from `engine/` the same way. */
const store = require(path.join(REPO, 'engine', 'store.js'));

/* `install/kosmos-report-hook.sh` writes exactly this prefix on a
   PermissionRequest. 🛑 A CONSTANT DOES NOT MAKE THIS SAFE ON ITS OWN -- the
   hook is a separate file and nothing links them, so a reworded hook would
   make this read 0, reclassify every hook record as agent-typed, and print the
   same verdict with an inverted split. `hookPrefixIsLive` below is the link. */
const HOOK_PREFIX = 'asking permission to use ';
const HOOK_SOURCE = path.join(REPO, 'install', 'kosmos-report-hook.sh');

/* Walkthrough agents (#1253's own evidence: `walk-birch`, `walk-cedar`) are
   FIXTURES, not colleagues. They are named here rather than eyeballed off the
   per-agent table, because the verdict must not be flippable by a fixture run:
   14 of the 15 agent-typed records on this machine are theirs, and one more
   walkthrough at the same volume would otherwise print "agents ARE reporting
   this state themselves" on the strength of test traffic. */
const FIXTURE_PREFIX = 'walk-';

const RED = 'needs_you';
/* A state name no writer can produce: `selfreport.js` STATES is a closed list,
   and an unknown word is skipped on read. Its count MUST be 0, and a non-zero
   means this tool is counting something other than what it says it is. */
const IMPOSSIBLE = 'zzz_no_such_state';

/* 🔑 THE VERDICT DOES NOT REST ON THE SHARE, AND THAT IS DELIBERATE. 77% of the
   record is `working` heartbeats, so a share-only threshold gets harder to trip
   every day for reasons that have nothing to do with whether agents use the
   verb -- the same real adoption rate would need several times as many typed
   reports a month from now. DISTINCT NON-FIXTURE AGENTS does not drift: it is
   one if one agent has ever typed it, whatever the heartbeat volume. */
const SHARE_CUTOFF = 0.001;   // 0.1% of all records
const TYPERS_CUTOFF = 2;      // distinct non-fixture agents that have ever typed it

function parseArgs(argv) {
  let dir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') {
      /* 🛑 PRESENT-BUT-EMPTY IS AN ERROR, NEVER A FALLBACK. `--dir "$UNSET"`
         used to fall through to the LIVE record while the caller believed it
         was reading a fixture, which silently breaks the shell test's promise
         that nothing there touches production data. */
      const value = argv[i + 1];
      if (value === undefined || String(value).trim() === '') {
        return { error: '--dir was given with no value. Pass a directory, or omit --dir to read the live record.' };
      }
      dir = value;
      i++;
    }
  }
  return { dir: dir || path.join(store.ROOT, 'selfreports') };
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
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { unparseable++; continue; }
      if (!o || typeof o !== 'object') { unparseable++; continue; }
      rows.push({
        agent: f.replace(/\.jsonl$/, ''),
        state: String(o.state || ''),
        because: String(o.because || ''),
        at: String(o.at || ''),
      });
    }
  }
  return { ok: true, why: null, dir, files, rows, unparseable };
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
  return { byState, reds, hook, typed, typedFixture, typedReal, typersReal, perAgent, lastTypedReal, lastTypedAny };
}

function pad(n) { return String(n).padStart(7); }

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.log(args.error);
    process.exitCode = 2;
    return;
  }
  const dir = args.dir;
  const data = readRecord(dir);
  if (!data.ok) {
    console.log(data.why + ' ' + dir);
    console.log('That is not an answer -- it is a missing instrument. Nothing below can be concluded.');
    process.exitCode = 1;
    return;
  }
  const s = summarise(data.rows);
  const total = data.rows.length;

  console.log('SELF-REPORT RECORD   ' + dir);
  console.log('  agent files' + pad(data.files.length));
  console.log('  records' + pad(total));
  console.log('  unparseable' + pad(data.unparseable));
  console.log('');

  /* 🛑 ZERO RECORDS IS A NON-RESULT, AND IT USED TO PRINT THIS TOOL'S
     STRONGEST CONCLUSION. An empty-but-existing directory (a fresh machine, a
     wrong --dir, AGENT_WORKFORCE_DATA pointed at a seeded test root) has no
     reds, which is arithmetically the same as "agents never use the verb" and
     factually the opposite. Refused for the same reason a missing directory
     is: "no reds found" and "no record found" are the same number and opposite
     facts, and only the first is evidence. */
  if (total === 0) {
    console.log('The record exists and is EMPTY: 0 parseable reports.');
    console.log('That is not an answer -- an empty record has no reds for the same reason it has');
    console.log('no anything. Nothing below can be concluded. Check --dir, or AGENT_WORKFORCE_DATA.');
    process.exitCode = 1;
    return;
  }

  console.log('BY STATE');
  const states = [...s.byState.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of states) console.log('  ' + pad(v) + '  ' + k + (k === RED ? '   <- the board\'s one red state' : ''));
  console.log('');

  console.log('CONTROLS, so a zero below means something');
  console.log('  ' + pad(s.byState.get(IMPOSSIBLE) || 0) + '  a state no writer can produce (' + IMPOSSIBLE + ')  <- must be 0');
  console.log('  ' + pad(states[0][1]) + '  the most common state (' + states[0][0] + ')  <- must be > 0');
  const live = hookPrefixIsLive(HOOK_SOURCE);
  if (live === true) {
    console.log('       ok  the hook still writes "' + HOOK_PREFIX.trim() + '" (checked in ' + path.relative(REPO, HOOK_SOURCE) + ')');
  } else if (live === false) {
    console.log('  🛑 MISMATCH: ' + path.relative(REPO, HOOK_SOURCE) + ' no longer contains "' + HOOK_PREFIX.trim() + '".');
    console.log('     Every hook-written record is now being counted as agent-typed. The split below');
    console.log('     is WRONG and the verdict cannot be trusted. Update HOOK_PREFIX to match the hook.');
  } else {
    console.log('  ?  could not read ' + path.relative(REPO, HOOK_SOURCE) + ', so the marker is UNVERIFIED (not mismatched)');
  }
  console.log('');

  console.log(RED + ' BY PROVENANCE');
  console.log('  ' + pad(s.hook.length) + '  written by the permission hook   (by string match, see header)');
  console.log('  ' + pad(s.typedFixture.length) + '  typed by a walkthrough FIXTURE  (agent name starts "' + FIXTURE_PREFIX + '")');
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
  console.log('    observed: ' + (share * 100).toFixed(4) + '% and ' + s.typersReal.size + ' agent(s)');
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

module.exports = { HOOK_PREFIX, HOOK_SOURCE, FIXTURE_PREFIX, SHARE_CUTOFF, TYPERS_CUTOFF, hookWritten, isFixture, hookPrefixIsLive, summarise, readRecord };
