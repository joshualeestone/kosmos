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
 * "prod" here is the Mac prod family (promote-channel.sh without --family win). Windows is promoted on its own and
 * shows whichever list is current when its build is made (its number goes in the built file's "also", by hand,
 * on the release branch, docs/windows RELEASING.md); the pool does not record Windows promotes.
 *   held     a feature that is held or dropped (conversation mode, Josh 10:49): never chosen, whatever its rank
 * A Windows-only highlight is never marked shown (the pool records Mac promotes only), so once Windows prod has shown
 * it, RETIRE IT BY HAND: set its status to shown, with shownIn the Windows version.
 * A highlight tagged for ONE platform still takes one of the 5 slots of the one file both platforms read (the engine
 * caps the file, not each platform's view), so that platform's window shows fewer. Tag an item only when it truly is
 * one platform's; build refuses a list that leaves a platform with none.
 *
 *   node tools/whats-new-pool.js build <version> [--max=5] [--pool=<file>] [--out=<file>]
 *       writes web/whats-new.json: the top --max pending highlights by rank (ties: newest first), checked with
 *       engine/whatsnew.js's own rules (the cut's step 1b-ii runs the same check).
 *   node tools/whats-new-pool.js shown <version> --promoted [--pool=<file>] [--from=<file> | --from-history [--ref=<commit>]]
 *       after <version> is PROMOTED to prod: every pool entry whose title is in that version's What's New becomes
 *       shown (shownIn <version>), and lastProd becomes <version>. Run it from the promote, not the cut: --promoted is
 *       required, so it is never run by reflex after a cut (that would retire highlights prod users never saw).
 *       --from-history reads that version's What's New from git, EXACTLY at --ref (required), refusing a file there
 *       for another version; there are no per-version tags to read it from. Give --ref=<the cut's frozen sha>
 *       (the cut prints it at step 2b, "frozen at <sha>", and ~/.claude/logs/cut-suite-runs.log on THE BOX THAT RAN
 *       THE CUT records it as frozen_sha=) so a wording changed on main AFTER the freeze is not read as
 *       what prod showed.
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
  if (pool.lastProd !== undefined && (typeof pool.lastProd !== 'string' || !/^\d+\.\d+\.\d+$/.test(pool.lastProd))) {
    throw new Error(file + ': lastProd must be a version like 0.7.35, not ' + JSON.stringify(pool.lastProd));
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

/**
 * The What's New <version> shipped: web/whats-new.json EXACTLY at `ref`, the cut's frozen sha, or null when the file
 * there is not for that version. Review 11: it never walks back. A later commit (HEAD, origin/main) would otherwise
 * yield main's post-freeze wording, and a highlight removed after the freeze would stay pending though prod showed it.
 * The cut refuses a frozen tree whose file is for another version (release.sh step 2b re-check), so the frozen sha
 * always qualifies.
 */
function fromHistory(version, root, ref) {
  const { execFileSync } = require('node:child_process');
  let obj;
  try {
    obj = JSON.parse(execFileSync('git', ['-C', root, 'show', ref + ':web/whats-new.json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }));
  } catch { return null; }   // no such commit, no such file there, or not JSON
  return obj && obj.version === version ? obj : null;
}

function opt(args, name, dflt) {
  const a = args.find((x) => x.startsWith('--' + name + '='));
  return a ? a.slice(name.length + 3) : dflt;
}

function main(argv) {
  const whatsnew = require('../engine/whatsnew');
  // Only --name=value flags this tool knows: a typo (`--outt=`) or `--max 4` must not silently do something else.
  const unknown = argv.filter((a) => a.startsWith('--') && !/^--(max|pool|out|from|ref)=./.test(a) && a !== '--promoted' && a !== '--from-history');
  if (unknown.length) {
    process.stderr.write('unknown or malformed option(s): ' + unknown.join(' ') + ' (use --max=N, --pool=FILE, --out=FILE, --from=FILE, --from-history, --ref=COMMIT, --promoted)\n');
    return 2;
  }
  const positional = argv.filter((a) => !a.startsWith('--'));
  const [cmd, version] = positional;
  if (positional.length !== 2 || !['build', 'shown'].includes(cmd) || !version || !whatsnew.VERSION_RE.test(version)) {
    process.stderr.write('usage: node tools/whats-new-pool.js build|shown <version like 0.7.36> [--max=5] [--pool=<file>] [--out=<file>] [--from=<file> | --from-history [--ref=<commit>]] [--promoted]\n');
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
    const tmpOut = out + '.tmp-' + process.pid;
    try {
      fs.writeFileSync(tmpOut, JSON.stringify(obj, null, 2) + '\n');
      fs.renameSync(tmpOut, out);
    } finally { fs.rmSync(tmpOut, { force: true }); }
    const rel = path.relative(process.cwd(), out);
    process.stdout.write((rel.startsWith('..') ? out : rel) + ': ' + obj.highlights.length + ' highlight(s) for ' + version
      + ':\n' + obj.highlights.map((h) => '  - ' + h.title).join('\n') + '\n'
      + 'The pool says the last PROD release was ' + (pool.lastProd || 'not recorded') + '. If a newer version reached prod, first'
      + ' run, ON an up-to-date MAIN (main\'s pool, never a release checkout\'s):'
      + ' node tools/whats-new-pool.js shown <that version> --promoted --from-history --ref=<its cut\'s frozen sha>, then commit release/whats-new-pool.json to main.'
      + ' Otherwise prod users see its highlights again.\n'
      + 'Eligible means not yet shown to PROD users, so people who ran earlier staging builds may see some of these again (#5711).\n'
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
  if (fromHist && opt(argv, 'from', null) !== null) {
    process.stderr.write('give --from=<file> or --from-history, not both; nothing marked\n');
    return 2;
  }
  if (!fromHist && opt(argv, 'ref', null) !== null) {
    process.stderr.write('--ref only goes with --from-history; nothing marked\n');
    return 2;
  }
  // Review 9: HEAD is main's LATEST wording for that version, which can differ from what was cut (0.7.34 lost an item
  // after its first commit). The frozen sha is the only honest answer, so it is required, never defaulted.
  if (fromHist && opt(argv, 'ref', null) === null) {
    process.stderr.write('--from-history needs --ref=<the cut\'s frozen sha> (step 2b of the cut, or frozen_sha= in the cut box\'s'
      + ' ~/.claude/logs/cut-suite-runs.log); nothing marked\n');
    return 2;
  }
  const from = fromHist ? 'git history at ' + opt(argv, 'ref', '') : opt(argv, 'from', whatsnew.FILE);
  const shownObj = fromHist ? fromHistory(version, ROOT, opt(argv, 'ref', '')) : JSON.parse(fs.readFileSync(from, 'utf8'));
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
    // Review 9: the pool tracks MAC prod, and the Mac never shows a highlight tagged for other platforms only, so a
    // Mac promote leaves it pending for the platform that has not shown it yet.
    const onMac = !Array.isArray(it.platforms) || !it.platforms.length || it.platforms.includes('mac');
    if (titles.has(it.title) && it.status === 'pending' && onMac) { it.status = 'shown'; it.shownIn = version; marked++; }
  }
  pool.lastProd = version;
  // Temp file then rename: a crash mid-write must not truncate the only record of what prod showed.
  const tmpFile = poolFile + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(pool, null, 2) + '\n');
    fs.renameSync(tmpFile, poolFile);
  } finally { fs.rmSync(tmpFile, { force: true }); }
  process.stdout.write(marked + ' highlight(s) marked shown in prod ' + version + ' (read from ' + from + ')\n');
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
