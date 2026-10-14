#!/usr/bin/env node
'use strict';
/*
 * Regenerates engine/doctrine-past.js (#4890): the fingerprint of every working-rules block Kosmos has ever
 * written into an agent's instructions, so doctrine.planFor can recognise an unedited plain copy and offer the
 * current rules in its place. Run it after changing BLOCK in engine/defaults.js (engine/doctrine-4890.test.js
 * reds until you do):
 *
 *   node tools/doctrine-past.js
 *
 * It reads engine/defaults.js at every commit on the default branch (origin/main) that touched it, plus the working
 * copy, and needs the full git history (a shallow clone lists fewer versions, so run this in a full clone).
 * engine/defaults.test.js fails when any released version (each fingerprint it pins) has no row, or when the current
 * block has none. Rows already in the table committed on the default branch are kept even when this clone's
 * history does not reach them (#5946). A commit from a branch merged with its history (not squashed) is in the
 * table too, labelled with whatever DOCTRINE_VERSION it had then; no agent holds such a block, so its row matches
 * nothing.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

/**
 * Writes <root>/engine/doctrine-past.js. `root` (a git checkout) and `log` are the seams
 * tools.doctrine-past-5946.test.js drives; run as a script it is this checkout and the console.
 * Returns { rows, sections, kept, historyRef }.
 */
function generateDoctrinePast(root = path.resolve(__dirname, '..'), log = console) {
  const ROOT = root;
  const OUT = path.join(ROOT, 'engine', 'doctrine-past.js');
  const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  /* #5946: the history read is the default branch's, plus the working copy, never a feature branch's own
     intermediate commits: those are drafts no agent ever received, and a draft row written into the table would
     outlive a squash merge (rows are kept, below). origin/main when there is one (a local main is stale under the
     worktree convention), else main, else HEAD for a clone with neither. */
  function firstRef(...refs) {
    for (const ref of refs) {
      try { git('rev-parse', '--verify', '--quiet', ref + '^{commit}'); return ref; } catch { /* not here */ }
    }
    return null;
  }
  const HISTORY_REF = firstRef('refs/remotes/origin/main', 'refs/heads/main') || 'HEAD';
  /* The ref is read as it stands here, never fetched. Commits on HEAD that touch engine/defaults.js and are not on it
     are read as this branch's drafts. That is right for a branch's own commits, but if the ref is stale they can also
     be released main commits, whose rows would then be missing: say so, so the run can be redone after a fetch. */
  if (HISTORY_REF !== 'HEAD') {
    const drafts = git('rev-list', '--count', `${HISTORY_REF}..HEAD`, '--', 'engine/defaults.js').trim();
    if (Number(drafts) > 0) log.warn(`${drafts} commit(s) on HEAD that change engine/defaults.js are not on ${HISTORY_REF}, so they are read as this branch's drafts and get no row. If ${HISTORY_REF} may be behind (this tool does not fetch), run git fetch and rerun.`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctrine-past-'));
  try {
    // --full-history: every side of a merge, not git's simplified one, so no block depends on how a branch merged (review 20).
    const shas = git('log', '--full-history', '--format=%H', HISTORY_REF, '--', 'engine/defaults.js').trim().split('\n').filter(Boolean);
    const sources = shas.map((h) => ({ from: h.slice(0, 9), text: git('show', `${h}:engine/defaults.js`) }));
    sources.unshift({ from: 'working copy', text: fs.readFileSync(path.join(ROOT, 'engine', 'defaults.js'), 'utf8') });
    const seen = new Map();
    const texts = new Map();
    const sectionShas = new Set();
    const leftOut = new Set();   // blocks this run left out on purpose (the prefix rule below), never kept from the old table
    let skipped = 0;
    sources.forEach((src, i) => {
      const file = path.join(tmp, `d${i}.js`);
      fs.writeFileSync(file, src.text);
      let mod;
      try { mod = require(file); } catch (err) { log.warn(`skipped ${src.from}: ${err.message}`); skipped += 1; return; }
      const block = typeof mod.block === 'function' ? mod.block() : null;
      if (typeof block !== 'string' || !block) return;
      const sha256 = crypto.createHash('sha256').update(block).digest('hex');
      if (!seen.has(sha256)) seen.set(sha256, { version: Number.isFinite(mod.DOCTRINE_VERSION) ? mod.DOCTRINE_VERSION : null, length: block.length, sha256 });
      texts.set(sha256, block);
      // Each section, split as defaults.sections() splits, so a span holding only some sections can be recognised.
      block.split('\n### ').forEach((p, j) => sectionShas.add(crypto.createHash('sha256').update(j === 0 ? p : '### ' + p).digest('hex')));
    });
    if (skipped) throw new Error(`${skipped} version(s) of engine/defaults.js could not be loaded; the table would miss them`);
    /* doctrine.pastBlockIn tells an earlier block from a longer one it is a prefix of by what follows it: a longer
       block must go on with a new `###` section. An earlier block that a later one extends INSIDE its last section
       cannot be told apart, so it is left out: agents holding it keep the missing-headings rule (never a wrong cut). */
    /* An earlier block is named by its length and sha256, so the same test serves a kept row (below), which has no
       text here: the prefix is recognised by hashing that many characters of the longer block. */
    const extendsInsideLastSection = (len, digest, b) => b.length > len && b[len] === '\n'
      && crypto.createHash('sha256').update(b.slice(0, len)).digest('hex') === digest
      && !/^(?:[ \t]*\r?\n)*### /.test(b.slice(len + 1));
    for (const [ka, a] of texts) {
      for (const [kb, b] of texts) {
        if (ka !== kb && extendsInsideLastSection(a.length, ka, b)) {
          log.warn(`left out the ${a.length}-character block: a later one extends it inside its last section`);
          seen.delete(ka);
          leftOut.add(ka);
        }
      }
    }
    /* #5946: a clone whose history does not reach a commit an earlier run read (a branch pushed from another machine
       and never fetched here) would silently DROP that row, and an agent holding that block would stop being
       recognised. So every row and section in the table AS COMMITTED ON HISTORY_REF is kept, unless this run left
       the block out on purpose above; the default branch's table only grows. Reading the committed table, not the
       working file, makes a rerun on a branch give the same answer every time. A kept row has no text here, but the
       prefix rule still applies to it: its length and sha256 are checked against the start of every block read
       above, so a later block that extends it inside its last section leaves it out too. A rerun never drops a row
       or a section hash: a row this history still produces is written again, and one it does not is kept from the
       committed table. Dropping one means deleting it from the table on the default branch itself, and only a row
       this history cannot produce stays dropped; its section hashes stay either way (they match only that block's
       sections, so a leftover one recognises nothing a person wrote). */
    let kept = 0;
    let committed = null;
    try { committed = git('show', HISTORY_REF + ':engine/doctrine-past.js'); } catch { /* no table on that ref yet */ }
    if (committed !== null) {
      const file = path.join(tmp, 'doctrine-past-committed.js');
      fs.writeFileSync(file, committed);
      let previous;
      try { previous = require(file); } catch (err) { throw new Error(`could not read the table committed on ${HISTORY_REF} to keep its rows: ${err.message}`); }
      for (const r of previous) {
        if (seen.has(r.sha256) || leftOut.has(r.sha256)) continue;
        if ([...texts.values()].some((b) => extendsInsideLastSection(r.length, r.sha256, b))) {
          log.warn(`left out the kept ${r.length}-character block: a later one extends it inside its last section`);
          continue;
        }
        seen.set(r.sha256, { version: r.version, length: r.length, sha256: r.sha256 });
        kept += 1;
      }
      for (const h of previous.sections || []) sectionShas.add(h);
    }
    if (kept) log.log(`kept ${kept} row(s) from the table on ${HISTORY_REF} that its git history here does not reach`);
    const rows = [...seen.values()].sort((a, b) => (b.version || 0) - (a.version || 0) || b.length - a.length);
    const body = [
      "'use strict';",
      '/* GENERATED by tools/doctrine-past.js; do not edit by hand (#4890). Every working-rules block engine/defaults.js',
      '   has produced on the default branch, plus the working copy, plus every row already in this table as committed',
      '   there (#5946), by fingerprint: `length` in JavaScript string units from the block\'s',
      '   first line, and the sha256 of exactly those characters. doctrine.planFor uses it to tell an unedited copy from one',
      '   a person changed. `sections` holds the sha256 of every section of every one of them, for a span holding some. */',
      'const blocks = [',
      ...rows.map((r) => `  { version: ${r.version === null ? 'null' : r.version}, length: ${r.length}, sha256: '${r.sha256}' },`),
      '];',
      'blocks.sections = [',
      ...[...sectionShas].sort().map((h) => `  '${h}',`),
      '];',
      'module.exports = blocks;',
      '',
    ].join('\n');
    fs.writeFileSync(OUT, body);
    log.log(`wrote ${rows.length} blocks and ${sectionShas.size} sections to ${path.relative(ROOT, OUT)}`);
    return { rows, sections: [...sectionShas].sort(), kept, historyRef: HISTORY_REF };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { generateDoctrinePast };

if (require.main === module) generateDoctrinePast();
