#!/usr/bin/env node
'use strict';
/**
 * #5711 (Josh 2026-10-09 14:43): What's New is ONE list of the top 4 or 5 highlights, chosen cumulatively across every
 * version since the last release that reached PROD, not 4 or 5 per version. A person who skips builds still sees the
 * best of them.
 *
 * The pool, release/whats-new-pool.json, holds every highlight once: { title, line, icon, platforms?, rank, since,
 * status }. rank 1 is the most important. status is
 *   pending  not yet shown to prod users: eligible
 *   shown    shown by a release that reached prod (shownIn names it): never chosen again
 *   held     a feature that is held or dropped (conversation mode, Josh 10:49): never chosen, whatever its rank
 *
 *   node tools/whats-new-pool.js build <version> [--max=5] [--pool=<file>] [--out=<file>]
 *       writes web/whats-new.json: the top --max pending highlights by rank (ties: newest first), checked with
 *       engine/whatsnew.js's own rules (the cut's step 1b-ii runs the same check).
 *   node tools/whats-new-pool.js shown <version> [--pool=<file>] [--from=<file>]
 *       after <version> is PROMOTED to prod: every pool entry whose title is in that version's What's New becomes
 *       shown (shownIn <version>), and lastProd becomes <version>. Run it from the promote, not the cut.
 *
 * Exit 0 on success, 3 when the pool cannot make a showable list (no eligible highlight, or one the window rejects),
 * 2 on a usage error.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const POOL = path.join(ROOT, 'release', 'whats-new-pool.json');
const STATUSES = ['pending', 'shown', 'held'];

function readPool(file) {
  const pool = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!pool || !Array.isArray(pool.items)) throw new Error(file + ' has no items list');
  for (const it of pool.items) {
    if (!it || typeof it.title !== 'string' || !STATUSES.includes(it.status) || !Number.isFinite(it.rank)) {
      throw new Error(file + ': every item needs a title, a numeric rank and a status (' + STATUSES.join(', ') + ')');
    }
  }
  return pool;
}

const newerFirst = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
};

/** The highlights a cut shows: pending only, by rank, newest first on a tie, at most `max`. */
function choose(pool, max) {
  return pool.items
    .filter((it) => it.status === 'pending')
    .sort((a, b) => a.rank - b.rank || newerFirst(a.since, b.since) || (a.title < b.title ? -1 : 1))
    .slice(0, max)
    .map((it) => {
      const h = { icon: it.icon, title: it.title, line: it.line };
      if (Array.isArray(it.platforms) && it.platforms.length) h.platforms = it.platforms;
      return h;
    });
}

function opt(args, name, dflt) {
  const a = args.find((x) => x.startsWith('--' + name + '='));
  return a ? a.slice(name.length + 3) : dflt;
}

function main(argv) {
  const whatsnew = require('../engine/whatsnew');
  const [cmd, version] = argv.filter((a) => !a.startsWith('--'));
  if (!['build', 'shown'].includes(cmd) || !version || !whatsnew.VERSION_RE.test(version)) {
    process.stderr.write('usage: node tools/whats-new-pool.js build|shown <version like 0.7.36> [--max=5] [--pool=<file>] [--out=<file>] [--from=<file>]\n');
    return 2;
  }
  const poolFile = opt(argv, 'pool', POOL);
  const pool = readPool(poolFile);
  if (cmd === 'build') {
    const max = Number(opt(argv, 'max', String(whatsnew.MAX_HIGHLIGHTS)));
    if (!Number.isInteger(max) || max < 1 || max > whatsnew.MAX_HIGHLIGHTS) {
      process.stderr.write('--max must be 1 to ' + whatsnew.MAX_HIGHLIGHTS + '\n');
      return 2;
    }
    const obj = { version, highlights: choose(pool, max) };
    const bad = whatsnew.problems(obj, version);
    if (bad.length) {
      process.stderr.write('the pool cannot make a What\'s New for ' + version + ':\n' + bad.map((b) => '  - ' + b).join('\n') + '\n');
      return 3;
    }
    const out = opt(argv, 'out', whatsnew.FILE);
    fs.writeFileSync(out, JSON.stringify(obj, null, 2) + '\n');
    process.stdout.write(path.relative(process.cwd(), out) + ': ' + obj.highlights.length + ' highlight(s) for ' + version
      + ' since prod ' + (pool.lastProd || '?') + ':\n' + obj.highlights.map((h) => '  - ' + h.title).join('\n') + '\n');
    return 0;
  }
  // shown: the titles this PROD version showed leave the pool's eligible set for good.
  const from = opt(argv, 'from', whatsnew.FILE);
  const shownObj = JSON.parse(fs.readFileSync(from, 'utf8'));
  if (!shownObj || shownObj.version !== version || !Array.isArray(shownObj.highlights)) {
    process.stderr.write(from + ' is not the What\'s New of ' + version + '; nothing marked\n');
    return 3;
  }
  const titles = new Set(shownObj.highlights.map((h) => h.title));
  let marked = 0;
  for (const it of pool.items) {
    if (titles.has(it.title) && it.status === 'pending') { it.status = 'shown'; it.shownIn = version; marked++; }
  }
  pool.lastProd = version;
  fs.writeFileSync(poolFile, JSON.stringify(pool, null, 2) + '\n');
  process.stdout.write(marked + ' highlight(s) marked shown in prod ' + version + '\n');
  return 0;
}

if (require.main === module) {
  let code;
  try { code = main(process.argv.slice(2)); } catch (e) {
    process.stderr.write('whats-new-pool could not run: ' + ((e && e.message) || e) + '\n');
    code = 2;
  }
  process.exit(code);
}
module.exports = { main, choose, readPool };
