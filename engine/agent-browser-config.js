#!/usr/bin/env node
'use strict';
/*
 * #3633: print the agent browser's --mcp-config path for ONE Mac agent launch, or
 * nothing. bin/agent-supervisor.sh runs this with Kosmos's own node on the Claude
 * arm and adds `--mcp-config <path>` only when a path comes back.
 *
 * Never installs from here (install:false): the install is about 100 MB and this
 * sits in front of an agent's start. The board starts the install at boot; a launch
 * before it lands starts without a browser, and the next (re)launch picks it up.
 *
 * Always exits 0 and prints nothing on any failure: an agent without a browser is
 * fine, an agent that does not start is not.
 */
try {
  const p = require('./agentbrowser').launchConfig({ install: false, node: process.execPath });
  if (p) process.stdout.write(p + '\n');
} catch { /* no browser this launch */ }
process.exit(0);
