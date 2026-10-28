'use strict';
/**
 * kosmos#7411: the release notes `kosmos whats-new` prints. What a build ships (nothing held, nothing newer than the
 * build), what --since keeps, the restart line, the source-checkout fallback, the pool's restart check, the `notes`
 * command every build runs, and that all three builds run it.
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const rn = require('./releasenotes');
const ROOT = path.join(__dirname, '..');

const pool = {
  lastProd: '0.7.70',
  items: [
    { title: 'Shipped long ago', line: 'old', rank: 2, since: '0.7.40', status: 'shown', shownIn: '0.7.41' },
    { title: 'Needs a restart', line: 'hooks', rank: 1, since: '0.7.70', status: 'shown', shownIn: '0.7.71', restart: 'agents' },
    { title: 'Mac only', line: 'm', rank: 3, since: '0.7.70', status: 'pending', platforms: ['mac'] },
    { title: 'Held feature', line: 'secret plan', rank: 1, since: '0.7.60', status: 'held' },
    { title: 'Not built yet', line: 'future', rank: 1, since: '0.7.80', status: 'pending' },
  ],
};

test('#7411 notesFor: a build ships nothing held and nothing newer than itself, oldest first, readers\' fields only', () => {
  const notes = rn.notesFor(pool, '0.7.72', 'mac');
  assert.deepEqual(notes.map((n) => n.title), ['Shipped long ago', 'Needs a restart', 'Mac only']);
  assert.ok(!notes.some((n) => n.title === 'Held feature'), 'a held item reached the app');
  assert.ok(!notes.some((n) => n.title === 'Not built yet'), 'an item newer than the build reached it');
  assert.deepEqual(Object.keys(notes[1]).sort(), ['line', 'restart', 'title', 'version']);
  assert.deepEqual(notes[2].platforms, ['mac']);
  // CONTROL: a build of the newer version does carry that item.
  assert.ok(rn.notesFor(pool, '0.7.80', 'mac').some((n) => n.title === 'Not built yet'));
  assert.throws(() => rn.notesFor(pool, 'next', 'mac'));
});

test('#7411 since keeps only what is newer, and refuses a since that is not a version', () => {
  const notes = rn.notesFor(pool, '0.7.72', 'mac');
  assert.deepEqual(rn.since(notes, '0.7.69').map((n) => n.title), ['Needs a restart', 'Mac only']);
  assert.equal(rn.since(notes, '0.7.70').length, 0);
  assert.throws(() => rn.since(notes, ''), /--since needs a version/);
  assert.throws(() => rn.since(notes, 'yesterday'), /--since needs a version/);
});

test('#7411 format: one block per version, and a restart line only where one is needed', () => {
  const text = rn.format(rn.notesFor(pool, '0.7.72', 'mac'), '0.7.72');
  assert.match(text, /^Kosmos 0\.7\.40\n {2}- Shipped long ago: old\n\nKosmos 0\.7\.70\n {2}- Needs a restart: hooks\n {4}Restart your agents for this/);
  assert.equal((text.match(/Restart your agents/g) || []).length, 1);
  assert.match(rn.format([], '0.7.72'), /Nothing new to show for Kosmos 0\.7\.72/);
});

test('#7411 readNotes prefers the built file and falls back to the pool in a source checkout', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-releasenotes-'));
  fs.mkdirSync(path.join(d, 'release'));
  fs.writeFileSync(path.join(d, 'release', 'whats-new-pool.json'), JSON.stringify(pool));
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '0.7.72' }));
  const fromPool = rn.readNotes(d);
  assert.equal(fromPool.version, '0.7.72');
  assert.ok(!fromPool.notes.some((n) => n.title === 'Held feature'), 'the fallback leaked a held item');
  fs.writeFileSync(path.join(d, 'release-notes.json'), JSON.stringify({ version: '0.7.72', notes: [{ version: '0.7.72', title: 'Built', line: '' }] }));
  assert.deepEqual(rn.readNotes(d).notes.map((n) => n.title), ['Built']);
});

test('#7411 the pool refuses a restart value other than "agents", and `notes` writes only what the build holds', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-releasenotes-'));
  const bad = path.join(d, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ items: [{ ...pool.items[0], restart: 'board' }] }));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'whats-new-pool.js'), 'notes', '0.7.72', '--platform=mac', '--pool=' + bad, '--out=' + path.join(d, 'x.json')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /the only value is "agents"/);
  const good = path.join(d, 'good.json'); const out = path.join(d, 'release-notes.json');
  fs.writeFileSync(good, JSON.stringify(pool));
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'whats-new-pool.js'), 'notes', '0.7.72', '--platform=mac', '--pool=' + good, '--out=' + out]);
  const written = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(written.version, '0.7.72');
  assert.deepEqual(written.notes.map((n) => n.title), ['Shipped long ago', 'Needs a restart', 'Mac only']);
});

test('#7411 the real pool on this tree gives a build no held item', () => {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'release', 'whats-new-pool.json'), 'utf8'));
  const held = real.items.filter((i) => i.status === 'held').map((i) => i.title);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const shipped = rn.notesFor(real, version, 'mac').map((n) => n.title);
  for (const t of held) assert.ok(!shipped.includes(t), 'held item would ship: ' + t);
});

test('#7411 every build (Mac, Linux, Windows) writes app/release-notes.json with the notes command, after its version', () => {
  for (const f of ['build-kosmos-bundle.sh', 'build-kosmos-linux.sh', 'build-kosmos-windows.sh']) {
    const src = fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8');
    const ver = src.indexOf('_ver="$(sed -n');
    const plat = { 'build-kosmos-bundle.sh': 'mac', 'build-kosmos-linux.sh': 'linux', 'build-kosmos-windows.sh': 'windows' }[f];
    const check = src.indexOf('[ -n "$_ver" ] || {', ver);
    const call = src.indexOf('node "$REPO/tools/whats-new-pool.js" notes "$_ver" --platform=' + plat + ' --out="$STAGE/app/release-notes.json"');
    assert.ok(ver >= 0 && check > ver && call > check, f + ' does not write its own platform\'s release notes after checking its version');
    assert.ok(!/cp [^\n]*whats-new-pool\.json/.test(src), f + ' copies the pool itself into the app');
  }
});

test('#7411 review: the board deploy (deploy/install-board.sh) writes the same notes into the board it stages', () => {
  const src = fs.readFileSync(path.join(ROOT, 'deploy', 'install-board.sh'), 'utf8');
  const fn = src.slice(src.indexOf('stage_app() {'), src.indexOf('\n}\n', src.indexOf('stage_app() {')));
  assert.ok(fn.length > 0, 'stage_app is in deploy/install-board.sh');
  const ver = fn.indexOf('_ver="$("$NODE" -e');
  const call = fn.indexOf('"$NODE" "$REPO/tools/whats-new-pool.js" notes "$_ver" --platform="$_plat" --out="$_d/release-notes.json"');
  assert.ok(ver >= 0 && call > ver, 'stage_app writes the release notes into the staged board, after reading its version');
  assert.ok(/_plat=linux; \[ "\$\(uname -s\)" = Darwin \] && _plat=mac/.test(fn), 'stage_app names its platform from uname');
});

test('#7411 `kosmos whats-new` prints the notes since a version, with the restart line, and --json for an agent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-releasenotes-'));
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'releasenotes.js'), path.join(home, 'app', 'engine', 'releasenotes.js'));
  fs.writeFileSync(path.join(home, 'app', 'release-notes.json'), JSON.stringify({ version: '0.7.72', notes: rn.notesFor(pool, '0.7.72', 'mac') }));
  const run = (...args) => spawnSync('bash', [path.join(ROOT, 'install', 'kosmos'), 'whats-new', ...args], { encoding: 'utf8', env: { ...process.env, KOSMOS_HOME: home } });
  const text = run('--since', '0.7.69');
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Kosmos 0\.7\.70\n {2}- Needs a restart: hooks\n {4}Restart your agents for this/);
  assert.ok(!/Shipped long ago|Held feature/.test(text.stdout));
  const json = JSON.parse(run('--json', '--since=0.7.39').stdout);
  assert.equal(json.installed, '0.7.72');
  assert.deepEqual(json.notes.map((n) => [n.title, n.restart || null]), [['Shipped long ago', null], ['Needs a restart', 'agents'], ['Mac only', null]]);
  const bad = run('--since', 'soon');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stdout + bad.stderr, /--since needs a version/);
});

test('#7411 a Linux build drops the Mac-only notes, a Windows build too; untagged notes reach every platform', () => {
  const titles = (pl) => rn.notesFor(pool, '0.7.72', pl).map((n) => n.title);
  assert.ok(titles('mac').includes('Mac only'));
  assert.ok(!titles('linux').includes('Mac only'), 'a Linux build would list a Mac-only note');
  assert.ok(!titles('windows').includes('Mac only'));
  assert.ok(titles('linux').includes('Needs a restart'));
  assert.throws(() => rn.notesFor(pool, '0.7.72', 'android'), /not a build platform/);
});

test('#7411 the default view is the newest version\'s own notes, whatever came before it (an x.y.0 too)', () => {
  const notes = rn.notesFor(pool, '0.7.80', 'mac');
  assert.deepEqual(rn.latest(notes).map((n) => n.title), ['Not built yet']);
  const zero = [{ version: '0.7.71', title: 'a', line: '' }, { version: '0.8.0', title: 'b', line: '' }];
  assert.deepEqual(rn.latest(zero).map((n) => n.title), ['b']);
  assert.deepEqual(rn.latest([]), []);
});

test('#7411 render: the same answer for both CLIs, an unreadable install said as a sentence', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-releasenotes-'));
  const bad = rn.render(d, { since: null, json: false });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /Kosmos could not read its release notes/);
  fs.writeFileSync(path.join(d, 'release-notes.json'), JSON.stringify({ version: '0.8.0', notes: [{ version: '0.7.71', title: 'a', line: '' }, { version: '0.8.0', title: 'b', line: '' }] }));
  assert.match(rn.render(d, { since: null, json: false }).out, /^Kosmos 0\.8\.0\n {2}- b\n$/);
  assert.equal(rn.render(d, { since: 'x', json: false }).code, 1);
});

test('#7411 the Windows CLI answers whats-new the same way (render), from a checkout', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'windows', 'kosmos-cli.js'), 'whats-new', '--json', '--since', '0.7.69'], { encoding: 'utf8', env: { ...process.env } });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.since, '0.7.69');
  assert.ok(j.notes.length > 0 && j.notes.every((n) => rn.compareVersions(n.version, '0.7.69') > 0));
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'windows', 'kosmos-cli.js'), 'whats-new', '--since='], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
});

test('#7411 review 3: the Mac CLI --help prints the verb\'s usage, and its errors go to stderr (stdout stays clean)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-releasenotes-'));
  const run = (...args) => spawnSync('bash', [path.join(ROOT, 'install', 'kosmos'), 'whats-new', ...args], { encoding: 'utf8', env: { ...process.env, KOSMOS_HOME: home } });
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: kosmos whats-new \[--since <version>\] \[--json\]/);
  assert.ok(!/Kosmos commands/.test(help.stdout), 'fell through to the general command list');
  const bad = run('--bogus');
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout, '', 'an argument error reached stdout');
  assert.match(bad.stderr, /takes --since <version> and --json/);
});

test('#7411 review 3: no notes of its own is said, a missing notes file is a sentence, --platform only with notes', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-releasenotes-'));
  assert.match(rn.render(d, { since: null, json: false }).err, /this install has no release notes file$/);
  fs.writeFileSync(path.join(d, 'release-notes.json'), JSON.stringify({ version: '0.7.72', notes: [{ version: '0.7.70', title: 'a', line: '' }] }));
  assert.match(rn.render(d, { since: null, json: false }).out, /^Kosmos 0\.7\.72 added no notes of its own; the newest are from 0\.7\.70\.\n\nKosmos 0\.7\.70\n/);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'whats-new-pool.js'), 'build', '0.7.72', '--platform=mac', '--offline', '--out=' + path.join(d, 'x.json')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--platform does not go with build/);
});

test('#7411 review 4: a notes file for another version than the installed app is refused, not shown', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-releasenotes-'));
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '0.7.73' }));
  fs.writeFileSync(path.join(d, 'release-notes.json'), JSON.stringify({ version: '0.7.72', notes: [] }));
  assert.match(rn.render(d, { since: null, json: false }).err, /release notes are for 0\.7\.72, but this install is 0\.7\.73/);
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '0.7.72' }));
  assert.equal(rn.render(d, { since: null, json: false }).code, 0, 'CONTROL: matching versions read fine');
});

test('#7411 review 5: a damaged notes entry is a sentence, not a crash', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-releasenotes-'));
  fs.writeFileSync(path.join(d, 'release-notes.json'), JSON.stringify({ version: '0.7.72', notes: [{ version: 'bad', title: 'x', line: '' }] }));
  const r = rn.render(d, { since: null, json: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /release notes file is damaged/);
});

test('#7411 review 6: a note with a bad line, restart or platforms is damaged; notes into a missing folder is a sentence', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-releasenotes-'));
  for (const bad of [{ line: 5 }, { line: 'x', restart: 'board' }, { line: 'x', platforms: 'mac' }]) {
    fs.writeFileSync(path.join(d, 'release-notes.json'), JSON.stringify({ version: '0.7.72', notes: [{ version: '0.7.72', title: 't', ...bad }] }));
    assert.match(rn.render(d, { since: null, json: false }).err, /release notes file is damaged/, JSON.stringify(bad));
  }
  fs.writeFileSync(path.join(d, 'release-notes.json'), JSON.stringify({ version: '0.7.72', notes: [{ version: '0.7.72', title: 't', line: 'ok', platforms: ['mac'], restart: 'agents' }] }));
  assert.equal(rn.render(d, { since: null, json: false }).code, 0, 'CONTROL: a well-formed note reads');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'whats-new-pool.js'), 'notes', '0.7.72', '--platform=mac', '--out=' + path.join(d, 'no', 'such', 'dir', 'x.json')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^could not write /);
});

test('#7411 review 7: the status filter fails closed (an unknown status never ships)', () => {
  const p2 = { items: [...pool.items, { title: 'Dropped later', line: 'x', rank: 1, since: '0.7.50', status: 'dropped' }] };
  assert.ok(!rn.notesFor(p2, '0.7.72', 'mac').some((n) => n.title === 'Dropped later'), 'an unknown status shipped');
});
