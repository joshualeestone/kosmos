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
 *   node tools/whats-new-pool.js shown <version> --promoted [--pool=<file>] [--from=<file> | --from-history]
 *       after <version> is PROMOTED to prod: every pool entry whose title is in that version's What's New becomes
 *       shown (shownIn <version>), and lastProd becomes <version>. Run it from the promote, not the cut: --promoted is
 *       required, so it is never run by reflex after a cut (that would retire highlights prod users never saw).
 *       --from-history reads that version's What's New from this checkout's git history (the newest commit whose
 *       web/whats-new.json names it); there are no per-version tags to read it from.
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
    if (!it || typeof it.title !== 'string' || !STATUSES.includes(it.status) || !Number.isFinite(it.rank)
      || typeof it.since !== 'string' || !/^\d+\.\d+\.\d+$/.test(it.since)) {
      throw new Error(file + ': every item needs a title, a numeric rank, a since version and a status (' + STATUSES.join(', ') + ')');
    }
  }
  // Titles are how `shown` finds what prod showed: two items with one title would be marked together.
  const seen = new Set();
  for (const it of pool.items) {
    if (seen.has(it.title)) throw new Error(file + ': the title "' + it.title + '" appears twice');
    seen.add(it.title);
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

/** The What's New <version> shipped: the newest commit in this checkout's history whose web/whats-new.json names it. */
function fromHistory(version, root = ROOT) {
  const { execFileSync } = require('node:child_process');
  const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  for (const sha of git(['log', '--format=%H', 'HEAD', '--', 'web/whats-new.json']).split('\n').filter(Boolean)) {
    let obj;
    try { obj = JSON.parse(git(['show', sha + ':web/whats-new.json'])); } catch { continue; }   // deleted or unparsable there
    if (obj && obj.version === version) return obj;
  }
  return null;
}

function opt(args, name, dflt) {
  const a = args.find((x) => x.startsWith('--' + name + '='));
  return a ? a.slice(name.length + 3) : dflt;
}

function main(argv) {
  const whatsnew = require('../engine/whatsnew');
  // Only --name=value flags this tool knows: a typo (`--outt=`) or `--max 4` must not silently do something else.
  const unknown = argv.filter((a) => a.startsWith('--') && !/^--(max|pool|out|from)=./.test(a) && a !== '--promoted' && a !== '--from-history');
  if (unknown.length) {
    process.stderr.write('unknown or malformed option(s): ' + unknown.join(' ') + ' (use --max=N, --pool=FILE, --out=FILE, --from=FILE, --from-history, --promoted)\n');
    return 2;
  }
  const [cmd, version] = argv.filter((a) => !a.startsWith('--'));
  if (!['build', 'shown'].includes(cmd) || !version || !whatsnew.VERSION_RE.test(version)) {
    process.stderr.write('usage: node tools/whats-new-pool.js build|shown <version like 0.7.36> [--max=5] [--pool=<file>] [--out=<file>] [--from=<file> | --from-history] [--promoted]\n');
    return 2;
  }
  const poolFile = opt(argv, 'pool', POOL);
  const pool = readPool(poolFile);
  if (cmd === 'build') {
    // Every pending item must be one the window can show, checked now rather than the day it reaches the top 5.
    // (Only on build: a malformed pending item must not stop `shown` recording what prod showed.)
    for (const it of pool.items.filter((i) => i.status === 'pending')) {
      const h = { icon: it.icon, title: it.title, line: it.line };
      if (it.platforms) h.platforms = it.platforms;
      const bad = whatsnew.problems({ version, highlights: [h] }, version);
      if (bad.length) {
        process.stderr.write('the pool item "' + it.title + '" is not one the window can show: ' + bad.join('; ') + '\n');
        return 3;
      }
    }
    const max = Number(opt(argv, 'max', String(whatsnew.MAX_HIGHLIGHTS)));
    if (!Number.isInteger(max) || max < 1 || max > whatsnew.MAX_HIGHLIGHTS) {
      process.stderr.write('--max must be 1 to ' + whatsnew.MAX_HIGHLIGHTS + '\n');
      return 2;
    }
    // A What's New is for a version AFTER the last prod release (the window shows what is new since it).
    if (pool.lastProd && newerFirst(version, pool.lastProd) >= 0) {
      process.stderr.write(version + ' is not newer than the last PROD release the pool records (' + pool.lastProd + '); nothing written\n');
      return 3;
    }
    const obj = { version, highlights: choose(pool, max) };
    const bad = whatsnew.problems(obj, version);
    // The cut also checks each platform has a highlight (release.sh --platform=mac; the Windows build --platform=windows).
    const per = whatsnew.countsByPlatform(obj);
    for (const p of whatsnew.PLATFORMS) if (!per[p]) bad.push('no highlight for ' + p + ' (every chosen one is tagged for another platform)');
    if (bad.length) {
      process.stderr.write('the pool cannot make a What\'s New for ' + version + ':\n' + bad.map((b) => '  - ' + b).join('\n') + '\n');
      return 3;
    }
    const out = opt(argv, 'out', whatsnew.FILE);
    fs.writeFileSync(out, JSON.stringify(obj, null, 2) + '\n');
    const rel = path.relative(process.cwd(), out);
    process.stdout.write((rel.startsWith('..') ? out : rel) + ': ' + obj.highlights.length + ' highlight(s) for ' + version
      + ':\n' + obj.highlights.map((h) => '  - ' + h.title).join('\n') + '\n'
      + 'The pool says the last PROD release was ' + (pool.lastProd || 'not recorded') + '. If a newer version reached prod, first'
      + ' run, ON an up-to-date MAIN (main\'s pool, never a release checkout\'s):'
      + ' node tools/whats-new-pool.js shown <that version> --promoted --from-history, then commit release/whats-new-pool.json to main.'
      + ' Otherwise prod users see its highlights again.\n'
      + 'Eligible means not yet shown to PROD users, so people who ran staging builds since ' + (pool.lastProd || 'then') + ' may see some of these again (#5711).\n'
      + 'Edit titles and lines in release/whats-new-pool.json and build again, never in the built file: `shown` matches by title.\n');
    return 0;
  }
  // shown: the titles this PROD version showed leave the pool's eligible set for good.
  if (!argv.includes('--promoted')) {
    process.stderr.write('shown retires highlights for good: run it only after ' + version + ' is PROMOTED to prod, and say so with'
      + ' --promoted. Nothing marked.\n');
    return 2;
  }
  const fromHist = argv.includes('--from-history');
  const from = fromHist ? 'git history' : opt(argv, 'from', whatsnew.FILE);
  const shownObj = fromHist ? fromHistory(version) : JSON.parse(fs.readFileSync(from, 'utf8'));
  if (!shownObj || shownObj.version !== version || !Array.isArray(shownObj.highlights)) {
    process.stderr.write(from + ' is not the What\'s New of ' + version + '; nothing marked\n');
    return 3;
  }
  if (pool.lastProd && newerFirst(version, pool.lastProd) > 0) {   // > 0: lastProd is the newer of the two
    process.stderr.write('the pool already records prod ' + pool.lastProd + ', newer than ' + version + '; nothing marked\n');
    return 3;
  }
  // Every highlight prod showed must be found in the pool, or a reworded one would stay pending and show again.
  const byTitle = new Set(pool.items.map((it) => it.title));
  const unmatched = shownObj.highlights.map((h) => h.title).filter((t) => !byTitle.has(t));
  if (unmatched.length) {
    process.stderr.write('these highlights of ' + version + ' are not in the pool (reworded after the build?): '
      + unmatched.map((t) => '"' + t + '"').join(', ') + '. Make the pool titles match, then run this again; nothing marked\n');
    return 3;
  }
  const titles = new Set(shownObj.highlights.map((h) => h.title));
  let marked = 0;
  for (const it of pool.items) {
    if (titles.has(it.title) && it.status === 'pending') { it.status = 'shown'; it.shownIn = version; marked++; }
  }
  pool.lastProd = version;
  // Temp file then rename: a crash mid-write must not truncate the only record of what prod showed.
  const tmpFile = poolFile + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(pool, null, 2) + '\n');
    fs.renameSync(tmpFile, poolFile);
  } finally { fs.rmSync(tmpFile, { force: true }); }
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
module.exports = { main, choose, readPool, newerFirst, fromHistory };
