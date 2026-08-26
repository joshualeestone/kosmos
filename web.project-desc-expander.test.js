'use strict';

/**
 * kosmos#1005 (Josh, 2026-08-26): the project description sits behind a
 * disclosure on the title, closed on arrival, instead of three lines of body
 * copy above every project's conversation.
 *
 * ⚠️ WHAT THESE PINS CANNOT DO, stated rather than implied: they are text
 * matches, and a text match cannot tell "the rule is written" from "the rule
 * takes effect" -- the exact gap that let a dead `grid-template-rows` ship
 * green earlier today. The toggle was therefore DRIVEN in a real browser
 * engine (headless Chrome, the shipped CSS/markup/JS lifted out of this file,
 * clicked twice) with a positive control that removed the hide rule and
 * confirmed the check went red:
 *
 *   CLOSED   expanded=false descDisplay=none  titleOverflow=ellipsis arrow=false
 *   OPENED   expanded=true  descDisplay=block titleOverflow=clip     arrow=true
 *   RECLOSED expanded=false descDisplay=none  titleOverflow=ellipsis arrow=false
 *
 * These pins guard that result from being reverted silently; they did not
 * produce it.
 *
 *   node --test web.project-desc-expander.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('the disclosure is a button with a state, not a styled glyph', () => {
  assert.match(PAGE, /<button class="pjdisc" id="pj-one-more" type="button" aria-expanded="false" aria-controls="pj-one-desc">/,
    'the expander is no longer a button carrying aria-expanded/aria-controls, so it is not announced as openable');
  assert.match(PAGE, /<span class="pjdisc-ar" aria-hidden="true">/,
    'the arrow lost aria-hidden, so a screen reader announces a decorative glyph beside the button name');
  assert.match(PAGE, /<span class="vh">Show the full title and the description<\/span>/,
    'the button lost its visually-hidden name, leaving a control announced as nothing but a triangle');
});

test('closed is the resting state, for the description AND the title', () => {
  assert.match(PAGE, /\.pjtitle:not\(\.is-open\) #pj-one-desc \{ display: none; \}/,
    'the description shows while the button says aria-expanded=false, which makes the button lie');
  assert.match(PAGE, /\.pjtitle:not\(\.is-open\) #pj-one-name \{[^}]*text-overflow: ellipsis;/,
    'the title no longer truncates when closed, so a long name reflows the head that this change exists to shorten');
});

/* Josh's complaint was the copy being there EVERY time. A remembered-open
   state, or one carried from the previously viewed project, reproduces exactly
   the thing he asked to remove -- so the reset belongs in the painter, which
   runs per project, not in the click handler.
   ⚠️ REFINED BY A BROWSER CHECK, not by argument: closed-by-default was right
   for a project WITH a description and wrong for one without, where the
   placeholder is the only thing telling you a description exists at all. So the
   resting state is keyed on the description being empty. Both arms are pinned
   below, because a rule with two arms and one test is a rule with an untested
   half. */
test('a described project opens closed; an empty one opens with its placeholder showing', () => {
  const painter = PAGE.slice(PAGE.indexOf('function paintOneProject() {'));
  const body = painter.slice(0, painter.indexOf('\nfunction '));
  assert.ok(/const isEmpty = !p\.description;/.test(body),
    'the resting state is no longer keyed on whether there is a description to hide');
  assert.ok(/classList\.toggle\('is-open', isEmpty\)/.test(body),
    'the disclosure no longer opens for an empty description, so a new project hides the only hint that descriptions exist');
  assert.ok(/setAttribute\('aria-expanded', isEmpty \? 'true' : 'false'\)/.test(body),
    'the class and the aria state disagree, so the button lies about what is on screen');
});

/* The per-project reset is a SEPARATE property from which state it resets to,
   and it is the one that stops an opened description following you to the next
   project. Pinned on its own so a change to the resting state cannot silently
   take the reset with it. */
test('the resting state is decided per project, in the painter', () => {
  const painter = PAGE.slice(PAGE.indexOf('function paintOneProject() {'));
  const body = painter.slice(0, painter.indexOf('\nfunction '));
  assert.ok(body.includes("classList.toggle('is-open'") && body.includes("aria-expanded"),
    'paintOneProject no longer sets the disclosure state, so the previous project\'s open description carries over');
});

test('the arrow respects reduced motion', () => {
  assert.match(PAGE, /@media \(prefers-reduced-motion: reduce\) \{ \.pjdisc-ar \{ transition: none; \} \}/,
    'the arrow animates for someone who asked the system for no motion');
});
