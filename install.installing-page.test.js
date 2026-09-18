"use strict";
/**
 * #867 (Josh, 2026-08-25 15:09 and 15:20, live-testing a fresh install):
 * "Totally dead stopped on this screen... Is it possible to put a progress
 * bar on this along with the animated K", and then, once the cause (a
 * shared-port collision with another macOS account's Kosmos) was in view:
 * "we should put a link to go ahead and open Kosmos."
 *
 * install/pkg-scripts/installing.html is the page opened while the .pkg
 * installer runs (install/pkg-scripts/postinstall templates __KOSMOS_PORT__
 * into it and opens it via a LaunchAgent). It had a spinner for the
 * ordinary wait, but its "taken" branch (something already answering on
 * the very first poll) hid every visual and left static text -- correct
 * about the cause, dead-looking regardless.
 *
 *   node --test install.installing-page.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const HTML = fs.readFileSync(path.join(__dirname, 'install', 'pkg-scripts', 'installing.html'), 'utf8');
const { codeOnly } = require('./test-support/code-only');
const CODE = codeOnly(HTML);

test('the mark is the real K loader canvas, and the progress bar exists, both always in the markup', () => {
  // #892/#893 shipped a static badge; #905 (Josh, 2026-08-26, seeing it
  // live: "let's put our animated K that turns into a circle there")
  // replaced it with the same 155-dot canvas loader the create-an-agent
  // screen uses. Same dimensions, so the badge reads as one identity.
  assert.match(HTML, /<canvas class="mark" id="mark" width="132" height="154" aria-hidden="true"><\/canvas>/, 'the K loader canvas is gone');
  assert.match(HTML, /<div class="bar" id="bar" role="progressbar" aria-label="Installing" aria-valuemin="0" aria-valuemax="100"><i><\/i><\/div>/, 'the progress bar is gone');
  // Neither carries its own display:none the way #late/#taken do -- they
  // are meant to be visible from the very first paint.
  assert.doesNotMatch(HTML, /\.mark\s*{[^}]*display:\s*none/, 'the mark starts hidden');
  assert.doesNotMatch(HTML, /#bar\s*{[^}]*display:\s*none/, 'the bar starts hidden');
  // The ported loader itself: pinned by name and by its two distinctive
  // data arrays, not by re-checking its internal math line for line here
  // (that risk belongs to the source file's own tests).
  assert.match(HTML, /function startKLoader\(cv\) \{/, 'the ported K loader function is gone');
  assert.match(HTML, /var K_LOAD = \[/, 'the K loader lost its dot data');
  assert.match(HTML, /var CHECK_LOAD = \[/, 'the loader lost the finish/tick data it keeps for fidelity with the source');
});

test('settling stops the K loader where it sits, and freezes the bar in place, instead of hiding either', () => {
  assert.match(HTML, /function settle\(\)\{/, 'the settle() function is gone');
  const at = HTML.indexOf('function settle(){');
  const fn = HTML.slice(at, HTML.indexOf('}', at) + 1);
  assert.match(fn, /loader\.stop\(\)/, 'settle() no longer stops the K loader');
  assert.match(fn, /bar.*classList\.add\("settled"\)/, 'settle() no longer freezes the bar');
  assert.doesNotMatch(fn, /display\s*=\s*"none"/, 'settle() hides an element instead of freezing it in place');
  // Called on BOTH conclusions: the taken branch, and the real ready-to-open path.
  const onload = HTML.slice(HTML.indexOf('img.onload = function(){'), HTML.indexOf('img.onerror'));
  assert.equal((onload.match(/settle\(\);/g) || []).length, 2, 'settle() is not called on both the taken branch and the ready branch');
});

test('the loader never finishes into a checkmark on either ending -- neither is the pack\'s "clean finish"', () => {
  // The taken branch found someone else's board (not success); the real ready
  // branch (#2073) hides the shape and says Kosmos is opening in its app, then
  // stops -- it no longer redirects, so a 900ms tick animation is not the point.
  // finish() stays unused either way.
  assert.doesNotMatch(HTML, /loader\.finish\(\)/, 'something now calls finish() -- confirm that ending is a genuine clean success before keeping this');
  assert.match(HTML, /stop: function \(\) \{ stopped = 1; \}/, 'the stop() capability this file adds on top of the ported source is gone');
});

test('#2363: the taken branch offers NO browser link, and never points anything at the board', () => {
  // #2073 made Kosmos app-only (no browser surface). The old taken-branch "Open it
  // anyway" link was then vestigial -- a click landed cookie-less on a 403/empty
  // board, or on the FOREIGN board the copy itself calls "often THEIRS, not yours".
  // #2363 removed it: the branch points at the app (Applications), not a dead URL.
  // 🔑 THE RULE, NOT A SPELLING: the taken div must carry NO anchor at all. Pinning
  // the exact old strings (below) documents what was removed, but a re-add in a NEW
  // shape (a different id/text, a static href) would slip past those; the taken div
  // is a small, fixed markup block that legitimately needs zero <a> tags, so guard
  // the class (no browser link) rather than only the instance.
  const takenDiv = HTML.slice(HTML.indexOf('<div id="taken">'), HTML.indexOf('</div>', HTML.indexOf('<div id="taken">')) + 6);
  assert.doesNotMatch(takenDiv, /<a\b/i, 'the taken branch carries an anchor tag -- under #2073 (app-only) it must offer NO browser link, in ANY shape');   // /i: an uppercase <A ...> re-add must not false-pass (the fleet's most-repeated false-zero)
  // The exact prior-shipped shape, pinned so a straight revert is caught by name too:
  assert.doesNotMatch(HTML, /Open it anyway/, 'the vestigial "Open it anyway" browser link is back on the taken branch (#2073 app-only: it must not offer a board link)');
  assert.doesNotMatch(HTML, /id="go"/, 'the #go link element is back -- the taken branch must not carry a browser board link under #2073');
  assert.doesNotMatch(HTML, /getElementById\("go"\)\.href = base \+ "\/"/, 'the taken branch points a link at the bare board address again (removed by #2363)');
  // The app IS the dashboard now: with the browser link gone, the taken branch's
  // pointer to the user's own Kosmos (the muted "in Applications" line) must remain.
  assert.match(HTML, /Your own copy of Kosmos is in Applications/, 'the taken branch no longer points the user at their own Kosmos app');
  // The refusal to auto-navigate is the standing safety property and must survive:
  // this page never sends anyone onto a board on its own.
  const takenBranch = HTML.slice(HTML.indexOf('if (first) {'), HTML.indexOf('return;\n      }\n      settle();'));
  assert.doesNotMatch(takenBranch, /location\.replace/, 'the taken branch navigates on its own -- this page must never send anyone onto a board');
});

test('the taken branch is honest that the board answering is often someone else\'s, not a rare exception', () => {
  // Angel's finding: install/kosmos's healthy() checks "is *a* Kosmos", not
  // "is MINE", so on a shared Mac this branch is the ORDINARY outcome for a
  // second macOS account, not an astronomically unlikely one. The copy must
  // say so instead of implying the link safely opens the reader's own board.
  assert.match(HTML, /often THEIRS, not yours/, 'the taken branch no longer names the common shared-Mac case');
  assert.doesNotMatch(HTML, /Open Kosmos</, 'the link still claims ownership it cannot verify');
  assert.match(HTML, /If it is not yours, close it without changing anything/, 'the safe-backout guidance for a wrong guess is gone');
  assert.match(HTML, /Your own copy of Kosmos is in Applications/, 'the Applications pointer for a wrong guess is gone');
});

test('the taken branch clears the ordinary-wait steps line so it stops contradicting the taken copy', () => {
  // Pigeon Pete, screenshotting 0.5.33/0.5.34: #steps still read "Setting
  // up. This usually takes a minute or two." directly above "Something is
  // already running" -- one sentence promising an install, the other
  // saying it never was one. #hint was already cleared on this branch;
  // #steps was not.
  const takenBranch = HTML.slice(HTML.indexOf('if (first) {'), HTML.indexOf('return;\n      }\n      settle();'));
  assert.match(takenBranch, /getElementById\("steps"\)\.textContent = ""/, 'the taken branch no longer clears the ordinary-wait steps line');
});

test('the ordinary wait keeps its own copy: unreadable time, then a slow-download note', () => {
  assert.match(HTML, /Setting up\. Usually a minute or two\./);
  assert.match(HTML, /Still going\. A slow one can take a few minutes/);
  assert.match(HTML, /if \(s >= 45\) document\.getElementById\("steps"\)\.textContent = "Setting up\. " \+ s \+ " seconds so far\."/);
  assert.match(HTML, /if \(s >= 180\) show\("late"\)/);
});

/**
 * #920. Josh, mid-install: "Do we know when or how much of it has been
 * installed?" The page could not answer, and the sentence that comes closest
 * already existed one element down, hidden behind a 180-second timer.
 */
test('the shape of the wait is said at the start, not only once it feels broken', () => {
  assert.match(HTML, /<p class="muted" id="shape">Most of the wait is one large download/,
    'the description of the wait is gone from the first screen');
  // ⚠️ AND IT IS NOT IN #steps. That element is STATE and is overwritten three
  // times at runtime; the elapsed counter at 45s would destroy the description
  // at exactly the moment somebody starts wondering whether it is stuck.
  const stepsLine = HTML.match(/<p id="steps">[^<]*<\/p>/);
  assert.ok(stepsLine, '#steps is gone');
  assert.doesNotMatch(stepsLine[0], /large download|Applications folder/,
    'the description is back inside the state element, where the 45s counter eats it');
});

test('both endings hide the description, because the wait is over or never happened', () => {
  // A removal is two changes once a sentence is split in two: #steps was
  // already cleared on the taken branch, and the description promises the same
  // install that branch says was never running.
  const takenBranch = HTML.slice(HTML.indexOf('if (first) {'), HTML.indexOf('return;\n      }\n      settle();'));
  assert.match(takenBranch, /getElementById\("shape"\)\.style\.display = "none"/,
    'the taken branch shows a description of an install that was not happening');
  /* ⚠️ ANCHORED ON THE STATEMENT, NOT THE PROSE (a comment explaining a string
     contains that string). #2073: app-only. The success branch text changed and,
     crucially, the branch must NO LONGER redirect the browser onto the board --
     that self-redirect was the second browser dashboard Josh's ruling removes. */
  const okAt = HTML.indexOf('textContent = "Kosmos is opening in its own app. You can close this page."');
  assert.notEqual(okAt, -1, 'the success branch sets the app-only ready line');
  const okBranch = HTML.slice(okAt, HTML.indexOf('};', okAt));
  assert.match(okBranch, /getElementById\("shape"\)\.style\.display = "none"/,
    'the success branch still describes a wait that has ended');
  assert.doesNotMatch(okBranch, /location\.replace/,
    '#2073: the success branch must NOT redirect the browser onto the board (app-only, no browser surface)');
});

test('no size in megabytes, because that number rots and nobody re-measures it', () => {
  /* 🛑 THE ONE THING NOT TO "IMPROVE" HERE. The payload was 50 MB when this
     shipped, measured against the served dist, and it grows with every release.
     A figure baked into an install page reads as a promise and would be quietly
     wrong within weeks. The SHAPE of the wait does not rot; the figure does. */
  const visible = HTML.replace(/<!--[\s\S]*?-->/g, ' ');
  assert.doesNotMatch(visible, /\b\d+\s?(MB|GB|megabytes|gigabytes)\b/i,
    'a download size was added to the install page, and it will be wrong within weeks');
});

test('the late note does not repeat what the first screen already said', () => {
  // Josh cuts what the next line already says. The download fact moved up, so
  // #late keeps only what is new once it HAS been slow.
  const late = HTML.match(/<p id="late">[^<]*<\/p>/);
  assert.ok(late, '#late is gone');
  assert.doesNotMatch(late[0], /slow download/, '#late repeats the download fact now living in #shape');
  assert.match(late[0], /installer window will say if something went wrong/, '#late lost the part that is actually new');
});

test('reduced motion turns off both animations, and dark mode is accounted for', () => {
  // The bar's spinner is still CSS, so it still turns off in CSS. The K
  // loader's motion is entirely canvas/JS now (startKLoader reads
  // prefers-reduced-motion itself and draws one still frame instead of
  // animating), so there is nothing left for a CSS rule to disable on
  // .mark -- pinned in the loader's own `slow` branch instead.
  // kosmos#3233 a11y: the determinate bar adds a width transition, so the
  // reduced-motion rule must disable transition too, not only the swoosh animation.
  // The override must name BOTH .bar>i (the swoosh animation) AND .bar.determinate>i (the
  // width transition): the determinate rule is more specific, and media queries add no
  // specificity, so a bare .bar>i override never reaches the determinate transition.
  // KNOWN TEST-QUALITY GAP (string check): this asserts the rule TEXT, not the runtime
  // cascade. It cannot catch a future <style> reorder, or a new equal/higher-specificity
  // rule inserted after this one, that would silently break the override again -- catching
  // that needs a jsdom/computed-style check, which this string-extraction test file does not run.
  assert.match(HTML, /@media \(prefers-reduced-motion:reduce\)\{\.bar>i,\.bar\.determinate>i\{animation:none;transition:none\}\}/);
  assert.match(HTML, /var slow = window\.matchMedia && window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches;/,
    'the K loader stopped reading reduced-motion itself');
  assert.match(HTML, /if \(slow\) \{/, 'the loader lost its reduced-motion branch (one still frame instead of animating)');
  assert.match(HTML, /@media \(prefers-color-scheme:dark\)/);
});

/**
 * 🛑 ITEM 4, AND IT WAS LEFT UNGUARDED BY ME FOR A REASON THAT WAS HALF WRONG.
 * Josh, 2026-08-26 22:05: delete the sentence "Nothing to do." from the install
 * screen. Done -- in THIS file, not in web/index.html.
 *
 * When I pinned his other rulings (#1081) I recorded item 4 as unguardable and
 * moved on, because tools/check-served.js extracts only app/web/index.html and
 * app/bin/kosmos-app from the tarball, so the .pkg installer's own page is
 * outside the served population entirely. That part is true and still is.
 *
 * ⚠️ THE MISTAKE WAS TREATING "CANNOT BE GUARDED IN THE SERVED BYTES" AS
 * "CANNOT BE GUARDED AT ALL". Merge-time is a different population and this
 * file already reads the page. One layer being blind is not both layers being
 * blind, and writing the limitation down made it feel handled.
 *
 * 📌 NEGATIVE CONTROL, and it needed a second look. `git log -S "Nothing to do."`
 * on this path reports only the commit that ADDED it (bd96c65f, 2026-08-24) and
 * no removal -- because the deletion moved the string from the <p> into the
 * comment that explains the deletion, so the occurrence COUNT never changed and
 * the pickaxe saw nothing. The real control is the two-sided one below: present
 * in the raw file, absent once comments are stripped.
 */
test('item 4 -- "Nothing to do." stays deleted, and only that sentence went', () => {
  assert.ok(!CODE.includes('Nothing to do.'),
    'item 4 is back on the install screen. It is deleted from the page and quoted in the comment above #hint; if this fails, the sentence returned to the markup');

  /* ⚠️ HE DELETED ONE SENTENCE, NOT THE LINE. The rest is the only copy that
     tells a person what this page BECOMES, which is the reason to leave it
     open. A guard on the deletion alone would be satisfied by removing the
     whole paragraph, which is a different and worse change. */
  assert.match(CODE, /This page shows install progress\. Kosmos opens in its own app when it is ready\./,
    'the surviving half of the hint line went with the deleted sentence; item 4 removed one sentence, not the paragraph (#2073 reworded the hint for app-only, but the paragraph must still exist)');

  /* And the node itself has to stay: the finish path hides #hint by id, so
     deleting the element turns that into a null dereference on the happy
     path -- the one path nobody re-tests. */
  assert.match(CODE, /id="hint"/,
    'the #hint element is gone; the finish path hides it by id and would null-deref');
});

/**
 * kosmos#3233 (the open half of #920): the "Setting up" page showed an
 * indeterminate swoosh for the whole ~50MB bundle download, so a slow download
 * looked identical to a stalled one. setup.sh now emits live bytes/total to
 * install-progress.js (window.__kosmosInstallProgress); this page RE-INCLUDES
 * that file (a file:// page cannot fetch) and drives the bar determinately when
 * a total is known -- the SHAPE of the wait, with NO megabytes figure (#920's
 * stance, already guarded by the "no size in megabytes" test above, which runs
 * against the whole page and so also covers this addition).
 *
 * These assertions run against CODE (comments stripped) so the wiring cannot be
 * satisfied by the explanatory prose that names the same tokens.
 */
test('#3233: a determinate bar style exists and stops the indeterminate swoosh', () => {
  assert.match(CODE, /\.bar\.determinate>i\{[^}]*animation:none/,
    'the determinate bar rule (which stops the swoosh) is gone');
  assert.match(CODE, /\.bar\.determinate>i\{[^}]*width:0/,
    'the determinate bar no longer starts empty before the first progress reading');
});

test('#3233 a11y: aria-valuenow is exposed determinately and stays absent while indeterminate', () => {
  // Bounds live in static markup; the live value is set in JS only inside the known-total
  // (determinate) branch, and mirrored to 100 at settle ONLY if the bar went determinate.
  assert.match(HTML, /aria-valuemin="0" aria-valuemax="100"/,
    'the progressbar lost its aria-valuemin/max bounds');
  assert.match(CODE, /setAttribute\("aria-valuenow", String\(Math\.floor\(pct\)\)\)/,
    'the determinate branch no longer sets aria-valuenow (floor, so AT never overstates progress)');
  // The settle=100 must be GATED on the bar having gone determinate, or the taken branch
  // (a foreign board answered first, nothing installed) would announce "100%" to a screen reader.
  assert.match(CODE, /if \(kpDeterminate\) barEl\.setAttribute\("aria-valuenow", "100"\)/,
    'settle() no longer gates the 100 mirror on kpDeterminate -- it would falsely announce 100% on the taken branch');
  // Indeterminate must stay indeterminate: the pct set lives inside the total>0 branch, and
  // nothing sets a static aria-valuenow that would make the swoosh falsely determinate.
  const applyAt = CODE.indexOf('function apply(');
  const pollAt = CODE.indexOf('function poll(');
  assert.ok(applyAt > -1 && pollAt > applyAt, 'apply()/poll() structure changed -- re-check the aria gating');
  const applyBody = CODE.slice(applyAt, pollAt);
  const totalAt = applyBody.indexOf('p.total');
  const ariaAt = applyBody.indexOf('aria-valuenow", String(Math.floor(pct))');
  assert.ok(totalAt > -1 && ariaAt > totalAt,
    'aria-valuenow(pct) must sit inside the known-total branch, so no-total (swoosh) stays indeterminate');
  assert.doesNotMatch(CODE, /aria-valuenow",\s*"0"/,
    'a static aria-valuenow="0" would make the indeterminate swoosh falsely announce 0% progress');
  // NaN-safe clamp: typeof NaN === "number" slips past the branch guard, and NaN fails every
  // comparison, so a malformed byte count must be forced to 0 rather than written as "NaN".
  assert.match(CODE, /if \(!\(pct >= 0\)\) pct = 0/,
    'the NaN-safe clamp is gone -- a malformed byte count could write aria-valuenow="NaN"');
});

test('#3233: the page re-includes install-progress.js cache-busted, because a file:// page cannot fetch', () => {
  assert.match(CODE, /install-progress\.js\?t=" \+ Date\.now\(\)/,
    'the cache-busted install-progress.js re-include is gone -- the bar can never read new bytes');
  assert.doesNotMatch(CODE, /fetch\(\s*["']install-progress\.js/,
    'a fetch() of install-progress.js crept in -- a file:// page cannot fetch, so the bar would never update');
});

test('#3233: the bar goes determinate only on a known positive total, and the percentage is clamped', () => {
  const at = CODE.indexOf('function apply(');
  assert.notEqual(at, -1, 'the progress apply() function is gone');
  const fn = CODE.slice(at, CODE.indexOf('function poll(', at));
  assert.match(fn, /typeof p\.total === "number" && p\.total > 0 && typeof p\.bytes === "number"/,
    'apply() no longer requires a known positive total before driving the bar (a null/0 total must keep the swoosh)');
  // NaN-safe lower clamp (`!(pct >= 0)` also catches NaN, unlike `pct < 0`), so a malformed
  // byte count is forced to 0 rather than written as aria-valuenow="NaN".
  assert.match(fn, /if \(!\(pct >= 0\)\) pct = 0/, 'the lower clamp on the percentage is gone');
  assert.match(fn, /if \(pct > 100\) pct = 100/, 'the upper clamp on the percentage is gone');
  assert.match(fn, /classList\.add\("determinate"\)/, 'apply() no longer switches the bar to determinate');
});

test('#3233: settling stops the poll and clears the inline width so .settled wins', () => {
  // settle() adds .settled (width:100%); an inline fillEl.style.width left by
  // apply() would override that by specificity, so __kpStop() must clear it.
  const settleAt = CODE.indexOf('function settle(){');
  const settleFn = CODE.slice(settleAt, CODE.indexOf('}', settleAt) + 1);
  assert.match(settleFn, /__kpStop\(\)/, 'settle() no longer stops the #3233 progress poll');
  const stopAt = CODE.indexOf('__kpStop = function');
  assert.notEqual(stopAt, -1, 'the __kpStop teardown is gone');
  const stopFn = CODE.slice(stopAt, CODE.indexOf('};', stopAt));
  assert.match(stopFn, /fillEl\.style\.width = ""/,
    "__kpStop() no longer clears the inline width, so a stale inline width could override .settled's 100%");
  assert.match(stopFn, /classList\.remove\("determinate"\)/, '__kpStop() no longer drops the determinate class');
});

test('#3233: each poll removes the script node it injected, so the DOM does not accumulate one per second', () => {
  const at = CODE.indexOf('function poll(');
  assert.notEqual(at, -1, 'the progress poll() function is gone');
  const fn = CODE.slice(at, CODE.indexOf('poll();', at));
  assert.equal((fn.match(/s\.parentNode\.removeChild\(s\)/g) || []).length, 2,
    'the injected progress <script> is not removed on both onload and onerror -- it would accumulate one node per second');
});
