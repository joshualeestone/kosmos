'use strict';
/**
 * win32-board-copy: "does this computer sleep", "where is Kosmos" and "open it",
 * answered on Windows.
 *
 * 🛑 THE WINDOWS ANSWER USED TO BE A MAC SENTENCE. `pmset` does not exist there, so the
 * sleep row read "We could not read this computer's sleep settings ... System Settings,
 * under Lock Screen" and the first-run sleep pill sat on "Checking..." forever; the
 * app-location row looked for /Applications/Kosmos.app and always said it could not
 * find the icon; and every "open" button called /usr/bin/open.
 *
 * ⚠️ NOTHING HERE TOUCHES THE MACHINE. powercfg text is injected (`opts.powercfg`) or
 * the runner is; Explorer is the win32explorer runner seam; the Kosmos folder is
 * `opts.bundleRoot`; the board task is `opts.boardTask`.
 *
 *   node --test engine/machine.win32-sleep.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const machine = require('./machine');
const explorer = require('./win32explorer');

/**
 * CAPTURED, verbatim, from `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` on the
 * Windows 11 Pro 26100 box this was written on (en-US), 2026-09-13. A read-only query.
 * AC index 0 is "Never"; DC 0xb4 is 180 seconds.
 */
const EN_US_AC_NEVER = `Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)
  GUID Alias: SCHEME_BALANCED
  Subgroup GUID: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Sleep)
    GUID Alias: SUB_SLEEP
    Power Setting GUID: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Sleep after)
      GUID Alias: STANDBYIDLE
      Minimum Possible Setting: 0x00000000
      Maximum Possible Setting: 0xffffffff
      Possible Settings increment: 0x00000001
      Possible Settings units: Seconds
    Current AC Power Setting Index: 0x00000000
    Current DC Power Setting Index: 0x000000b4

`.replace(/\n/g, '\r\n');

/** The same capture with the plugged-in value set to 30 minutes (0x708 seconds). */
const EN_US_AC_30_MIN = EN_US_AC_NEVER.replace('Current AC Power Setting Index: 0x00000000', 'Current AC Power Setting Index: 0x00000708');

/**
 * ⚠️ RECONSTRUCTED, NOT CAPTURED. This box is en-US. powercfg LOCALIZES ITS LABELS
 * ("Current AC Power Setting Index" is translated) but not the GUIDs, the aliases, the
 * `0x` values or their order, which is why the parser keys on the STANDBYIDLE GUID and on
 * position when the English labels are absent. The German wording below follows the
 * shape of a German Windows install; the property under test is that no English label
 * is needed, not the exact German.
 */
const DE_DE_AC_20_MIN = `Energieschema-GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Ausbalanciert)
  GUID-Alias: SCHEME_BALANCED
  Untergruppen-GUID: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Energie sparen)
    GUID-Alias: SUB_SLEEP
    Energieeinstellungs-GUID: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Standbymodus nach)
      GUID-Alias: STANDBYIDLE
      Minimale m\u00f6gliche Einstellung: 0x00000000
      Maximale m\u00f6gliche Einstellung: 0xffffffff
      M\u00f6gliche Einstellungen, Schritt: 0x00000001
      M\u00f6gliche Einstellungen, Einheiten: Sekunden
    Aktueller Wechselstrom-Energieeinstellungsindex: 0x000004b0
    Aktueller Gleichstrom-Energieeinstellungsindex: 0x00000384
`;

const WIN = { platform: 'win32' };

test('the parser reads the captured en-US output: AC never, DC 180 seconds', () => {
  assert.deepEqual(machine.parsePowercfgSleep(EN_US_AC_NEVER), { acSeconds: 0, dcSeconds: 180 });
  assert.deepEqual(machine.parsePowercfgSleep(EN_US_AC_30_MIN), { acSeconds: 1800, dcSeconds: 180 });
});

test('the parser needs no English label: a German install reads by GUID and position', () => {
  assert.deepEqual(machine.parsePowercfgSleep(DE_DE_AC_20_MIN), { acSeconds: 1200, dcSeconds: 900 });
});

test('anything that is not the Sleep-after setting is unreadable, never a guess', () => {
  const otherSetting = EN_US_AC_NEVER.replace('29f6c1db-86da-48c5-9fdb-f2b67b1f44da', '7bc4a2f9-d8fc-4469-b07b-33eb785aaca0');
  const truncated = DE_DE_AC_20_MIN.split('\n').slice(0, 9).join('\n');
  for (const junk of ['', 'The power scheme, subgroup or setting specified does not exist.', otherSetting, truncated, 'AC 0x0']) {
    assert.equal(machine.parsePowercfgSleep(junk), null, `read ${JSON.stringify(junk.slice(0, 40))} as a setting`);
  }
});

test('the Windows sleep row: never asleep plugged in is OK, with no Mac words', () => {
  const got = machine.check({ ...WIN, powercfg: EN_US_AC_NEVER, claudeBin: process.execPath, runner: () => ({ ok: false, because: 'no' }), boardTask: null, bundleRoot: null });
  const sleep = got.checks.find((c) => c.key === 'sleep');
  assert.equal(sleep.state, machine.STATE.OK);
  assert.equal(sleep.title, 'This computer does not go to sleep while it is plugged in');
  assert.equal(sleep.settings, true, 'Windows always has the sleep settings page, so the row offers the button');
  assert.doesNotMatch(sleep.title + sleep.detail, /System Settings|Lock Screen|Energy Saver|macOS|Mac\b/);
});

test('the Windows sleep row: a plugged-in sleep time is ATTENTION, in minutes, naming the Windows setting', () => {
  const sleep = machine.check({ ...WIN, powercfg: EN_US_AC_30_MIN, claudeBin: process.execPath, runner: () => ({ ok: false }), boardTask: null, bundleRoot: null })
    .checks.find((c) => c.key === 'sleep');
  assert.equal(sleep.state, machine.STATE.ATTENTION);
  assert.equal(sleep.title, 'This computer goes to sleep after 30 minutes when it is plugged in');
  assert.match(sleep.detail, /Settings > System > Power & battery/);
});

test('the Windows sleep row: an unreadable or failed read is UNKNOWN with the Windows place to look', () => {
  for (const opts of [{ powercfg: 'garbage' }, { runner: () => ({ ok: false, because: 'spawnSync powercfg ENOENT' }) }]) {
    const sleep = machine.check({ ...WIN, ...opts, claudeBin: process.execPath, boardTask: null, bundleRoot: null }).checks.find((c) => c.key === 'sleep');
    assert.equal(sleep.state, machine.STATE.UNKNOWN);
    assert.equal(sleep.title, 'We could not read this computer\'s sleep settings');
    assert.equal(sleep.detail, 'That setting decides whether your agents keep working when you walk away. You can check it in Settings > System > Power & battery.');
  }
});

test('the real read is the read-only powercfg query, through the runner, with no Mac command', () => {
  const calls = [];
  machine.sleepGate({ ...WIN, runner: (cmd, args) => { calls.push([cmd, args]); return { ok: true, stdout: EN_US_AC_NEVER }; } });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\\System32\\powercfg\.exe$/i);
  assert.deepEqual(calls[0][1], ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE']);
});

test('the first-run sleep gate on Windows: never -> prevented, a sleep time -> not prevented, unreadable -> uncheckable', () => {
  assert.deepEqual(machine.sleepGate({ ...WIN, powercfg: EN_US_AC_NEVER }), { checkable: true, prevented: true });
  const sleeps = machine.sleepGate({ ...WIN, powercfg: DE_DE_AC_20_MIN });
  assert.equal(sleeps.checkable, true);
  assert.equal(sleeps.prevented, false);
  assert.equal(sleeps.battOnly, false, 'Windows has a switch for the plugged-in case, so Turn On stays');
  assert.equal(machine.sleepGate({ ...WIN, powercfg: '' }).checkable, false);
  /* CONTROL: the same seam on the Mac arm still reads pmset, so the arms are really split. */
  assert.equal(machine.sleepGate({ platform: 'darwin', pmset: EN_US_AC_NEVER }).checkable, false,
    'the Mac arm parsed powercfg text as pmset');
});

test('Turn On on Windows opens ms-settings:powersleep through the one Explorer launcher', () => {
  const calls = [];
  explorer.setRunner((exe, args) => { calls.push([exe, args]); return { ok: true }; });
  machine.setPlatform('win32');
  try {
    assert.deepEqual(machine.openSleepSettings(), { ok: true });
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /\\explorer\.exe$/i);
    assert.deepEqual(calls[0][1], ['ms-settings:powersleep']);

    explorer.setRunner(() => ({ ok: false, because: explorer.EXPLORER_DID_NOT_OPEN }));
    const refused = machine.openSleepSettings();
    assert.equal(refused.ok, false);
    assert.match(refused.because, /Settings > System > Power & battery/, 'a failed open does not say where to go by hand');
    assert.doesNotMatch(refused.because, /System Settings|Energy Saver/);
  } finally {
    machine.setPlatform(null);
    explorer.setRunner(null);
  }
});

test('the Kosmos folder row on Windows reports the real folder with backslashes, and from source says so', () => {
  const root = 'C:\\Users\\someone\\AppData\\Local\\Programs\\Kosmos';
  const found = machine.appLocationCheck({ ...WIN, bundleRoot: root });
  assert.equal(found.state, machine.STATE.OK);
  assert.equal(found.title, 'Kosmos lives in its own folder');
  assert.equal(found.detail, root);
  assert.doesNotMatch(found.title + found.detail, /Applications|Dock|Spotlight|icon/);

  const source = machine.appLocationCheck({ ...WIN, bundleRoot: null });
  assert.equal(source.state, machine.STATE.UNKNOWN);
  assert.match(source.title, /running from source/);
});

test('"Open the Kosmos folder" hands the bundle root to Explorer, and refuses from source', () => {
  const root = 'C:\\Users\\someone\\Kosmos';
  const calls = [];
  explorer.setRunner((exe, args) => { calls.push(args); return { ok: true }; });
  explorer.setStatForTests(() => ({ isDirectory: () => true, isFile: () => false }));
  try {
    assert.deepEqual(machine.revealApp({ ...WIN, bundleRoot: root }), { ok: true });
    assert.deepEqual(calls, [[root]]);
    assert.throws(() => machine.revealApp({ ...WIN, bundleRoot: null }), /running from source/);
    assert.equal(calls.length, 1, 'a from-source refusal still launched Explorer');
  } finally {
    explorer.setRunner(null);
    explorer.setStatForTests(null);
  }
});

test('the Windows autostart row says "sign in", and keeps the schtasks line for IT admins only', () => {
  const hint = 'schtasks /Delete /F /TN "Kosmos\\board"';
  const facts = { task: 'Kosmos\\board', bundle: true, registered: true, enabled: true, running: true, claimed: true, removeHint: hint };
  const ok = machine.boardAutostartCheck(() => ({ ok: false }), { ...WIN, boardTask: facts });
  assert.equal(ok.title, 'Kosmos starts itself when you sign in');
  assert.equal(ok.detail, 'Kosmos starts when you sign in to Windows, and your agents come back on their own after a restart.');
  assert.doesNotMatch(ok.detail, /schtasks/, 'the raw command is still in front of the person');
  assert.match(ok.admin, /schtasks \/Delete \/F \/TN "Kosmos\\board"/, 'the removal command is not findable any more');
  for (const over of [{ registered: false }, { enabled: false }, { bundle: false, registered: false }]) {
    const r = machine.boardAutostartCheck(() => ({ ok: false }), { ...WIN, boardTask: { ...facts, ...over } });
    assert.doesNotMatch(r.title + ' ' + r.detail, /\blog in\b/, `a Windows row says "log in": ${r.title}`);
  }
});
