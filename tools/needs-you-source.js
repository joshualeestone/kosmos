#!/usr/bin/env node
'use strict';
/**
 * Where does the board's one RED state actually come from?
 *
 * 🛑 WHY THIS EXISTS. `needs_you` has three possible sources -- a hook, an
 * agent typing `kosmos report needs_you`, and the pane reader -- and the code
 * reads as though all three are live. Only one of them produces it in
 * practice. #1253 measured that once, in a card comment, as a frozen number;
 * a number in a comment is true on the day it is written and unfalsifiable
 * afterwards. This is the same measurement as a command, so the claim in
 * `status.js`'s rule 3 can be re-run instead of believed.
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
 * ⚠️ THE PROVENANCE SPLIT IS A STRING MATCH, AND THAT IS A REAL LIMIT. The
 * record does not carry WHO WROTE THE LINE: `report --auto` is a write-time
 * discriminator (`selfreport.js:109`) and is not persisted. The only mechanical
 * marker left is the hook's own sentence, `install/kosmos-report-hook.sh:218`.
 * So an agent that types those exact words is counted as a hook, which biases
 * the count in the SAFE direction for this argument (it can only make
 * agent-typed look smaller than it is, never larger).
 */
const fs = require('node:fs');
const path = require('node:path');

/* `install/kosmos-report-hook.sh:218` writes exactly this prefix on a
   PermissionRequest. Kept as one constant so a change to the hook's wording
   fails this tool loudly (the count collapses) rather than quietly. */
const HOOK_PREFIX = 'asking permission to use ';

const RED = 'needs_you';
/* A state name no writer can produce: `selfreport.js` STATES is a closed list,
   and an unknown word is skipped on read. Its count MUST be 0, and a non-zero
   means this tool is counting something other than what it says it is. */
const IMPOSSIBLE = 'zzz_no_such_state';

function defaultDir() {
  const base = process.env.AGENT_WORKFORCE_DATA
    ? path.join(process.env.AGENT_WORKFORCE_DATA, 'AgentWorkforce')
    : path.join(process.env.HOME || '', 'Library', 'Application Support', 'AgentWorkforce');
  return path.join(base, 'selfreports');
}

function parseArgs(argv) {
  let dir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') { dir = argv[i + 1] || null; i++; }
  }
  return { dir: dir || defaultDir() };
}

function read(dir) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return { ok: false, dir, files: [], rows: [], unparseable: 0 };
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
      rows.push({ agent: f.replace(/\.jsonl$/, ''), state: String(o.state || ''), because: String(o.because || ''), at: String(o.at || '') });
    }
  }
  return { ok: true, dir, files, rows, unparseable };
}

function hookWritten(row) {
  return row.because.startsWith(HOOK_PREFIX);
}

function summarise(rows) {
  const byState = new Map();
  for (const r of rows) byState.set(r.state, (byState.get(r.state) || 0) + 1);

  const reds = rows.filter((r) => r.state === RED);
  const hook = reds.filter(hookWritten);
  const typed = reds.filter((r) => !hookWritten(r));

  const perAgent = new Map();
  for (const r of reds) {
    const e = perAgent.get(r.agent) || { hook: 0, typed: 0 };
    if (hookWritten(r)) e.hook++; else e.typed++;
    perAgent.set(r.agent, e);
  }
  const lastTyped = typed.map((r) => r.at).filter(Boolean).sort().pop() || null;
  return { byState, reds, hook, typed, perAgent, lastTyped };
}

function pad(n) { return String(n).padStart(7); }

function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const data = read(dir);
  if (!data.ok) {
    console.log('no self-report record at ' + dir);
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

  console.log('BY STATE');
  const states = [...s.byState.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of states) console.log('  ' + pad(v) + '  ' + k + (k === RED ? '   <- the board\'s one red state' : ''));
  console.log('');

  console.log('CONTROLS, so a zero below means something');
  console.log('  ' + pad(s.byState.get(IMPOSSIBLE) || 0) + '  a state no writer can produce (' + IMPOSSIBLE + ')  <- must be 0');
  console.log('  ' + pad(states.length ? states[0][1] : 0) + '  the most common state (' + (states.length ? states[0][0] : 'none') + ')  <- must be > 0');
  console.log('');

  console.log(RED + ' BY PROVENANCE');
  console.log('  ' + pad(s.hook.length) + '  written by the permission hook  ("' + HOOK_PREFIX.trim() + ' ...")');
  console.log('  ' + pad(s.typed.length) + '  typed by an agent');
  console.log('  ' + pad(s.perAgent.size) + '  distinct agents with any ' + RED + ' at all');
  console.log('  last typed by an agent: ' + (s.lastTyped || 'never'));
  console.log('');

  if (s.perAgent.size) {
    console.log(RED + ' BY AGENT   (judge for yourself which of these are real agents)');
    for (const [name, e] of [...s.perAgent.entries()].sort((a, b) => (b[1].hook + b[1].typed) - (a[1].hook + a[1].typed))) {
      console.log('  ' + pad(e.hook + e.typed) + '  ' + name + '   (' + e.hook + ' hook, ' + e.typed + ' typed)');
    }
    console.log('');
  }

  /* 🛑 THE CONCLUSION IS ASSERTED AGAINST THE NUMBERS ABOVE, NOT PRINTED
     REGARDLESS. A tool that editorialises past its own data is the defect one
     layer up, and it has bitten this repo. Both branches are real: if agents
     start typing the verb, this prints so and the sentence in status.js needs
     revisiting. */
  const share = total ? (s.typed.length / total) : 0;
  /* The cutoff is printed rather than left in the code, because a boundary only
     its author can explain turns a machine-answerable question into a question
     for its author. One in a thousand: at that rate the state is not a channel
     agents use, it is a rounding error beside `working` and `idle`. */
  console.log('WHAT THAT SUPPORTS   (cutoff: agent-typed under 0.1% of all records)');
  if (s.typed.length === 0) {
    console.log('  No agent has EVER typed ' + RED + ' in this record.');
    console.log('  => the state exists in the vocabulary and has no self-reported source at all.');
  } else if (share < 0.001) {
    console.log('  Agent-typed ' + RED + ': ' + s.typed.length + ' of ' + total + ' records (' + (share * 100).toFixed(4) + '%).');
    console.log('  => ' + RED + ' has, in practice, almost no self-reported source. The board\'s red');
    console.log('     state is load-bearing on the PANE READER today, and narrowing the classifier');
    console.log('     narrows the only path that produces it (status.js rule 3, #1253).');
  } else {
    console.log('  Agent-typed ' + RED + ': ' + s.typed.length + ' of ' + total + ' records (' + (share * 100).toFixed(4) + '%).');
    console.log('  => agents ARE reporting this state themselves. The claim in status.js rule 3 that');
    console.log('     the red is load-bearing on the pane reader no longer matches the record and');
    console.log('     should be re-argued rather than repeated.');
  }
}

if (require.main === module) main();

module.exports = { HOOK_PREFIX, hookWritten, summarise, read };
