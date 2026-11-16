#!/usr/bin/env node
'use strict';

/**
 * Answer codex's update notice before a codex agent starts (#1315).
 *
 * 🛑 RUN FROM THE SUPERVISOR, ON EVERY CODEX LAUNCH. #1332 dismissed the notice
 * at CREATION, which unblocked new agents and left the class open: when OpenAI
 * ships the next release, `latest_version` moves, the creation-time dismissal
 * stops matching, and every EXISTING agent meets a blocking prompt again on its
 * next restart. The board reads that pane as `unknown`, so nothing says so.
 *
 * ⚠️ IT MUST NEVER BREAK A LAUNCH. Every failure path is a silent no-op and the
 * exit status is always 0: an agent that will not start because its update
 * notice could not be dismissed is a far worse outcome than the prompt this
 * exists to remove. The supervisor calls it without checking, deliberately.
 *
 * 🔑 The rules live in engine/codexupdate.js, shared with creation. The update
 * dismissal needs nothing; the model-migration pin (kosmos#8597) can take up to
 * a few seconds at launch (bounded), and never stops one.
 */

/* kosmos#8597: both steps (the update notice and the model-migration menu) live in engine/codexupdate.js's
   launchPrep, which the supervisor runs through its engine path whenever it has one. This shim makes the same call,
   for a layout with no engine path and for a person running it by hand. */
(async () => {
  try { await require('../engine/codexupdate').launchPrep(process.argv.slice(2)); } catch { /* never break a launch */ }
  process.exit(0);
})();
