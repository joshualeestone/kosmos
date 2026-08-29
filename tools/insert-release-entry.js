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
 * INSERTS: it refuses if the version is already on the page rather than
 * replacing it, so a re-run cannot quietly rewrite history.
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
 * ⚠️ THIS TOOL IS CURRENTLY INVOKED BY NOTHING. Measured 2026-08-28: a sweep of
 * the whole tree finds no caller -- every file that names it does so in prose.
 * Control: `verify-served`, which IS wired, appears in 16 files including
 * release.sh and package.json. It has no test and no mention in the runbook, so
 * today the stamp is written by hand and this tool is an unused alternative,
 * not the mechanism.
 *
 * 📌 I have now published a wrong count for this TWICE, in this same paragraph.
 * First "the control appears in five files", which came from a sweep I had piped
 * through `head -5`, so it reported the limit I passed rather than the count.
 * Then, correcting it, "the only files naming it are this one and two comments"
 * -- there are four, the fourth being tools.release-gate.test.js, added by the
 * same branch that added the other two.
 *
 * ⇒ The enumeration is gone rather than corrected a third time. A count of
 * incidental prose mentions was never the claim worth making, it changes every
 * time anyone writes a sentence about this file, and I kept getting it wrong
 * BECAUSE it was decoration rather than the measurement. The claim that matters
 * is zero callers, it has a working control, and it is stable.
 *
 * ⭐ WIRING IT IN IS THE REAL CURE FOR THE STAMP-DRIFT CLASS and is worth its own
 * card: a machine reading the clock AT the moment of publication has an offset of
 * zero by construction, so the +/-20 window stops being something an operator has
 * to predict. That is also the guard's own stated intent: the check is made
 * against `date` at the moment of release, which is the one thing an estimate
 * cannot agree with by accident. It is deliberately NOT done
 * inside #1463, which only moves an existing check: this one changes what the
 * release script writes to a published page.
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
const stamped = entry.replace('TIMESTAMP', when);

/* Above the newest entry, and above its comment if it has one: the comment
   belongs to the entry below it, so inserting between them would orphan it. */
const anchor = html.search(/ {4}<article class="rel" id="v[0-9-]+"/);
if (anchor < 0) { console.error('no existing entry found to insert above'); process.exit(1); }
const commentAt = html.lastIndexOf('    <!--', anchor);
const at = (commentAt > 0 && anchor - commentAt < 2000) ? commentAt : anchor;

fs.writeFileSync(page, html.slice(0, at) + stamped + '\n' + html.slice(at));
console.log(`   inserted ${id}, stamped ${when}`);
