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
 *
 * kosmos#8928: argv[2] is the agent's name (the supervisor passes its session name),
 * and the printed path is that agent's own config; with no name, the shared one.
 */
try {
  /* kosmos#8928 slice 2: run as a program (the supervisor's real launch), it may end this agent's own orphaned browser
     servers; required by anything else, it may not. */
  const live = require.main === module && process.platform === 'darwin';   // Windows stays off until measured there
  const p = require('./agentbrowser').launchConfig({ install: false, node: process.execPath, agent: process.argv[2], orphans: { live } });   // kosmos#8928
  if (p) process.stdout.write(p + '\n');
} catch { /* no browser this launch */ }
/* exitCode, not exit(): a natural exit lets stdout finish writing to the pipe. */
process.exitCode = 0;
