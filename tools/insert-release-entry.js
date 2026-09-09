'use strict';

/**
 * Put a release entry on the versions page, stamped with the minute it went out.
 *
 *   node tools/insert-release-entry.js <entry.html> [--site <path>]
 *
 * ⚠️ THE COPY IS NOT GENERATED, and that split is deliberate: entry wording is
 * ruled, and a script that wrote it would be a script inventing claims about
 * what a release does. What IS mechanical is the timestamp (the one field that
 * cannot be written in advance) and the placement (above the newest entry,
 * never inside or over an existing one).
 *
 * ⚠️ AND THE PAGE'S OWN RULE IS NEVER TO EDIT AN EXISTING ENTRY. This only ever
 * INSERTS: when the version is already on the page it writes NOTHING rather than
 * replacing it, so a re-run cannot quietly rewrite history.
 * 📌 "Writes nothing", not "refuses": it exits 0, which is what lets the cut call it
 * unconditionally. An earlier version of this sentence said "refuses", and the
 * paragraph below said "exits 0" -- a header contradicting its own file, which this
 * tree treats as a defect rather than a wording preference.
 *
 * The entry file carries `TIMESTAMP` where the time goes.
 *
 * 🛑 IT STAMPS **NOW**, AND THAT IS ONLY CORRECT IMMEDIATELY BEFORE THE DEPLOY.
 * Every document around it -- docs/releasing.md, and the step 1 refusal added by
 * #1463 -- tells the operator to stamp for PUBLICATION, about fifteen minutes
 * ahead, because an entry written at launch has aged by the length of the cut
 * by the time step 7 reads it. So running this BEFORE launching a cut produces
 * exactly the stamp the gates are built to reject.
 *
 * ✅ WIRED, #1455 (2026-09-08). tools/release.sh calls this at step 7a, immediately
 * before the step 7 gate, when a pending entry file is present -- the moment this
 * header's rule above says is the only correct one. The old hand-stamped flow is
 * untouched and still works: this exits 0 with "nothing written" when the version is
 * already on the page, so a hand-stamped cut passes straight through the call.
 *
 * 📌 THE PARAGRAPH THAT USED TO SIT HERE WAS STALE IN TWO DIRECTIONS, and both are
 * worth recording rather than quietly deleting. It said "it has no test" -- it has had
 * one since package.json began running tools/test-insert-release-entry.sh in
 * test:shell. And it said "invoked by nothing", measured 2026-08-28, which was true
 * then and is what kosmos#1455 was filed about.
 *
 * ⭐ The count in it had ALREADY been published wrong twice (once from a sweep piped
 * through `head -5`, which reported the limit rather than the count). A file that
 * argues from its own measurement has to re-measure when it changes, or it teaches the
 * next reader something false with all the authority of a comment that was once right.
 */

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const entryFile = args.find((a) => !a.startsWith('--'));
const siteIdx = args.indexOf('--site');
const SITE = siteIdx >= 0 ? args[siteIdx + 1]
  : (process.env.KOSMOS_SITE || path.join(process.env.HOME, 'work', 'chaoskosmos-site'));

if (!entryFile) {
  console.error('usage: node tools/insert-release-entry.js <entry.html> [--site <path>]');
  process.exit(2);
}

const page = path.join(SITE, 'versions.html');
const entry = fs.readFileSync(entryFile, 'utf8');
let html = fs.readFileSync(page, 'utf8');

const idMatch = entry.match(/id="(v[0-9-]+)"/);
if (!idMatch) { console.error('the entry has no id="v0-0-0" anchor'); process.exit(1); }
const id = idMatch[1];

if (html.includes(`id="${id}"`)) {
  console.log(`   ${id} is already on the page; nothing written`);
  process.exit(0);
}
if (!entry.includes('TIMESTAMP')) {
  console.error('the entry has no TIMESTAMP placeholder, so it would go out undated');
  process.exit(1);
}

/* ⚠️ CENTRAL, because that is the clock every other entry on this page is
   stamped in and the one Josh reads. A release stamped in the machine's
   timezone would be a different fact wearing the same format.
   #1464: the label now comes from timeZoneName, so it is CDT in summer and CST
   in winter. It used to be a hard-coded literal CDT that was simply wrong for
   half the year. The gate reads the wall-clock time and not the label, so the
   label is for the human reading the page -- but a page that lies about which
   clock it used is what cost the afternoon this card is named for. */
const when = new Date().toLocaleString('en-US', {
  timeZone: 'America/Chicago',
  month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  timeZoneName: 'short',
}).replace(' at ', ', ');
/* 🛑 EVERY OCCURRENCE, NOT THE FIRST. `String.replace` with a string pattern
   replaces once, so an entry carrying TIMESTAMP twice went out with a literal
   `TIMESTAMP` on the public page. Pre-existing, and harmless only while nothing
   called this; #1455 makes the path live, which is what turns it into a defect. */
const stamped = entry.split('TIMESTAMP').join(when);

/* Above the newest entry, and above its comment if it has one: the comment
   belongs to the entry below it, so inserting between them would orphan it. */
const anchor = html.search(/ {4}<article class="rel" id="v[0-9-]+"/);
if (anchor < 0) { console.error('no existing entry found to insert above'); process.exit(1); }
const commentAt = html.lastIndexOf('    <!--', anchor);
const at = (commentAt > 0 && anchor - commentAt < 2000) ? commentAt : anchor;

fs.writeFileSync(page, html.slice(0, at) + stamped + '\n' + html.slice(at));
console.log(`   inserted ${id}, stamped ${when}`);
