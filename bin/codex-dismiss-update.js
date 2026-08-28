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
 * 🔑 The rule itself lives in engine/codexupdate.js, shared with creation, and
 * that module has no dependencies precisely so this shim stays cheap enough to
 * run in a launch path.
 */

try {
  const { dismissUpdateNotice } = require('../engine/codexupdate');
  dismissUpdateNotice(process.argv[2] || undefined);
} catch { /* never break a launch */ }
process.exit(0);
