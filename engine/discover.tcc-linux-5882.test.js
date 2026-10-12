'use strict';
/**
 * kosmos#5882: on a platform with no folder permission (Linux, Windows), the import scan walks ~/Documents,
 * ~/Downloads and ~/Desktop in the engine. Only macOS hands them to the app's hatch (#2125). Before, all three were
 * marked tcc on every platform, so a Linux board sent them to a hatch nothing answers and never read them.
 *
 * 🛑 SANDBOXED: HOME is a mkdtemp folder; the hatch is a stand-in that records what it is handed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tcc5882-')));
process.env.HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
fs.mkdirSync(process.env.HOME, { recursive: true });
const discover = require('./discover');
const platform = require('./platform');
test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

const AGENT = 'You are **Probe**, a project manager.\n\nMore text so the head reads.\n';
const docsAgent = path.join(process.env.HOME, 'Documents', 'probe');
fs.mkdirSync(docsAgent, { recursive: true });
fs.writeFileSync(path.join(docsAgent, 'CLAUDE.md'), AGENT);

function hatch() {
  const calls = [];
  const fn = (roots) => { calls.push(roots.map((r) => path.basename(r.dir))); return { dirs: [], loose: [], bounded: {} }; };
  fn.calls = calls;
  return fn;
}
const dirsOf = (r) => ((r && r.candidates) || []).map((c) => c.dir);

test('#5882: only macOS has the folder permission', () => {
  assert.equal(platform.hasFolderPermission('darwin'), true);
  for (const p of ['linux', 'win32', 'freebsd']) assert.equal(platform.hasFolderPermission(p), false, p);
});

test('#5882: on Linux and Windows the import roots carry no tcc mark; on macOS all three do', () => {
  for (const p of ['linux', 'win32']) {
    const roots = discover.defaultScanRoots({ importScan: true, platform: p }).filter((r) => ['Documents', 'Downloads', 'Desktop'].includes(path.basename(r.dir)));
    assert.equal(roots.length, 3, p);
    assert.ok(roots.every((r) => r.tcc !== true), `${p}: a folder was routed to the hatch`);
  }
  const mac = discover.defaultScanRoots({ importScan: true, platform: 'darwin' }).filter((r) => r.tcc === true);
  assert.deepEqual(mac.map((r) => path.basename(r.dir)).sort(), ['Desktop', 'Documents', 'Downloads']);
});

test('#5882: a Linux import scan FINDS an agent in ~/Documents and hands nothing to the hatch; macOS (control) hands it over', () => {
  for (const p of ['linux', 'win32']) {
    const h = hatch();
    const r = discover.scan({ importScan: true, platform: p, tccScan: h });
    assert.ok(dirsOf(r).includes(docsAgent), `${p}: the agent in Documents was not found`);
    assert.equal(h.calls.flat().length, 0, `${p}: the hatch was asked`);
  }
  const h = hatch();
  const mac = discover.scan({ importScan: true, platform: 'darwin', tccScan: h });
  assert.deepEqual(h.calls.flat().sort(), ['Desktop', 'Documents', 'Downloads'], 'CONTROL: macOS hands the three to the hatch');
  assert.ok(!dirsOf(mac).includes(docsAgent), 'CONTROL: on macOS the engine itself does not walk Documents');
});
