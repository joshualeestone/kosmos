'use strict';
/**
 * The @ picker refreshes when an agent is renamed (#2139).
 *
 * Josh: "If I change an agent's name, it doesn't update for the @mention auto
 * complete." The picker candidates come from PROJECTS[].agents[].name
 * (mentionCandidates -> pjById(PJ_CURRENT).agents; covered by
 * web.mention-picker.test.js), and PROJECTS is populated ONLY by loadProjects()
 * reading /api/projects. The agent detail Save (#d-save) refreshed the fleet via
 * tick() but not PROJECTS, so a rename left the picker showing the old name.
 *
 * The fix adds a loadProjects() call to the #d-save success path, guarded on the
 * shown name actually changing. Only the Playwright drive exercises the live
 * picker, and that drive is not in `node --test` -- so, exactly like the
 * About-you two-answer gate pin in server.test.js, this holds the TRIGGER in
 * source: without it the loadProjects() call could be deleted and this suite
 * would stay green while the picker went stale again.
 *
 * A full browser drive would need a renamable, named, fleeted agent that is a
 * member of a project /api/projects serves (a thread-server-class fixture) --
 * disproportionate for a one-line refresh; the picker RENDER is covered by
 * web.mention-picker.test.js, and this pins the rename->refresh wiring.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* The #d-save click handler's body, bounded to itself: from its
   addEventListener to the next top-level `document.getElementById(...)
   .addEventListener` registration. Bounding to the handler (rather than a fixed
   byte window) keeps the pin honest if the handler grows, and means a
   loadProjects() call elsewhere on the page cannot satisfy it. */
function dSaveHandler() {
  const start = HTML.indexOf("document.getElementById('d-save').addEventListener('click'");
  assert.ok(start !== -1, 'the #d-save click handler left the page');
  const after = HTML.indexOf(".addEventListener(", start + 40);
  // Fall back to a generous slice only if no later registration is found.
  const end = after !== -1 ? HTML.lastIndexOf('\n', after) : start + 8000;
  return HTML.slice(start, end);
}

test('#2139: the d-save (rename) handler refreshes the projects data so the @ picker is not stale', () => {
  const fn = dSaveHandler();
  // The refresh itself: loadProjects() re-reads /api/projects, repopulating
  // PROJECTS[].agents[].name, which is what mentionCandidates shows.
  assert.match(fn, /loadProjects\(\)/,
    'the rename Save no longer refreshes the projects data, so the @ picker keeps the old name (#2139)');
  // Guarded on the shown name actually changing, so a role-only save does not
  // pay a projects round-trip. `wasCalled` is the pre-save name; `renameTo` the
  // new one. This pins that the refresh is on the rename path specifically.
  assert.match(fn, /renameTo && renameTo !== wasCalled\) loadProjects\(\)/,
    'the projects refresh is not gated on the name having changed (#2139)');
});

test('#2139 CONTROL: mentionCandidates reads the shown name from the project agents, so a refresh reaches the picker', () => {
  // If this stopped being true, refreshing PROJECTS would not fix the picker and
  // the fix above would be aimed at the wrong place. (The behaviour of
  // mentionCandidates itself is exercised in web.mention-picker.test.js; this is
  // the load-bearing link between the refresh and the picker.)
  const src = HTML.slice(HTML.indexOf('function mentionCandidates'));
  assert.match(src.slice(0, 400), /a\.name/,
    'mentionCandidates no longer reads a.name, so a projects refresh would not update the picker');
});
