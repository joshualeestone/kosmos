'use strict';

/**
 * Re-insert a cut's release entry into a FRESHLY-FETCHED versions.html.
 *
 *   node tools/reinsert-versions-entry.js <base-versions.html> <our-versions.html> <version>
 *
 * kosmos#2286. The robust 7b path builds the site release commit on a freshly
 * fetched origin/main so local main never diverges (#2278 limitation 2). For the
 * cut-owned files (pointer, manifest, setup) taking our version wholesale is
 * correct, but versions.html can also carry a CONCURRENT edit that landed on
 * origin/main during the cut. Overlaying our whole versions.html would lose that
 * edit (#2278 limitation 1). Instead we take the FRESH page and RE-INSERT only our
 * new <article> entry into it, above the newest existing entry -- the same
 * placement rule tools/insert-release-entry.js uses.
 *
 * Prints the merged page to STDOUT. Writes nothing. Diagnostics go to STDERR.
 * Exit codes: 0 merged; 1 a refusal (missing entry, no anchor, already present);
 * 2 usage.
 *
 * This never edits an existing entry and refuses if the version is already on the
 * fresh page (idempotence), matching the page's never-rewrite-history rule.
 */

const fs = require('node:fs');

const args = process.argv.slice(2);
const baseFile = args[0];
const ourFile = args[1];
const version = args[2];

if (!baseFile || !ourFile || !version) {
  console.error('usage: node tools/reinsert-versions-entry.js <base-versions.html> <our-versions.html> <version>');
  process.exit(2);
}

// 0.6.37 -> v0-6-37, matching the id="v0-6-37" anchors on the page.
const id = 'v' + String(version).replace(/\./g, '-');

const base = fs.readFileSync(baseFile, 'utf8');
const ours = fs.readFileSync(ourFile, 'utf8');

// Idempotence: never rewrite an entry the fresh page already carries.
if (base.includes(`id="${id}"`)) {
  console.error(`${id} is already on the fresh page; refusing to re-insert (would rewrite history)`);
  process.exit(1);
}

// Extract OUR entry block: from its 4-space-indented <article ... id="vID"> line
// through the next 4-space-indented </article> (entries never nest). The 4-space
// indent is load-bearing -- it is how insert-release-entry.js anchors, and it
// avoids matching an </article> that might appear inside prose at another indent.
const startRe = new RegExp(`( {4})<article class="rel" id="${id}">`);
const startMatch = ours.match(startRe);
if (!startMatch) {
  console.error(`our versions.html has no entry for ${id}; refusing to re-insert`);
  process.exit(1);
}
const startAt = startMatch.index;
const closeRe = /\n {4}<\/article>/g;
closeRe.lastIndex = startAt;
const closeMatch = closeRe.exec(ours);
if (!closeMatch) {
  console.error(`could not find the closing </article> for ${id}; refusing to re-insert`);
  process.exit(1);
}
const endAt = closeMatch.index + closeMatch[0].length; // through the </article> line
const entry = ours.slice(startAt, endAt);

// Insert above the newest entry on the fresh page (its comment belongs to the
// entry below it, so go above the comment when one sits just before the anchor --
// the same 2000-char rule as insert-release-entry.js).
const anchor = base.search(/ {4}<article class="rel" id="v[0-9-]+"/);
if (anchor < 0) {
  console.error('the fresh page has no existing entry to insert above; refusing to re-insert');
  process.exit(1);
}
const commentAt = base.lastIndexOf('    <!--', anchor);
const at = (commentAt > 0 && anchor - commentAt < 2000) ? commentAt : anchor;

process.stdout.write(base.slice(0, at) + entry + '\n' + base.slice(at));
