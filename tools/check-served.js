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

  let markers = { present: argAll('expect'), absent: argAll('absent'), binary: argAll('binary'), order: [] };
  const file = path.join(__dirname, 'served-markers.json');
  if (!markers.present.length && !markers.absent.length && !markers.binary.length && fs.existsSync(file)) {
    markers = Object.assign({ present: [], absent: [], binary: [], order: [] }, JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  /* 🛑 THE BUNDLE MUST AGREE WITH THE POINTER, or this whole run describes a
     build nobody asked about.
     `latest.json` is written at STEP 8 of a cut and the run keeps going after
     it, so the pointer reads the new version while the artifacts may still be
     the old ones -- Angel caught that on 0.5.76 and it is why "the completed
     line is the signal, not the pointer".
     ⚠️ THIS TOOL WAS EXPOSED TO EXACTLY THAT. It resolves the version FROM the
     pointer, then reports markers under that heading. Mid-cut it would have
     said "served version 0.5.77" and checked 0.5.76's bytes, in the confident
     voice, which is the failure it exists to prevent -- one level up.
     🔑 The bundle bakes its own version at build time (`kosmos-version` meta,
     and the comment there says why: a fact about the BUNDLE must not require
     the bundle's API). So the artifact can be asked what it is, rather than
     believed. */
  const stampM = page.match(/<meta name="kosmos-version" content="([^"]*)">/);
  const stamp = stampM ? stampM[1] : null;
  if (!stamp || stamp === '__KOSMOS_VERSION__') {
    console.error('FAIL  the downloaded bundle carries no baked version (' + (stamp || 'none') + '); it is a source checkout or an unstamped build, and nothing below describes a release');
    process.exit(2);
  }
  if (stamp !== version) {
    console.error('FAIL  latest.json says ' + version + ' but the artifact says it is ' + stamp + '.');
    console.error('      A cut writes the pointer at step 8 and keeps running, so this is what mid-cut looks like.');
    console.error('      Nothing below would describe the version you asked about. Wait for the completed line.');
    process.exit(2);
  }
  console.log('bundle self-reports: ' + stamp + '  (agrees with the pointer)');

  /* 🛑 AND NOW READ BACK: DOES THE REPO KNOW ABOUT WHAT WE SHIPPED?
     Angel's finding, 2026-08-27, and it is the gap every check here had. On the
     night of the 26th we proved the artifact matched the manifest and the
     bundle matched its own stamp -- outward, outward, outward. Nobody asked the
     opposite question, and for five hours `origin/main` said 0.5.76 while
     0.5.77 was served, WHILE ALL OF US REPORTED THE RELEASE AS VERIFIED.
     ⚠️ THE COST IS A COLLIDING RELEASE, not an untidy repo. A cut taken from a
     main that does not know about the shipped version bumps to that SAME
     version again and publishes a second, different build over it. That is the
     stacked-versions.html failure one layer up, and it killed a cut the night
     before.
     📌 Best-effort: no git, a shallow clone or a detached checkout gives a
     warning rather than a failure. This tool's job is the served bytes; this
     arm is a second opinion, and a second opinion that cannot be obtained is
     not a defect in the first. */
  try {
    const head = execFileSync('git', ['show', 'origin/main:package.json'], { cwd: __dirname, encoding: 'utf8' });
    const repoVersion = JSON.parse(head).version;
    if (repoVersion !== version) {
      console.log('');
      console.error('FAIL  origin/main says ' + repoVersion + ' but ' + version + ' is SERVED.');
      console.error('      The repo does not know about the build that shipped. A cut taken from');
      console.error('      main now bumps to ' + version + ' again and publishes a second, different');
      console.error('      build over the served one. Push the version bump before cutting.');
      process.exit(1);
    }
    console.log('origin/main agrees:  ' + repoVersion + '  (the repo knows what shipped)');
  } catch (e) {
    if (/FAIL  origin/.test(String(e && e.message))) throw e;
    console.log('note: could not read origin/main package.json (' + String(e && e.code || e).slice(0, 40) + '); skipping the repo cross-check.');
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

  /* 🛑 AN EMPTY MARKER IS NOT A WEAK CHECK, IT IS A GREEN LIGHT. Kitty found
     this shape in the relay verifier on 2026-08-27: `grep -F ''` matched
     everything, 164574 hits, and a DIRTY build passed as clean. The same hole
     is here, in three of the four kinds:

       present:  page.includes('')            -> ALWAYS true   -> passes silent
       order:    an empty FIRST element gets indexOf 0, which is less than every
                 real index, so the sequence looks correctly ordered -> passes
       binary:   Buffer.from('') is found in any buffer -> passes silent
       absent:   !code.includes('') -> ALWAYS false -> fails loudly, safe

     ⚠️ THE DANGEROUS ONES ALL FAIL TOWARD PASS, which is the direction nobody
     investigates. And an empty marker is not exotic: a trailing comma edit, a
     shell variable that did not expand, a hand-written JSON entry left blank.
     ⇒ Refuse the whole run rather than skip the entry. Skipping it would leave
     a marker list that reads as coverage and silently checks one thing fewer,
     which is the same defect one level up. */
  const kinds = [['present', markers.present], ['absent', markers.absent], ['binary', markers.binary]];
  const blank = [];
  for (const [name, list] of kinds) {
    (list || []).forEach((m, i) => { if (typeof m !== 'string' || m.trim() === '') blank.push(name + '[' + i + ']'); });
  }
  (markers.order || []).forEach((seq, i) => {
    if (!Array.isArray(seq) || seq.length < 2) { blank.push('order[' + i + '] (needs at least two anchors to express an order)'); return; }
    seq.forEach((m, k) => { if (typeof m !== 'string' || m.trim() === '') blank.push('order[' + i + '][' + k + ']'); });
  });
  if (blank.length) {
    console.error('FAIL  empty or non-string marker(s): ' + blank.join(', '));
    console.error('      An empty marker PASSES for present/order/binary -- it matches everything, so it reports');
    console.error('      coverage while checking nothing. Fix or remove the entry; the run refuses rather than');
    console.error('      skipping it, because a silently shorter marker list is the same defect one level up.');
    process.exit(2);
  }
  for (const m of markers.present) say(page.includes(m), 'present in page: ' + m);
  for (const m of markers.absent) say(!codeOnly.includes(m), 'absent from page code: ' + m);
  for (const m of markers.binary) say(binary.includes(Buffer.from(m)), 'present in app binary: ' + m);

  /* 🛑 ORDER MARKERS, AND THEY EXIST BECAUSE THREE OF JOSH'S RULINGS COULD NOT
     BE SAID IN THIS FILE'S VOCABULARY. Items 8, 9 and 10 on 2026-08-26 were the
     download progress bar, the setup messages and "Claude Max 20 is connected"
     all rendering at the BOTTOM of the provider list instead of under the row he
     had just pressed: "it is showing below all of the models in the wrong spot".

     ⚠️ A PRESENT-MARKER CANNOT EXPRESS THAT. `fr-sub` is present whether the
     panel sits under Claude or under Mistral, so the marker is green in both the
     fixed and the broken build. The ruling is about PLACEMENT, and placement is
     an ORDER property -- which meant the fix looked guarded and was not, in a
     file whose entire purpose is to stop us believing that.

     🔑 Each entry is a list of strings that must appear in this order in the
     served page. Checked against the RAW page, like present-markers: these are
     markup anchors that should be in the live source anyway, and stripping
     first would let one pass on nothing.
     📌 A missing anchor is reported as missing rather than as out-of-order --
     they are different repairs, and a check that says the wrong one sends the
     next person to the wrong file. */
  for (const seq of markers.order) {
    const at = seq.map((m) => ({ m, i: page.indexOf(m) }));
    const missing = at.filter((x) => x.i < 0);
    if (missing.length) {
      say(false, 'order [' + seq.join(' < ') + ']: anchor not found at all: ' + missing.map((x) => x.m).join(', '));
      continue;
    }
    let ok = true;
    for (let k = 1; k < at.length; k += 1) if (at[k].i <= at[k - 1].i) { ok = false; break; }
    say(ok, 'in this order in page: ' + seq.join(' < ')
      + (ok ? '' : '  [actual: ' + at.slice().sort((a, b) => a.i - b.i).map((x) => x.m).join(' < ') + ']'));
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? '\n' + bad + ' marker(s) wrong in the SERVED build' : '\nall markers correct in the served build');
  console.log('note: native surfaces (file pickers, menu bar, Dock) are not covered by this or any check we own.');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL  ' + e.message); process.exit(2); });
