'use strict';
/**
 * kosmos#8132: every marker tools/served-markers.json says must be PRESENT in a served artifact has a source in this
 * repo, so a marker that names a sentence no file has fails here, when it is added or when its source is changed,
 * instead of failing forever against every served build (the .pkg presence marker did, for weeks, after #2073).
 *
 * Where each kind is read from, as tools/check-served.js reads the served bytes:
 *   present, order  web/index.html (served as app/web/index.html); for order, presence only (web.ruling-guards.test.js
 *                   holds the order itself)
 *   pkg_present     the three pages the installer serves: install/pkg-scripts/installing.html and
 *                   install/pkg-resources/{welcome,conclusion}.html (tools/build-installer-pkg.sh)
 *   binary          NOT checked here, on purpose: it is matched against the COMPILED app, where a WebKit delegate
 *                   method is an Objective-C selector string ("runOpenPanel") that no source file spells.
 * The absent kinds are not checked here either: a marker that must be absent has no source by design.
 * Matched against each source with its comments stripped (the strip check-served.js's pkg arm uses on its absent side). So this is
 * deliberately STRICTER than the served check, which matches present markers against the raw page: a marker live only
 * in a comment passes there and fails here. The strip is non-greedy and can over-strip a page holding a '/*' string or
 * regex literal; that gives a false red here, never a false green.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const markers = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/served-markers.json'), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// check-served.js's strip, for the absent side there: HTML comments, block comments, and whole-line // comments.
const strip = (t) => t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const RAW_PAGE = read('web/index.html');
const PAGE = strip(RAW_PAGE);
// The sources tools/build-installer-pkg.sh packs: install/pkg-scripts (component.pkg/Scripts) and --resources
// install/pkg-resources (Resources). The first test holds the build script to those two folders.
const PKG_PAGES = ['install/pkg-scripts/installing.html', 'install/pkg-resources/welcome.html', 'install/pkg-resources/conclusion.html'];
const PKG = PKG_PAGES.map((rel) => ({ rel, body: strip(read(rel)) }));
const inPkg = (m) => PKG.some((p) => p.body.includes(m));

test('kosmos#8132: the sources are the files check-served reads, and none is empty (else every marker would fail)', () => {
  assert.ok(PAGE.length > 100000, 'web/index.html read as ' + PAGE.length + ' bytes after the comment strip');
  assert.ok(PAGE.length > RAW_PAGE.length * 0.1, 'the comment strip removed more than 90% of web/index.html; it is broken');
  for (const p of PKG) assert.ok(p.body.length > 500, p.rel + ' read as ' + p.body.length + ' bytes');
  // The strip here is a copy of check-served.js's (a local there, so it cannot be imported): hold the two to one text.
  const ourStrip = /^const strip = \(t\) => (.*);$/m.exec(read('tools.served-markers-sources-8132.test.js'));
  assert.ok(ourStrip && read('tools/check-served.js').includes('const strip = (t) => ' + ourStrip[1] + ';'),
    'the comment strip here no longer matches check-served.js\'s; copy it again');
  const build = read('tools/build-installer-pkg.sh');
  assert.ok(build.includes('install/pkg-scripts') && build.includes('install/pkg-resources'),
    'build-installer-pkg.sh no longer packs install/pkg-scripts and install/pkg-resources; update PKG_PAGES here to match');
  // check-served reads exactly these pages from the expanded .pkg; if it reads another, PKG_PAGES here must follow.
  const served = read('tools/check-served.js');
  const lit = /const PAGES = (\[[^\]]*\]);/.exec(served);
  assert.ok(lit, 'check-served.js has no `const PAGES = [...]` list to compare with');
  assert.deepEqual(JSON.parse(lit[1].replace(/'/g, '"')), ['component.pkg/Scripts/installing.html', 'Resources/welcome.html', 'Resources/conclusion.html'],
    'check-served.js reads a different set of installer pages; update PKG_PAGES here to match');
});

test('kosmos#8132: every present and order marker is in web/index.html', () => {
  const kinds = [['present', markers.present || []], ['order', (markers.order || []).flat()]];
  let n = 0;
  for (const [kind, list] of kinds) {
    for (const m of list) { n++; assert.ok(PAGE.includes(m), kind + ' marker has no source in web/index.html: ' + JSON.stringify(m)); }
  }
  assert.ok(n > 0, 'no present or order markers were read, so this test checked nothing');
});

test('kosmos#8132: every pkg_present marker is in one of the installer\'s three pages', () => {
  const list = markers.pkg_present || [];
  assert.ok(list.length > 0, 'no pkg_present markers were read, so this test checked nothing');
  for (const m of list) assert.ok(inPkg(m), 'pkg_present marker has no source in ' + PKG_PAGES.join(', ') + ': ' + JSON.stringify(m));
});

test('kosmos#8132 CONTROL: the lookups can say no (a made-up marker, and the old dead .pkg sentence, are not found)', () => {
  const madeUp = 'kosmos#8132 control sentence that no file has';
  assert.equal(PAGE.includes(madeUp), false);
  assert.equal(inPkg(madeUp), false);
  // The marker this card replaced (no source since #2073). Present again means that copy came back, not a broken
  // lookup: then it may be a marker again, and this line should go.
  assert.equal(inPkg('This page becomes your dashboard when Kosmos is ready.'), false, 'the old installer sentence is back in a page source; if that is on purpose, remove this line');
  // A sentence that is in a source only inside a comment does not count: "Nothing to do." survives in installing.html
  // only in the comment that records its deletion (Josh, item 4).
  const rawPkg = PKG_PAGES.map(read).join('\n');
  assert.ok(rawPkg.includes('Nothing to do.'), 'CONTROL: the comment that quotes "Nothing to do." is gone; pick another commented-only sentence');
  assert.equal(inPkg('Nothing to do.'), false, 'a sentence found only in a comment counted as a source');
  // And on web/index.html: an absent marker that check-served notes survives in its deletion comment.
  const commented = 'Two questions: what it is for';
  assert.ok(RAW_PAGE.includes(commented), 'CONTROL: web/index.html no longer quotes "' + commented + '" in a comment; pick another');
  assert.equal(PAGE.includes(commented), false, 'a sentence found only in a comment of web/index.html counted as a source');
});
