'use strict';

/**
 * #4340 (review of #4365): prove a test's store writes land in ITS sandbox, measured against the operator's
 * REAL data root rather than against the environment variable the test set.
 *
 * ⚠️ WHY NOT `store.ROOT.startsWith(process.env.AGENT_WORKFORCE_DATA)`: agent panes export
 * AGENT_WORKFORCE_DATA as an EMPTY string, and `startsWith('')` is always true, so that check passed while a
 * fake-HOME run wrote a thread file into the real store. Here the sandbox is the path the test MADE, passed in,
 * and an empty or unset variable is treated as unset (dataRootFor already ignores an empty one, so the root it
 * then answers is the real one, and this refuses it).
 *
 * The real root is derived from the ACCOUNT's home (os.userInfo), not $HOME or AGENT_WORKFORCE_HOME, which a
 * test may have pointed at a sandbox: those would make the "real" root the sandbox and the check vacuous.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../engine/store');

function realDataRoot() {
  return store.dataRootFor(process.platform, os.userInfo().homedir, { APPDATA: process.env.APPDATA });
}

/* Resolve the nearest EXISTING ancestor and re-attach the rest: a root or thread file not yet written has no
   realpath, and comparing its /var spelling with the sandbox's /private/var one would refuse a good sandbox. */
function real(p) {
  const abs = path.resolve(p);
  let head = abs; const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync(head), ...rest); } catch { /* not there yet */ }
    const up = path.dirname(head);
    if (up === head) return abs;
    rest.unshift(path.basename(head)); head = up;
  }
}
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/** Throws unless every path (default: store.ROOT) is inside `sandbox` and none is inside the real data root. */
function assertSandboxedDataRoot(sandbox, paths) {
  if (typeof sandbox !== 'string' || !sandbox) throw new Error('assertSandboxedDataRoot: no sandbox path given');
  const env = process.env.AGENT_WORKFORCE_DATA;
  if (!env) throw new Error('the data root is not sandboxed: AGENT_WORKFORCE_DATA is ' + JSON.stringify(env ?? null));
  const box = real(sandbox);
  const home = real(realDataRoot());
  if (inside(box, home) || inside(home, box)) throw new Error(`the sandbox ${box} overlaps the real data root ${home}`);
  for (const p of (paths && paths.length ? paths : [store.ROOT])) {
    const at = real(p);
    if (!inside(at, box)) throw new Error(`${at} is outside the sandbox ${box}`);
    if (inside(at, home)) throw new Error(`${at} is inside the real data root ${home}`);
  }
}

module.exports = { assertSandboxedDataRoot, realDataRoot };
