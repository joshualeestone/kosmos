'use strict';
/**
 * #5999: the Windows uninstall takes THIS install's report hooks back out of Claude Code's settings (the default
 * account's and every ~/.claude-* one's), keeping everything else: a person's own hook, another install's, and a
 * person's hook that shares an entry with ours. Only once no board and no agent task is left to wire them back, and
 * never through a held lock. #5998 is the Mac and Linux half (install/setup.sh); its matching rules are these.
 *
 * 🛑 NOTHING REAL IS TOUCHED: every settings file is in a scratch home, every schtasks call goes to a stub runner,
 * and the board look is a stub that answers "nobody".
 *
 *   node --test engine/win32uninstall.unhooks-5999.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reporthook = require('./reporthook');
const win32job = require('./win32job');
const win32board = require('./win32board');
const uninstaller = require('./win32uninstall');

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-unhooks-5999-'));
test.after(() => { fs.rmSync(SCRATCH, { recursive: true, force: true }); });
test.afterEach(() => { win32job.setRunner(null); win32board.setRunner(null); delete process.env.AGENT_WORKFORCE_LOCK_MS; });

/* Windows paths as the board writes them: exec form, the bundled node and the script, both inside the bundle. */
const BUNDLE = 'C:\\Users\\someone\\Downloads\\Kosmos';
const NODE = BUNDLE + '\\runtime\\node.exe';
const SCRIPT = BUNDLE + '\\app\\engine\\kosmos-report-hook.js';
const ours = () => reporthook.entryFor(SCRIPT, { platform: 'win32', node: NODE });
const OTHER_INSTALL = { matcher: '', hooks: [{ type: 'command', command: 'C:\\Kosmos2\\runtime\\node.exe', args: ['C:\\Kosmos2\\app\\engine\\kosmos-report-hook.js'], timeout: 15 }] };
const PERSONS = { matcher: 'Bash', hooks: [{ type: 'command', command: 'C:\\tools\\audit.exe' }] };

let n = 0;
function home() { n += 1; const h = path.join(SCRATCH, 'home' + n); fs.mkdirSync(h, { recursive: true }); return h; }
function writeJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); }
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/* Every event wired as the board wires it, plus the neighbours that must survive. */
function wiredSettings() {
  const hooks = {};
  for (const ev of reporthook.HOOK_EVENTS) hooks[ev] = [ours()];
  hooks.PreToolUse = [PERSONS, ours(), OTHER_INSTALL];
  // A person's hook added INTO our entry: theirs stays, in the same entry.
  const shared = ours(); shared.hooks.push({ type: 'command', command: 'C:\\tools\\notify.exe' });
  hooks.Stop = [shared];
  return { model: 'opus', hooks };
}

test('#5999: only this install\'s hooks go; a person\'s own, another install\'s and a shared entry\'s other hook stay', () => {
  const file = path.join(home(), '.claude', 'settings.json');
  writeJson(file, wiredSettings());
  const r = reporthook.unwireInstall(file, [BUNDLE]);
  assert.deepEqual(r, { ours: true, dead: 0, changed: true });
  const after = readJson(file);
  assert.equal(after.model, 'opus', 'a setting that is not a hook was changed');
  assert.deepEqual(after.hooks.PreToolUse, [PERSONS, OTHER_INSTALL], 'the neighbours of our entry were not kept as they were');
  assert.deepEqual(after.hooks.Stop, [{ matcher: '', hooks: [{ type: 'command', command: 'C:\\tools\\notify.exe' }] }], 'a person\'s hook in our entry was lost');
  const left = Object.keys(after.hooks).sort();
  assert.deepEqual(left, ['PreToolUse', 'Stop'], 'an event holding only our entry was not removed');
  assert.ok(!JSON.stringify(after).includes('Downloads\\\\Kosmos'), 'something of this install is still in the file');
});

test('#5999: matched without case and with either separator (Windows paths); the old shell form too; hooks goes when empty', () => {
  const file = path.join(home(), '.claude', 'settings.json');
  writeJson(file, { hooks: {
    Stop: [ours()],
    Notification: [{ matcher: '', hooks: [{ type: 'command', command: '"c:\\users\\SOMEONE\\downloads\\kosmos\\runtime\\node.exe" "c:\\users\\someone\\downloads\\kosmos\\app\\engine\\kosmos-report-hook.js"' }] }],
  } });
  const r = reporthook.unwireInstall(file, ['c:/Users/Someone/Downloads/Kosmos/']);
  assert.deepEqual(r, { ours: true, dead: 0, changed: true });
  assert.deepEqual(readJson(file), {}, 'hooks should be gone entirely once nothing is left in it');
});

test('#5999: a root counts only at the start or after a quote or space: C:\\Kosmos2 and X:\\backup\\C:\\... are not inside', () => {
  const file = path.join(home(), '.claude', 'settings.json');
  const lookalike = { matcher: '', hooks: [{ type: 'command', command: 'X:\\backup' + NODE, args: ['X:\\backup\\' + SCRIPT] }] };
  const before = { hooks: { Stop: [OTHER_INSTALL, lookalike] } };
  writeJson(file, before);
  assert.deepEqual(reporthook.unwireInstall(file, ['C:\\Kosmos']), { ours: false, dead: 0, changed: false }, 'C:\\Kosmos2 was read as inside C:\\Kosmos');
  assert.deepEqual(reporthook.unwireInstall(file, [BUNDLE]), { ours: false, dead: 0, changed: false }, 'a path that only contains the bundle was read as inside it');
  assert.deepEqual(readJson(file), before);
});

test('#5999: a dry run says ours and writes nothing; an unreadable file is named, never rewritten', () => {
  const h = home();
  const file = path.join(h, '.claude', 'settings.json');
  writeJson(file, wiredSettings());
  const bytes = fs.readFileSync(file, 'utf8');
  assert.deepEqual(reporthook.unwireInstall(file, [BUNDLE], { dryRun: true }), { ours: true, dead: 0, changed: false });
  assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'a dry run wrote the file');
  const broken = path.join(h, '.claude-work1', 'settings.json');
  const text = JSON.stringify(wiredSettings()).slice(0, -1);   // a cut-off file: not JSON any more
  fs.mkdirSync(path.dirname(broken), { recursive: true }); fs.writeFileSync(broken, text);
  const r = reporthook.unwireInstall(broken, [BUNDLE]);
  assert.equal(r.ours, true, 'an unreadable file holding our hook was not reported');
  assert.equal(r.changed, false);
  assert.ok(r.because);
  assert.equal(fs.readFileSync(broken, 'utf8'), text, 'an unreadable file was rewritten');
  assert.deepEqual(reporthook.unwireInstall(path.join(h, 'absent', 'settings.json'), [BUNDLE]), { ours: false, dead: 0, changed: false });
});

/* ---- through the uninstall ---- */
const NOT_FOUND = { ok: false, out: 'ERROR: The system cannot find the file specified.' };
const row = (taskPath) => '"\\' + taskPath + '","N/A","Ready"';
const listing = (paths) => ({ ok: true, out: [row('Microsoft\\Windows\\Defrag\\ScheduledDefrag'), ...paths.map(row)].join('\r\n') + '\r\n' });
function stubSchedulers(lists) {
  let listed = 0;
  const answer = (args) => {
    if (args[0] === '/Query' && !args.includes('/TN')) { const l = lists[Math.min(listed, lists.length - 1)]; listed += 1; return l; }
    if (args[0] === '/Query') return NOT_FOUND;
    return { ok: true, out: 'SUCCESS' };
  };
  win32job.setRunner(answer);
  win32board.setRunner(answer);
}
function run(h, extra) {
  const base = path.dirname(h);
  return uninstaller.uninstall({
    platform: 'win32', home: h, env: { APPDATA: path.join(base, 'Roaming'), LOCALAPPDATA: path.join(base, 'Local'), USERNAME: 'someone', USERDOMAIN: 'BOX' },
    projectsRoot: path.join(h, 'Kosmos', 'Projects'), port: 9, probe: async () => ({ answering: false, outcome: 'refused', identity: null, startedByTask: null }),
    removeFolder: () => {}, sleep: async () => {}, liveExecutionAllowed: () => true, bundleRoot: BUNDLE,
    pathExists: (p) => /Kosmos2/.test(p),   // another install is on disk; every other Windows path in here is not
    ...extra,
  });
}

test('#5999: the uninstall takes the hooks out of the default account\'s file and every .claude-* one\'s, and says so', async () => {
  const h = home();
  const def = path.join(h, '.claude', 'settings.json');
  const work = path.join(h, '.claude-work1', 'settings.json');
  const clean = path.join(h, '.claude-work2', 'settings.json');
  writeJson(def, wiredSettings());
  writeJson(work, { hooks: { Stop: [ours()] } });
  writeJson(clean, { hooks: { Stop: [PERSONS] } });
  const cleanBytes = fs.readFileSync(clean, 'utf8');
  stubSchedulers([listing([])]);
  const r = await run(h);
  assert.deepEqual(readJson(def).hooks.PreToolUse, [PERSONS, OTHER_INSTALL]);
  assert.deepEqual(readJson(work), {});
  assert.equal(fs.readFileSync(clean, 'utf8'), cleanBytes, 'a file with nothing of ours was rewritten');
  for (const f of [def, work]) assert.ok(r.done.some((d) => d.includes('Claude Code\'s settings') && d.includes(f)), 'not said for ' + f + ': ' + JSON.stringify(r.done));
  assert.ok(!r.done.some((d) => d.includes(clean)), 'a file with nothing of ours was reported');
  assert.ok(!r.left.some((l) => /Claude Code's settings/.test(l)), JSON.stringify(r.left));
  assert.ok(!fs.existsSync(def + '.lock') && !fs.existsSync(work + '.lock'), 'a lock was left behind');
});

test('#5999: while a Kosmos task is still registered (it can wire them back), the hooks are not touched', async () => {
  const h = home();
  const def = path.join(h, '.claude', 'settings.json');
  writeJson(def, wiredSettings());
  const bytes = fs.readFileSync(def, 'utf8');
  stubSchedulers([listing(['Kosmos\\mystery'])]);
  const r = await run(h);
  assert.equal(fs.readFileSync(def, 'utf8'), bytes, 'hooks were taken out while a Kosmos task was still registered');
  assert.ok(!r.done.some((d) => /Claude Code's settings/.test(d)), JSON.stringify(r.done));
});

test('#5999: without the install folder (a hand-run CLI; the launcher always passes it), nothing is guessed: the hooks stay and a note says so', async () => {
  const h = home();
  const def = path.join(h, '.claude', 'settings.json');
  writeJson(def, wiredSettings());
  const bytes = fs.readFileSync(def, 'utf8');
  stubSchedulers([listing([])]);
  const r = await run(h, { bundleRoot: null });
  assert.equal(fs.readFileSync(def, 'utf8'), bytes);
  assert.ok(r.notes.some((l) => /Claude Code's settings were not checked/.test(l) && /could not tell which folder/.test(l)), JSON.stringify(r.notes));
  assert.ok(!r.left.some((l) => /Claude Code's settings/.test(l)), 'no root was made a leftover, which keeps the removal unfinished for good: ' + JSON.stringify(r.left));
});

test('#5999: a board that answers after the tasks went (it would wire them back) keeps the hooks untouched', async () => {
  const h = home();
  const def = path.join(h, '.claude', 'settings.json');
  writeJson(def, wiredSettings());
  const bytes = fs.readFileSync(def, 'utf8');
  stubSchedulers([listing([])]);
  let looks = 0;
  const probe = async () => { looks += 1; return looks === 1 ? { answering: false, outcome: 'refused', identity: null, startedByTask: null } : { answering: true, identity: '0.7.0+abc@default', startedByTask: true }; };
  const r = await run(h, { probe });
  assert.ok(looks >= 2, 'the second look never ran, so this tested nothing');
  assert.equal(fs.readFileSync(def, 'utf8'), bytes, 'hooks were taken out while a board was answering');
  assert.ok(!r.done.some((d) => /Claude Code's settings/.test(d)), JSON.stringify(r.done));
});

test('#5999: an added account\'s hooks left by an EARLIER Kosmos folder (script gone) are taken out too; a live other install\'s stay', async () => {
  const h = home();
  const work = path.join(h, '.claude-work1', 'settings.json');
  const earlier = { matcher: '', hooks: [{ type: 'command', command: 'C:\\Users\\someone\\Desktop\\Kosmos\\runtime\\node.exe', args: ['C:\\Users\\someone\\Desktop\\Kosmos\\app\\engine\\kosmos-report-hook.js'], timeout: 15 }] };
  writeJson(work, { hooks: { Stop: [earlier, OTHER_INSTALL], PostToolUse: [PERSONS] } });
  stubSchedulers([listing([])]);
  const r = await run(h);
  assert.deepEqual(readJson(work), { hooks: { Stop: [OTHER_INSTALL], PostToolUse: [PERSONS] } });
  assert.ok(r.done.some((d) => d.includes(work) && /one left by an earlier Kosmos folder/.test(d)), JSON.stringify(r.done));
});

test('#5999: the folder as Node records it (the real path behind a link) and the settings override are both covered', async () => {
  const h = home();
  const real = path.join(h, 'RealKosmos');
  const link = path.join(h, 'LinkKosmos');
  fs.mkdirSync(real, { recursive: true });
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  const asNode = fs.realpathSync(real);   // as the board's __dirname carries it
  const viaReal = { matcher: '', hooks: [{ type: 'command', command: path.join(asNode, 'runtime', 'node.exe'), args: [path.join(asNode, 'app', 'engine', 'kosmos-report-hook.js')], timeout: 15 }] };
  const custom = path.join(h, 'elsewhere', 'claude-settings.json');
  writeJson(custom, { hooks: { Stop: [viaReal, PERSONS] } });
  stubSchedulers([listing([])]);
  const base = path.dirname(h);
  const r = await run(h, { bundleRoot: link, pathExists: () => true,
    env: { APPDATA: path.join(base, 'Roaming'), LOCALAPPDATA: path.join(base, 'Local'), USERNAME: 'someone', USERDOMAIN: 'BOX', AGENT_WORKFORCE_CLAUDE_SETTINGS: custom } });
  assert.deepEqual(readJson(custom), { hooks: { Stop: [PERSONS] } }, 'a hook naming the real folder behind --root, in the override file, was kept');
  assert.ok(r.done.some((d) => d.includes(custom)), JSON.stringify(r.done));
});

test('#5999: a held lock is waited on, then the file is named and left as it was (the #3088 lock the writers take)', async () => {
  const h = home();
  const def = path.join(h, '.claude', 'settings.json');
  writeJson(def, wiredSettings());
  const bytes = fs.readFileSync(def, 'utf8');
  fs.mkdirSync(def + '.lock');   // a live writer's lock: fresh, so never stolen as stale
  process.env.AGENT_WORKFORCE_LOCK_MS = '60';
  stubSchedulers([listing([])]);
  const r = await run(h);
  fs.rmSync(def + '.lock', { recursive: true, force: true });
  assert.equal(fs.readFileSync(def, 'utf8'), bytes, 'the file was written past a held lock');
  assert.ok(r.left.some((l) => /Claude Code's settings/.test(l) && l.includes(def) && /another program was writing it/.test(l)), JSON.stringify(r.left));
});
