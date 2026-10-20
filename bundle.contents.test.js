'use strict';
/* #731: the bundle build enumerates files by hand (its explicit-list rule, so a
   stray file never ships), which means a runtime dependency the engine adds is
   NOT shipped until someone remembers. The codex bridge was resolved by
   engine/create.js from #245 and never copied: served 0.5.23 could not create
   one agent. This reads the engine for every file it resolves under bin/ and
   fails the moment the build's copy list lacks one. Static on purpose: it runs
   without building a bundle, so it fails at the commit, not at the cut. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE = path.join(__dirname, 'engine');
const BUILD = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');

function resolvedBinFiles() {
  const names = new Set();
  for (const f of fs.readdirSync(ENGINE)) {
    if (!f.endsWith('.js') || f.endsWith('.test.js')) continue;
    const src = fs.readFileSync(path.join(ENGINE, f), 'utf8');
    /* path.join(__dirname, '..', 'bin', '<name>'): the checkout-side source of a
       file the installed app expects beside itself at app/bin/<name>. */
    for (const m of src.matchAll(/path\.join\(__dirname,\s*'\.\.',\s*'bin',\s*'([^']+)'\)/g)) names.add(m[1]);
  }
  return [...names].sort();
}

test('#731: every bin/ file the engine resolves beside itself is copied into app/bin by the bundle build', () => {
  const needed = resolvedBinFiles();
  assert.ok(needed.includes('agent-supervisor.sh') && needed.includes('codex-report-bridge.js'),
    'the scan no longer finds the two known files; the pattern drifted: ' + needed.join(', '));
  /* Shipped means it lands in app/bin under that name, from wherever the
     build sources it: `cp ".../<name>" "$STAGE/app/bin/"` (the repo's bin/)
     or `cp "$SOMETHING" "$STAGE/app/bin/<name>"` (kosmos-tunnel, built
     elsewhere and staged by name). */
  const q = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shipped = (n) => new RegExp('cp "[^"]*/' + q(n) + '" "\\$STAGE/app/bin/"').test(BUILD)
    || new RegExp('cp "[^"]*" "\\$STAGE/app/bin/' + q(n) + '"').test(BUILD);
  const missing = needed.filter((n) => !shipped(n));
  assert.deepEqual(missing, [], 'engine resolves these under bin/ but tools/build-kosmos-bundle.sh never copies them: a served bundle cannot create an agent');
  /* Files the build sources from the repo's own bin/ must exist there (a
     copy line pointing at nothing fails the build later; fail here first). */
  for (const n of needed) {
    if (new RegExp('cp "\\$REPO/bin/' + q(n) + '"').test(BUILD)) assert.ok(fs.existsSync(path.join(__dirname, 'bin', n)), 'the build copies bin/' + n + ' but the repo has no such file');
  }
});

test('#731: a missing runtime file is named in the refusal, not blamed on the file that shipped', () => {
  const src = fs.readFileSync(path.join(ENGINE, 'create.js'), 'utf8');
  assert.match(src, /missingFile/, 'installSupervisor no longer reports WHICH file is absent');
  assert.match(src, /\$\{supervisorMissingFile \|\| 'the start script'\}/, 'the person-facing sentence no longer names the file');
});
