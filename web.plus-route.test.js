'use strict';

/**
 * Settings > Plus offers a way to the page where sign-up happens (#1129).
 *
 * #1115 fixed the sentence and left the gap: the pane described a flow that
 * happens on the site and gave no route to it, so a person was **correctly
 * informed and still stuck**. Fixing only the wording is the half that feels
 * finished.
 *
 * 🛑 THE OBVIOUS FIX WAS REFUSED BY AN OLDER GUARD AND THE GUARD WAS RIGHT.
 * `web.plus-tab.test.js` forbids a hostname in the Plus copy, because the domain
 * is explicitly temporary: shipped copy that bakes in a provisional address
 * becomes a dead link in a build the reader cannot update. So the address
 * arrives at paint time from `KOSMOS_SITE` and the markup carries none.
 *
 * ⭐ THE MEASURE OF THIS CHANGE IS THAT THE OLD GUARD PASSES UNCHANGED. A fix
 * that had required editing it would have been the feature moving the rule to
 * suit itself, which is how a rule stops meaning anything.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page.js');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

/** The Plus settings section, the same slice the older guard bounds. */
function plusSection() {
  const at = PAGE.indexOf('id="s-sec-plus"');
  const end = PAGE.indexOf('</section>', PAGE.indexOf('id="plus-flow"'));
  assert.ok(at > 0 && end > at, 'the Plus section moved; re-anchor');
  return PAGE.slice(at, end);
}

test('CONTROL: the section is found and the hostname scan can fire', () => {
  /* Both halves matter. An absence assertion over a slice we failed to locate
     passes for the wrong reason, and a hostname scan that cannot match anything
     would make the drift test below vacuous. */
  const sec = plusSection();
  assert.ok(sec.length > 500, `implausible section slice: ${sec.length} chars`);
  const hosts = PAGE.match(/https?:\/\/[a-z0-9.-]+/gi) || [];
  assert.ok(hosts.length > 0, 'the hostname scan found nothing anywhere, so it proves nothing');
});

test('the Plus pane offers a route to the site', () => {
  const sec = plusSection();
  assert.match(sec, /id="plus-site-link"/, 'the Plus pane offers no way to the page sign-up happens on');
});

test('and the route carries no hostname in the markup, so the old guard still holds', () => {
  /* The whole reason the link is wired in JS. If this fails, the next thing to
     fail is web.plus-tab.test.js, and the tempting fix is to weaken THAT. */
  const sec = plusSection();
  assert.doesNotMatch(sec, /installkosmos\.com|https?:\/\//,
    'a hostname reached the Plus copy; the domain is temporary and this is the guard that says so');
});

test('the link is actually pointed somewhere at paint time', () => {
  /* A markup-only assertion would pass on an anchor whose href stays "#",
     which is a route to nowhere that looks exactly like a route. */
  const paint = page.lift(SCRIPT, 'paintPlus');
  assert.match(paint, /plus-site-link/, 'paintPlus never reaches for the link');
  /* #1615: the target moved from `/plus` to `/+?from=app`, per design/plus-flow.html:
     "Both entry points land on /+ ... The app links to /+?from=app". One page, one
     parameter, so the site can tell an arrival from the app apart from one off the
     homepage.
     ⚠️ THE `/+` ROUTE DOES NOT EXIST ON THE SITE YET - measured, `vercel.json` carries no
     rewrite for it and only `plus.html` is served. That half is Angel's. Pointing at the
     designed target is the instruction; keeping the old path would have hidden the
     dependency behind a link that happens to work.
     The RULE this protects is unchanged and is the reason the test exists: the href must
     be built from KOSMOS_SITE and must not stay "#", a route to nowhere that looks
     exactly like a route. */
  assert.match(paint, /KOSMOS_SITE \+ '\/\+\?from=app'/,
    'the link is not pointed at the designed Plus entry point');
  assert.doesNotMatch(paint, /site\.href = '#'/, 'the link was left pointing at nothing');
});

test('KOSMOS_SITE is the ONLY site address in the page: no literal disagrees with it', () => {
  /* The "one place" claim, verified rather than asserted in a comment. A second
     spelling of the host is the exact failure a constant is supposed to prevent,
     and it would otherwise be invisible until the domain changed. */
  const decl = page.liftConst(SCRIPT, 'KOSMOS_SITE');
  const m = decl.match(/'([^']+)'/);
  assert.ok(m, `could not read the value out of: ${decl}`);
  const site = m[1];

  const hosts = [...PAGE.matchAll(/https?:\/\/(installkosmos[a-z0-9.-]*|kosmos[a-z0-9.-]*\.[a-z]+)/gi)]
    .map((h) => h[0].toLowerCase());
  const wrong = [...new Set(hosts.filter((h) => h !== site.toLowerCase()))];
  assert.deepEqual(wrong, [], `these disagree with KOSMOS_SITE (${site}):\n  ` + wrong.join('\n  '));
});
