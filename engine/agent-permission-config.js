#!/usr/bin/env node
'use strict';
/*
 * #5406: print the --settings path for ONE Claude agent launch, or nothing. bin/agent-supervisor.sh runs this with
 * Kosmos's own node on the Claude arm and adds `--settings <path>` only when a path comes back (the same shape as
 * agent-browser-config.js). The file holds one PermissionRequest hook (engine/agentpermission.js), so the agent goes
 * ahead instead of stopping on a prompt the person's own ask rules raise. The node that runs this is the node the hook
 * will run with.
 *
 * Always exits 0 and prints nothing on any failure: an agent that may prompt is fine, an agent that does not start is not.
 */
try {
  const p = require('./agentpermission').ensureSettings({ node: process.execPath });
  if (p) process.stdout.write(p + '\n');
} catch { /* this launch goes without it */ }
process.exitCode = 0;
