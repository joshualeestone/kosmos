'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pinModelMigration, migrationTarget, withMigration, configModel } = require('./codexupdate');

/**
 * kosmos#8597: Codex's model-migration menu at launch ("1. Try new model / 2. Use existing model") eats the first
 * line typed and its Enter switches the model. The launch shim writes the entry Codex itself writes for "2", with the
 * catalog's own target (measured on 0.149.1: a different target still shows the menu).
 *
 *   node --test engine/codexmigration-8597.test.js
 */

const CATALOG = { models: [
  { slug: 'gpt-5.4', upgrade: { model: 'gpt-5.6-terra', migration_markdown: 'GPT-5.4 is no longer available' } },
  { slug: 'gpt-5.5', upgrade: null },
] };

function home(config, cache) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ick-mig-'));
  if (config !== undefined) fs.writeFileSync(path.join(d, 'config.toml'), config);
  if (cache !== undefined) fs.writeFileSync(path.join(d, 'models_cache.json'), JSON.stringify(cache));
  return d;
}
/* A stand-in codex binary: `debug models --bundled` prints `catalog`, and every call is logged to `log`. */
function fakeCodex(catalog, { exit = 0 } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ick-mig-bin-'));
  const log = path.join(d, 'calls.log');
  const bin = path.join(d, 'codex');
  fs.writeFileSync(bin, '#!/bin/sh\necho "$@" >> ' + JSON.stringify(log) + '\n'
    + (exit ? 'exit ' + exit + '\n' : 'cat <<\'EOF\'\n' + JSON.stringify(catalog) + '\nEOF\n'));
  fs.chmodSync(bin, 0o755);
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []) };
}
const cfg = (d) => fs.readFileSync(path.join(d, 'config.toml'), 'utf8');

test('#8597: with no cache, the bundled catalog names the target and the entry is written; control: a model with no upgrade writes nothing', async () => {
  const codex = fakeCodex(CATALOG);
  const d = home('model = "gpt-5.4"\n');
  assert.equal(await pinModelMigration(d, '', codex.bin), true);
  assert.match(cfg(d), /\n\[notice\.model_migrations\]\n"gpt-5\.4" = "gpt-5\.6-terra"\n$/);
  assert.deepEqual(codex.calls(), ['debug models --bundled']);
  const d2 = home('model = "gpt-5.5"\n');
  assert.equal(await pinModelMigration(d2, '', codex.bin), false);
  assert.equal(cfg(d2), 'model = "gpt-5.5"\n', 'untouched');
});

test('#8597: the fetched catalog answers first when it lists the model, and the binary is not asked', async () => {
  const codex = fakeCodex({ models: [{ slug: 'gpt-5.4', upgrade: { model: 'gpt-9-bundled' } }] });
  const d = home('', { models: [{ slug: 'gpt-5.4', upgrade: { model: 'gpt-6-sol' } }] });
  assert.equal(await pinModelMigration(d, 'gpt-5.4', codex.bin), true);
  assert.match(cfg(d), /"gpt-5\.4" = "gpt-6-sol"/);
  assert.deepEqual(codex.calls(), [], 'not spawned');
  // A cached model with no upgrade means no menu: nothing written, and still no spawn.
  const d2 = home('', { models: [{ slug: 'gpt-5.4', upgrade: null }] });
  assert.equal(await pinModelMigration(d2, 'gpt-5.4', codex.bin), false);
  assert.deepEqual(codex.calls(), []);
  // Control: a cache that does not list the model falls through to the bundled catalog.
  const d3 = home('', { models: [{ slug: 'other', upgrade: null }] });
  assert.equal(await pinModelMigration(d3, 'gpt-5.4', codex.bin), true);
  assert.match(cfg(d3), /"gpt-5\.4" = "gpt-9-bundled"/);
  assert.equal(codex.calls().length, 1);
});

test('#8597: it is idempotent, and a stale target is replaced in place', async () => {
  const codex = fakeCodex(CATALOG);
  const d = home('model = "gpt-5.4"\n');
  assert.equal(await pinModelMigration(d, '', codex.bin), true);
  const once = cfg(d);
  assert.equal(await pinModelMigration(d, '', codex.bin), false, 'already there');
  assert.equal(cfg(d), once);
  const stale = home('model = "gpt-5.4"\n\n[notice.model_migrations]\n"gpt-5.4" = "gpt-5.5"\n"gpt-5.2" = "gpt-5.4"\n');
  assert.equal(await pinModelMigration(stale, '', codex.bin), true);
  assert.equal(cfg(stale), 'model = "gpt-5.4"\n\n[notice.model_migrations]\n"gpt-5.4" = "gpt-5.6-terra"\n"gpt-5.2" = "gpt-5.4"\n', 'replaced, the other entry kept');
});

test('#8597: an existing table gets the entry under its own heading, and the rest of the file is kept byte for byte', async () => {
  const text = 'model = "gpt-5.4"\n\n[notice.model_migrations]\n"gpt-5.2" = "gpt-5.4"\n\n[projects."/x"]\ntrust_level = "trusted"\n';
  const out = withMigration(text, 'gpt-5.4', 'gpt-5.6-terra');
  assert.equal(out, 'model = "gpt-5.4"\n\n[notice.model_migrations]\n"gpt-5.4" = "gpt-5.6-terra"\n"gpt-5.2" = "gpt-5.4"\n\n[projects."/x"]\ntrust_level = "trusted"\n');
  assert.equal(withMigration('model = "a"', 'a', 'b'), 'model = "a"\n\n[notice.model_migrations]\n"a" = "b"\n', 'a file with no final newline');
});

test('#8597: a file that mentions model_migrations in another shape is left alone (a second definition would break it)', async () => {
  const codex = fakeCodex(CATALOG);
  const inline = 'model = "gpt-5.4"\n[notice]\nmodel_migrations = { "gpt-5.2" = "gpt-5.4" }\n';
  const d = home(inline);
  assert.equal(await pinModelMigration(d, '', codex.bin), false);
  assert.equal(cfg(d), inline);
  assert.equal(withMigration(inline, 'gpt-5.4', 'gpt-5.6-terra'), null);
});

test('#8597: it declines, never throws, on a failing binary, an unusable model id or target, and an unreadable config', async () => {
  assert.equal(await pinModelMigration(home('model = "gpt-5.4"\n'), '', fakeCodex(null, { exit: 3 }).bin), false);
  assert.equal(await pinModelMigration(home('model = "gpt-5.4"\n'), '', '/nonexistent/codex'), false);
  assert.equal(await pinModelMigration(home(''), 'bad"model', fakeCodex(CATALOG).bin), false);
  const evil = fakeCodex({ models: [{ slug: 'gpt-5.4', upgrade: { model: 'x"\n[evil]' } }] });
  const d = home('model = "gpt-5.4"\n');
  assert.equal(await pinModelMigration(d, '', evil.bin), false);
  assert.equal(cfg(d), 'model = "gpt-5.4"\n');
  const dir = home(); fs.mkdirSync(path.join(dir, 'config.toml'));   // a directory where the file should be
  assert.equal(await pinModelMigration(dir, 'gpt-5.4', fakeCodex(CATALOG).bin), false);
  assert.equal(await migrationTarget(home(), 'gpt-5.4', ''), null, 'no cache and no binary: no target');
});

test('#8597: the model comes from the launch first, then config.toml\'s top-level key only', async () => {
  assert.equal(configModel('model = "gpt-5.4"\n[x]\nmodel = "other"\n'), 'gpt-5.4');
  assert.equal(configModel('[profiles.a]\nmodel = "other"\n'), null, 'a table\'s model is not the agent\'s');
  const codex = fakeCodex(CATALOG);
  const d = home('model = "gpt-5.5"\n');
  assert.equal(await pinModelMigration(d, 'gpt-5.4', codex.bin), true, 'the launch -m wins');
  assert.match(cfg(d), /"gpt-5\.4" = "gpt-5\.6-terra"/);
});

test('#8597: the launch shim runs both steps and always exits 0', async () => {
  const shim = path.join(__dirname, '..', 'bin', 'codex-dismiss-update.js');
  const d = home('model = "gpt-5.4"\n');
  fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify({ latest_version: '0.150.1' }));
  const r = spawnSync(process.execPath, [shim, d, '', fakeCodex(CATALOG).bin], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'version.json'), 'utf8')).dismissed_version, '0.150.1');
  assert.match(cfg(d), /"gpt-5\.4" = "gpt-5\.6-terra"/);
  assert.equal(spawnSync(process.execPath, [shim, '/nonexistent/home', 'gpt-5.4', '/nonexistent/codex']).status, 0);
});

test('#8597: the supervisor passes the launch model (an endpoint\'s own -m first) and the binary to the shim', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  assert.match(src, /"\$NODE_BIN" "\$DISMISS" "\$\{EFFECTIVE_CODEX_HOME:-\}" "\$_mig_model" "\$CLAUDE" "\$_mig_shared"/);
  assert.match(src, /_mig_shared="\$\{_codex_home_shared:-0\}"[^\n]*\n\s*unset _codex_home_shared/, 'captured before the shared flag is unset');
  // The -m extraction, run as bash runs it.
  const block = src.slice(src.indexOf('_mig_model="$MODEL"'), src.indexOf('if [ -f "$DISMISS" ]', src.indexOf('_mig_model="$MODEL"')));
  assert.ok(block.length > 0, 'the block is there');
  const run = (endpoint, model) => spawnSync(fs.existsSync('/bin/bash') ? '/bin/bash' : 'bash', ['-c', 'set -u; MODEL="$1"; shift; ENDPOINT_ARGS=("$@")\n' + block + '\nprintf %s "$_mig_model"', 'x', model, ...endpoint], { encoding: 'utf8' }).stdout;
  assert.equal(run(['-c', 'a=b', '-m', 'gpt-5.4', '--x'], 'ignored'), 'gpt-5.4');
  assert.equal(run(['--model', 'gpt-6-sol'], 'ignored'), 'gpt-6-sol');
  assert.equal(run(['-c', 'a=b'], 'ignored'), '', 'an endpoint with no -m: config.toml decides');
  assert.equal(run([], 'gpt-5.5'), 'gpt-5.5', 'no endpoint: the agent\'s model');
});

test('#8597: it declines a file it would not edit cleanly: CRLF, a literal-string or bare key, an inline notice table', async () => {
  const codex = fakeCodex(CATALOG);
  for (const text of [
    'model = "gpt-5.4"\r\n',
    'model = "gpt-5.4"\n[notice.model_migrations]\n\'gpt-5.4\' = "gpt-5.5"\n',
    'model = "gpt-5.4"\n[notice.model_migrations]\ngpt-5.4 = "gpt-5.5"\n',
    'model = "gpt-5.4"\nnotice = { hide_x = true }\n',
  ]) {
    const d = home(text);
    assert.equal(await pinModelMigration(d, '', codex.bin), false, JSON.stringify(text));
    assert.equal(cfg(d), text, 'untouched');
  }
  // Control: the same table with the double-quoted key Codex writes is edited.
  const d = home('model = "gpt-5.4"\n[notice.model_migrations]\n"gpt-5.4" = "gpt-5.5"\n');
  assert.equal(await pinModelMigration(d, '', codex.bin), true);
});

test('#8597: the shim never writes into the person\'s own codex home (argv 5 is 1); control: 0 writes', () => {
  const shim = path.join(__dirname, '..', 'bin', 'codex-dismiss-update.js');
  const bin = fakeCodex(CATALOG).bin;
  const own = home('model = "gpt-5.4"\n');
  assert.equal(spawnSync(process.execPath, [shim, own, '', bin, '1']).status, 0);
  assert.equal(cfg(own), 'model = "gpt-5.4"\n');
  const priv = home('model = "gpt-5.4"\n');
  assert.equal(spawnSync(process.execPath, [shim, priv, '', bin, '0']).status, 0);
  assert.match(cfg(priv), /"gpt-5\.4" = "gpt-5\.6-terra"/);
});

test('#8597: a stalled binary whose child holds the pipe is cut off at the bound, the whole group with it', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ick-mig-stall-'));
  const pidf = path.join(d, 'grandchild.pid');
  const bin = path.join(d, 'codex');
  fs.writeFileSync(bin, '#!/bin/sh\n( sleep 30 ) &\necho $! > ' + JSON.stringify(pidf) + '\nsleep 30\n');
  fs.chmodSync(bin, 0o755);
  const t0 = Date.now();
  // A bound well past a shell's start on a loaded machine, and far below the 30 s stall.
  assert.equal(await pinModelMigration(home('model = "gpt-5.4"\n'), '', bin, { bundledMs: 2000 }), false);
  const took = Date.now() - t0;
  assert.ok(took < 15000, 'returned at the bound, not after the 30 s stall: ' + took + ' ms');
  assert.ok(fs.existsSync(pidf), 'the stand-in started its child before the bound (else this arm proves nothing)');
  const gpid = Number(fs.readFileSync(pidf, 'utf8'));
  let alive = true;
  for (let i = 0; i < 20 && alive; i += 1) { try { process.kill(gpid, 0); } catch { alive = false; } if (alive) spawnSync('sleep', ['0.1']); }
  assert.equal(alive, false, 'the grandchild went with the group');
});

test('#8597: a new config.toml is 0600 and an existing one keeps its mode', async () => {
  if (process.platform === 'win32') return;
  const codex = fakeCodex(CATALOG);
  const fresh = home();
  assert.equal(await pinModelMigration(fresh, 'gpt-5.4', codex.bin), true);
  assert.equal(fs.statSync(path.join(fresh, 'config.toml')).mode & 0o777, 0o600);
  const kept = home('model = "gpt-5.4"\n');
  fs.chmodSync(path.join(kept, 'config.toml'), 0o640);
  assert.equal(await pinModelMigration(kept, '', codex.bin), true);
  assert.equal(fs.statSync(path.join(kept, 'config.toml')).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(kept).filter((f) => f.endsWith('.tmp')), [], 'no temp copy left');
});

test('#8597: a config.toml another Kosmos writer holds is left alone after the lock wait (no write, no throw)', async () => {
  const codex = fakeCodex(CATALOG);
  const d = home('model = "gpt-5.4"\n');
  fs.mkdirSync(path.join(d, 'config.toml.lock'));   // engine/filelock.js's lock, held (fresh, so it is not stale)
  assert.equal(await pinModelMigration(d, '', codex.bin), false);
  assert.equal(cfg(d), 'model = "gpt-5.4"\n');
  fs.rmdirSync(path.join(d, 'config.toml.lock'));
  assert.equal(await pinModelMigration(d, '', codex.bin), true, 'control: written once the lock is free');
});

test('#8597: a literal-string model is read too, and the --model=X and -m=X launch forms', async () => {
  assert.equal(configModel("model = 'gpt-5.4'\n"), 'gpt-5.4');
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const block = src.slice(src.indexOf('_mig_model="$MODEL"'), src.indexOf('if [ -f "$DISMISS" ]', src.indexOf('_mig_model="$MODEL"')));
  const run = (endpoint) => spawnSync(fs.existsSync('/bin/bash') ? '/bin/bash' : 'bash', ['-c', 'set -u; MODEL=x; ENDPOINT_ARGS=("$@")\n' + block + '\nprintf %s "$_mig_model"', 'x', ...endpoint], { encoding: 'utf8' }).stdout;
  assert.equal(run(['--model=gpt-6-sol']), 'gpt-6-sol');
  assert.equal(run(['-m=gpt-5.4', '-c', 'a=b']), 'gpt-5.4');
});

test('#8597: installed layout: the supervisor runs launch prep through the engine path when its own folder has no shim', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const from = src.indexOf('      DISMISS="$(cd "$(dirname "$0")" && pwd)/codex-dismiss-update.js"');
  const to = src.indexOf('unset _mig_model _mig_next _mig_shared _a', from);
  assert.ok(from > 0 && to > from, 'the block is there');
  const block = src.slice(from, to);
  const supDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ick-mig-sup-'));   // like Application Support/Kosmos/bin: no shim
  const sh = (eng) => {
    const d = home('model = "gpt-5.4"\n');
    fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify({ latest_version: '0.150.1' }));
    const script = 'set -u; MODEL=""; ENDPOINT_ARGS=(); _mig_shared=0; NODE_BIN="$1"; _eng="$2"; EFFECTIVE_CODEX_HOME="$3"; CLAUDE="$4"\n' + block;
    const r = spawnSync(fs.existsSync('/bin/bash') ? '/bin/bash' : 'bash', ['-c', script, path.join(supDir, 'agent-supervisor.sh'), process.execPath, eng, d, fakeCodex(CATALOG).bin], { encoding: 'utf8' });
    return { r, d };
  };
  const { r, d } = sh(__dirname);
  assert.equal(r.status, 0, r.stderr);
  assert.match(cfg(d), /"gpt-5\.4" = "gpt-5\.6-terra"/, 'pinned');
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'version.json'), 'utf8')).dismissed_version, '0.150.1', 'and the update notice dismissed');
  // Control: the same folder with no engine path finds no shim, and nothing is written (the pre-fix installed state).
  const c = sh('');
  assert.equal(cfg(c.d), 'model = "gpt-5.4"\n');
});

test('#8597: engine/codexupdate.js run as a script does both steps and exits 0, even on a missing home', () => {
  const mod = path.join(__dirname, 'codexupdate.js');
  const d = home('model = "gpt-5.4"\n');
  fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify({ latest_version: '0.150.1' }));
  assert.equal(spawnSync(process.execPath, [mod, d, '', fakeCodex(CATALOG).bin, '0']).status, 0);
  assert.match(cfg(d), /"gpt-5\.6-terra"/);
  assert.equal(spawnSync(process.execPath, [mod, '/nonexistent/home', 'gpt-5.4', '/nonexistent/codex', '0']).status, 0);
});

test('#8597: the bundled-catalog probe gets ONE CODEX_HOME, the agent\'s, whatever spelling was inherited (#5386)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ick-mig-env-'));
  const out = path.join(d, 'env.txt');
  const bin = path.join(d, 'codex');
  fs.writeFileSync(bin, '#!/bin/sh\nenv | grep -i "^codex_home=" > ' + JSON.stringify(out) + "\ncat <<'EOF'\n" + JSON.stringify(CATALOG) + '\nEOF\n');
  fs.chmodSync(bin, 0o755);
  const h = home('model = "gpt-5.4"\n');
  const before = process.env.Codex_Home;
  process.env.Codex_Home = '/somewhere/else';
  try { assert.equal(await pinModelMigration(h, '', bin), true); } finally { if (before === undefined) delete process.env.Codex_Home; else process.env.Codex_Home = before; }
  const lines = fs.readFileSync(out, 'utf8').trim().split('\n');
  assert.deepEqual(lines, ['CODEX_HOME=' + h], 'exactly one, the agent\'s home');
});
