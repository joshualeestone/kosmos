#!/usr/bin/env node
'use strict';
/**
 * What is ACTUALLY being served, checked against what you think you shipped.
 *
 * 🛑 WHY THIS EXISTS. On 2026-08-26 the room told Josh three separate times that
 * something was fixed when it was not, and twice believed a change was live
 * because it had merged. Merged is not built, a bump is not a release, and a
 * copy-out is not a release. The only thing that settles it is the bytes on the
 * CDN, and until tonight nobody was reading them.
 *
 * It downloads the pinned artifact for the served version and asserts a list of
 * markers -- strings that must be PRESENT and strings that must be ABSENT --
 * against the page and the app binary inside it.
 *
 *   node tools/check-served.js                     # markers from tools/served-markers.json
 *   node tools/check-served.js --version 0.5.76    # pin a version rather than reading latest
 *   node tools/check-served.js --expect 'pjdisc' --absent 'Two questions'
 *
 * ⚠️ WHAT IT CANNOT SEE, stated so a green run is not over-read: anything that
 * exists only because the page is hosted by an app. File pickers, the menu bar,
 * the Dock, native dialogs. In a browser the picker belongs to the browser, so
 * no automated check we own covers that class. Both native defects found on
 * 2026-08-26 were found by a person pressing a key.
 */
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BASE = process.env.KOSMOS_RELEASE_BASE || 'https://installkosmos.com/dist';
const ARCH = process.env.KOSMOS_ARCH || 'arm64';

function get(url, asBuffer) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return resolve(get(res.headers.location, asBuffer));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(url + ' -> HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(asBuffer ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : null;
}
function argAll(name) {
  const out = [];
  process.argv.forEach((a, i) => { if (a === '--' + name) out.push(process.argv[i + 1]); });
  return out;
}

(async () => {
  let version = arg('version');
  if (!version) {
    const latest = JSON.parse(await get(BASE + '/latest.json'));
    version = latest.version;
    console.log('served version (from latest.json): ' + version);
  } else {
    console.log('version (pinned by flag): ' + version);
  }

  /* ⚠️ PINNED FIRST, MOVING NAME AS FALLBACK, which is exactly what
     install/setup.sh does: it tries `kosmos-<version>-<arch>.tar.gz` and falls
     back to `kosmos-<arch>.tar.gz?v=<version>`. Mirroring the installer matters
     -- a checker that only reads the pinned name reports 404 on a build that
     real people can install perfectly well, which is what happened the first
     time this ran.
     🔑 AND THE FALLBACK IS ANNOUNCED. The moving name answers with whatever is
     current, so a check against it is only as trustworthy as the assumption
     that current == the version asked for. Saying which one was read is the
     difference between a measurement and a guess. */
  const pinned = BASE + '/kosmos-' + version + '-' + ARCH + '.tar.gz';
  const moving = BASE + '/kosmos-' + ARCH + '.tar.gz?v=' + encodeURIComponent(version);
  let url = pinned; let tgz;
  try {
    tgz = await get(pinned, true);
  } catch (e) {
    if (!/HTTP 404/.test(e.message)) throw e;
    url = moving;
    tgz = await get(moving, true);
    console.log('note: no version-pinned artifact for ' + version + '; read the moving name instead,');
    console.log('      so this confirms what is CURRENTLY served rather than that build specifically.');
  }
  console.log('artifact: ' + url + '  (' + tgz.length + ' bytes)');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-served-'));
  const tarPath = path.join(dir, 'k.tar.gz');
  fs.writeFileSync(tarPath, tgz);
  execFileSync('tar', ['-xzf', tarPath, '-C', dir, 'app/web/index.html', 'app/bin/kosmos-app'], { stdio: 'ignore' });
  const page = fs.readFileSync(path.join(dir, 'app/web/index.html'), 'utf8');
  const binary = fs.readFileSync(path.join(dir, 'app/bin/kosmos-app'));

  let markers = { present: argAll('expect'), absent: argAll('absent'), binary: argAll('binary') };
  const file = path.join(__dirname, 'served-markers.json');
  if (!markers.present.length && !markers.absent.length && !markers.binary.length && fs.existsSync(file)) {
    markers = Object.assign({ present: [], absent: [], binary: [] }, JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  /* 🔑 A FLOOR ON THE POPULATION. A check that counts occurrences and reports
     zero says "I looked and found none" and "I did not look" in the same word.
     If the page came back tiny the extraction is broken, and every ABSENT
     marker below would pass for the wrong reason. */
  if (page.length < 500000) {
    console.error('FAIL  the extracted page is only ' + page.length + ' bytes; the read is broken, so every absent-marker below would pass for the wrong reason');
    process.exit(2);
  }

  /* 🛑 ABSENT MARKERS ARE CHECKED AGAINST CODE ONLY, NOT COMMENTS, and in this
     codebase that is not a nicety. Deleting copy here comes WITH a comment
     quoting the copy that was deleted and saying who ruled it and why -- that
     is deliberate house style and it is worth keeping. But it means a naive
     absence check can never pass: "Two questions: what it is for" is gone from
     the screen and still present in the file, in the note explaining that it is
     gone.
     ⚠️ Caught before it fired. Three of the first markers written for this tool
     would have reported FAIL for ever, on copy that is correctly deleted. That
     is the fourth time in one night a string match has answered about a comment
     rather than about the product. Present-markers are matched against the raw
     page: a marker you expect to SEE should be in the live source anyway, and
     stripping first would let a marker pass on nothing. */
  const codeOnly = page
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    /* ⚠️ LINE COMMENTS TOO, AND ONLY WHERE THE LINE STARTS WITH THEM. Angel hit
       this within a minute of running the same check on her own deletions: a
       `sed 's://.*::'` missed her offender because it was a block comment, and
       the mirror of that is missing the line-comment ones. Measured on this
       page: 1842 lines begin with `//`, and "could not look" appears in five of
       them -- enough to defeat that absent-marker on its own.
       🛑 START-OF-LINE ONLY, because 16 URLs in this file contain `//`. A naive
       `//.*$` would truncate live code after every https:// and could HIDE a
       real occurrence, turning an absent-marker green for the worst possible
       reason. Over-stripping is not the safe direction here: under-stripping
       gives a false FAIL you investigate, over-stripping gives a false PASS
       nobody looks at. */
    .replace(/^[ \t]*\/\/.*$/gm, '');
  /* ⚠️ 0.10, NOT 0.5. This page is genuinely more than half comments -- stripping
     them leaves 49% -- so a half-the-page threshold fires on a healthy file. The
     floor is here to catch a strip that ate everything, not to have an opinion
     about comment density. Measured before choosing the number, which is the
     step that was missing the first time. */
  if (codeOnly.length < page.length * 0.10) {
    console.error('FAIL  stripping comments removed more than half the page (' + page.length + ' -> ' + codeOnly.length + '); the strip is broken and every absent-marker below would pass for the wrong reason');
    process.exit(2);
  }

  let bad = 0;
  const say = (ok, line) => { console.log((ok ? 'ok    ' : 'FAIL  ') + line); if (!ok) bad += 1; };
  for (const m of markers.present) say(page.includes(m), 'present in page: ' + m);
  for (const m of markers.absent) say(!codeOnly.includes(m), 'absent from page code: ' + m);
  for (const m of markers.binary) say(binary.includes(Buffer.from(m)), 'present in app binary: ' + m);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? '\n' + bad + ' marker(s) wrong in the SERVED build' : '\nall markers correct in the served build');
  console.log('note: native surfaces (file pickers, menu bar, Dock) are not covered by this or any check we own.');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL  ' + e.message); process.exit(2); });
