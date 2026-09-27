#!/usr/bin/env node
'use strict';

/*
 * #2808 class-1 (c): DRY-RUN inspector for the invisible auto-handle.
 *
 * Given agent names, it reads each one's standing self-report and prints what the
 * auto-handle WOULD do (none / trust-and-restart / escalate) - and does NOTHING
 * else. There is deliberately no --arm flag here: the armed execution
 * (runClass1Handle -> trustAgentFolder + restart) is the "one wire-up from class-2"
 * (#2808 (c)), and it needs two things this standalone tool does not carry - a
 * PERSISTENT per-agent attempts store (so the loop-guard remembers across
 * invocations, not just within one) and the class-2 by/permissionAsk classification
 * Angel is building. Shipping an armed path here without the persistent attempts
 * store would give an unguarded restart loop, so this stays read-only.
 *
 * Usage:  node bin/class1-autohandle.js <agent-name> [<agent-name> ...]
 *
 * Exit 0 always (an inspector must never be the thing that breaks a supervision
 * sweep that shells out to it).
 */

const selfreport = require('../engine/selfreport');
const { sweepClass1, standingFromAgent } = require('../engine/class1-autohandle');

/* #4169: a self-report goes through the SAME adapter the board's armed sweep uses (standingFromAgent), so this dry-run
   and the board give one answer. A self-report carries no screen, so it can never show the folder-trust dialog, and a
   by:auto report on its own (a tool prompt) plans none here exactly as it does on the board. */
function standingOf(name) {
  const s = selfreport.read(name);
  if (!s || s.found !== true) return s;
  return standingFromAgent({ state: s.state, stateReportedBy: s.by || null, because: s.because });
}

function main(argv) {
  const names = argv.slice(2).filter((a) => a && !a.startsWith('-'));
  if (names.length === 0) {
    process.stderr.write('usage: class1-autohandle.js <agent-name> [<agent-name> ...]  (dry-run only; prints the plan, takes no action)\n');
    return;
  }
  // No persistent attempts store in this dry-run tool, so the loop-guard sees no
  // history: every class-1 wait plans as trust-and-restart, never escalate. That is
  // correct for a dry run (it shows the fresh decision); the armed path supplies a
  // real attemptsFor.
  const plans = sweepClass1(names, { read: standingOf }, Date.now());
  process.stdout.write('class1-autohandle DRY-RUN (no action taken)\n');
  process.stdout.write('note: from self-reports only; the board restarts only for the folder-trust dialog, which shows only on screen, so a self-report alone never plans a restart here\n');
  for (const { name, plan } of plans) {
    process.stdout.write(`  ${name}: ${plan.act} - ${plan.because}\n`);
  }
}

if (require.main === module) {
  try { main(process.argv); }
  catch (err) { process.stderr.write('class1-autohandle: ' + String((err && err.message) || err) + '\n'); }
  process.exit(0);
}

module.exports = { main };
