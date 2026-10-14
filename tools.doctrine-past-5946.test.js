'use strict';
/**
 * #5946: tools/doctrine-past.js keeps what the default branch's table already holds, and reads only the default
 * branch's history. Run against a throwaway git repository holding a stand-in engine/defaults.js, so it touches
 * nothing in this checkout.
 *
 *   node --test tools.doctrine-past-5946.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const { generateDoctrinePast } = require('./tools/doctrine-past');
const { removeTree } = require('./test-support/remove-tree');

const QUIET = { log: () => {}, warn: () => {} };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
/* A stand-in defaults.js: what the generator needs from the real one is block() and DOCTRINE_VERSION. */
const defaultsSource = (version, block) => `module.exports = { DOCTRINE_VERSION: ${version}, block: () => ${JSON.stringify(block)} };\n`;
const tableSource = (rows, sections) => "'use strict';\nconst blocks = [\n"
  + rows.map((r) => `  { version: ${r.version}, length: ${r.length}, sha256: '${r.sha256}' },`).join('\n')
  + '\n];\nblocks.sections = [\n' + sections.map((h) => `  '${h}',`).join('\n') + '\n];\nmodule.exports = blocks;\n';

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-doctrine-past-5946-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(root, 'engine'));
  const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text);
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
  return { root, git, write, commit };
}
const rowsOf = (root) => {
  const file = path.join(root, 'engine', 'doctrine-past.js');
  delete require.cache[require.resolve(file)];
  return require(file);
};

const RELEASED = '## Rules\n\nversion one';
/* A row no history here produces: a block from a commit this clone never fetched. */
const FOREIGN = { version: 1, length: 9, sha256: 'f'.repeat(64) };
const FOREIGN_SECTION = 'e'.repeat(64);

test('#5946: a row on the default branch\'s table that history here cannot reach is kept, a branch draft is not written, and a rerun gives the same file', () => {
  const r = repo();
  try {
    r.write('engine/defaults.js', defaultsSource(1, RELEASED));
    r.write('engine/doctrine-past.js', tableSource([FOREIGN], [FOREIGN_SECTION]));
    r.commit('released v1, with a table holding a foreign row');
    r.git('checkout', '-q', '-b', 'feature');
    const DRAFT = '## Rules\n\nversion two, first draft\n\n### Later\n\nx';
    r.write('engine/defaults.js', defaultsSource(2, DRAFT));
    r.commit('a draft on the branch');
    const CURRENT = '## Rules\n\nversion two\n\n### Later\n\ny';
    r.write('engine/defaults.js', defaultsSource(2, CURRENT));

    const got = generateDoctrinePast(r.root, QUIET);
    assert.equal(got.historyRef, 'refs/heads/main', 'with no origin, the local main is the default branch');
    assert.equal(got.kept, 1);
    const table = rowsOf(r.root);
    const shas = table.map((x) => x.sha256);
    assert.ok(shas.includes(FOREIGN.sha256), 'the foreign row was dropped');
    assert.ok(table.sections.includes(FOREIGN_SECTION), 'the foreign section was dropped');
    assert.ok(shas.includes(sha(RELEASED)), 'the released block has no row');
    assert.ok(shas.includes(sha(CURRENT)), 'the working copy has no row');
    assert.ok(!shas.includes(sha(DRAFT)), 'the branch\'s draft was written into the table');

    const first = fs.readFileSync(path.join(r.root, 'engine', 'doctrine-past.js'), 'utf8');
    generateDoctrinePast(r.root, QUIET);
    assert.equal(fs.readFileSync(path.join(r.root, 'engine', 'doctrine-past.js'), 'utf8'), first, 'a rerun changed the table');
  } finally { removeTree(r.root); }
});

test('#5946: a committed row the prefix rule now leaves out is NOT kept', () => {
  const r = repo();
  try {
    r.write('engine/defaults.js', defaultsSource(1, RELEASED));
    r.write('engine/doctrine-past.js', tableSource([{ version: 1, length: RELEASED.length, sha256: sha(RELEASED) }], []));
    r.commit('released v1');
    /* The working copy extends v1 INSIDE its last section, which the prefix rule cannot tell apart from v1. */
    r.write('engine/defaults.js', defaultsSource(2, RELEASED + '\nand more of the same section'));
    const got = generateDoctrinePast(r.root, QUIET);
    assert.equal(got.kept, 0);
    assert.ok(!rowsOf(r.root).some((x) => x.sha256 === sha(RELEASED)), 'a left-out block came back from the committed table');
  } finally { removeTree(r.root); }
});

test('#5946: with no table committed yet, the run writes one from history alone', () => {
  const r = repo();
  try {
    r.write('engine/defaults.js', defaultsSource(1, RELEASED));
    r.commit('v1, no table');
    const got = generateDoctrinePast(r.root, QUIET);
    assert.equal(got.kept, 0);
    assert.deepEqual(rowsOf(r.root).map((x) => x.sha256), [sha(RELEASED)]);
  } finally { removeTree(r.root); }
});
