'use strict';
/**
 * #7206 slice 1b: the vendor-provider switch for tests. The switch is the marker file `compat-providers-on` in the data
 * folder (engine/anthropiccompat.js enabled()); there is no environment variable. In-process, the data folder is
 * store.ROOT (a throwaway folder in a test process, or the test's AGENT_WORKFORCE_DATA). A child process (the supervisor,
 * the launch-env CLI) is given its own data folder with AGENT_WORKFORCE_DATA, and the marker is written there: never
 * the real data folder.
 */
const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'compat-providers-on';
/* The data folder a process with AGENT_WORKFORCE_DATA=<dataDir> reads, from the store's own rule (it adds the app folder). */
function rootFor(dataDir) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('compat-switch: a test data folder must be an absolute path');
  return require('../engine/store').dataRootFor(process.platform, require('node:os').homedir(), { AGENT_WORKFORCE_DATA: dataDir });
}
/* Review 4: the marker is only ever written or removed under the system temp folder, so no caller (a missing argument,
   a real-root override) can turn the REAL board's switch on or off. */
function guard(root) {
  const tmp = fs.realpathSync(require('node:os').tmpdir());
  // The nearest folder that exists, resolved (macOS spells the temp folder /var/... and resolves it to /private/var/...).
  let base = path.resolve(root); const rest = [];
  while (!fs.existsSync(base) && path.dirname(base) !== base) { rest.unshift(path.basename(base)); base = path.dirname(base); }
  const real = path.join(fs.realpathSync(base), ...rest);
  if (!(real === tmp || real.startsWith(tmp + path.sep))) throw new Error('compat-switch: refusing a data folder outside the temp folder: ' + real);
}
function markerAt(root) { return path.join(root, MARKER); }
/** Set the switch for a process started with AGENT_WORKFORCE_DATA=<dataDir> (a child, or this test's own data env). */
function setAt(dataDir, on) { setRoot(rootFor(dataDir), on); }
function setRoot(root, on) {
  guard(root);
  const m = markerAt(root);
  if (on) { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(m, ''); }
  else { try { fs.rmSync(m, { force: true }); } catch { /* absent */ } }
}
/** This process's switch (its store.ROOT). */
function set(on) { setRoot(require('../engine/store').ROOT, on); }
/** Run fn with this process's switch on or off, putting back what was there. */
function withSwitch(on, fn) {
  const m = markerAt(require('../engine/store').ROOT);
  const was = fs.existsSync(m);
  set(on);
  const back = () => set(was);
  let out;
  try { out = fn(); } catch (e) { back(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(back);
  back();
  return out;
}

module.exports = { MARKER, markerAt, rootFor, setAt, setRoot, set, withSwitch };
