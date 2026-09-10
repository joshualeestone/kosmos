'use strict';
/**
 * #2620: the first-run S3 mock permission switches are HONEST and CLICKABLE, pinned at the
 * NODE level (the fast gate) so a regression is caught without the slow Playwright check.
 * The browser-check render-permission-slider-2620.js covers the live rendered behavior;
 * this pins the SOURCE facts -- the repo's dual-coverage convention for every S3 gate
 * feature. Checks run over codeOnly() so a comment mentioning an id cannot satisfy them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { codeOnly } = require('./test-support/code-only');
const { scriptOf } = require('./test-support/page');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const CODE = codeOnly(RAW);
const SCRIPT = codeOnly(scriptOf(RAW));

test('#2620: each mock is wrapped and carries a real overlay open-button with a target-naming aria-label', () => {
  assert.match(CODE, /class="s3-sw" data-sw-gate="sleep"/, 'the Energy mock switch is tagged data-sw-gate="sleep"');
  assert.match(CODE, /class="s3-sw" data-sw-gate="tmux"/, 'the Accessibility mock switch is tagged data-sw-gate="tmux"');
  assert.match(CODE, /<button class="s3-sw-open" type="button" data-sw-gate="sleep" aria-label="Open Energy settings">/,
    'the sleep overlay is a real <button> naming Energy settings');
  assert.match(CODE, /<button class="s3-sw-open" type="button" data-sw-gate="tmux" aria-label="Open Accessibility settings for Kosmos">/,
    'the tmux overlay is a real <button> naming Accessibility settings');
  assert.match(CODE, /class="s3-mock"/, 'each mock is wrapped in .s3-mock (position:relative, so the overlay can sit over it)');
});

test('#2620: the switch CSS mirrors the gate (gray default, blue when granted) and never re-hardcodes On', () => {
  // base rule gray, knob left -- NOT the old hardcoded blue. `.s3-sw{` excludes the
  // `.s3-sw[data-granted]{` rule, so the doesNotMatch only guards the BASE.
  assert.match(CODE, /\.s3-sw\{[^}]*background:#e2e2e5/, 'the switch defaults to gray #e2e2e5');
  assert.doesNotMatch(CODE, /\.s3-sw\{[^}]*background:#2f7bf6/, 'the base switch must NOT be hardcoded blue (the #2620 defect it fixes)');
  assert.match(CODE, /\.s3-sw\[data-granted\]\{background:#2f7bf6\}/, 'granted -> on-brand blue #2f7bf6');
  assert.match(CODE, /\.s3-sw\[data-granted\]::after\{transform:translateX\(16px\)\}/, 'granted -> the knob slides right');
});

test('#2620: the swipe hint runs only when not-granted/not-battonly, paired + reduced-motion-safe', () => {
  assert.match(CODE, /@keyframes s3-sw-hint-bg\{/, 'the background hint keyframes exist');
  assert.match(CODE, /@keyframes s3-sw-hint-knob\{/, 'the knob hint keyframes exist (paired with the bg timeline)');
  assert.match(CODE, /\.s3-sw:not\(\[data-granted\]\):not\(\[data-battonly\]\)\{animation:s3-sw-hint-bg/,
    'the hint is gated to not-granted AND not-battonly (no hint on a granted switch or a battonly row)');
  assert.match(CODE, /@media \(prefers-reduced-motion: reduce\)\{[\s\S]{0,80}animation:none/,
    'prefers-reduced-motion stops the hint');
});

test('#2620: the decoy invariant holds -- .s3-win stays pointer-events:none (0.6.41)', () => {
  assert.match(CODE, /\.s3-win\{[^}]*pointer-events:none/,
    'the mock window stays inert, so the decoy switch is never the wrong click (the real click is the overlay)');
});

test('#2620: the gate state is mirrored onto the switch, and the open-map is shared (no drift)', () => {
  assert.match(SCRIPT, /s3-sw\[data-sw-gate="/, 'the JS addresses the paired mock switch by data-sw-gate');
  assert.match(SCRIPT, /\['data-granted', 'data-checking', 'data-battonly'\]/,
    'frPollGates mirrors all three state attrs onto the switch');
  assert.match(SCRIPT, /function frSyncSwitchOverlays\(\)/, 'frSyncSwitchOverlays measures + positions the overlays');
  // one definition + two call sites (the .s3-sw-open branch and the .s3-on branch), so the
  // open-target map is shared and cannot drift between them (#2620 iter-1 finding).
  const refs = (SCRIPT.match(/s3PermissionTargets/g) || []).length;
  assert.ok(refs >= 3, `s3PermissionTargets is defined once and called by both handlers (found ${refs} references, expected >= 3)`);
});
