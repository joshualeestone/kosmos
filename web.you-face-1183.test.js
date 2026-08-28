'use strict';
/**
 * kosmos#1183. Josh, 2026-08-27: the person's default picture was the literal
 * word "You", sitting beside a name field that already said Josh.
 *
 * "It shows up here, and then it shows up on the consolidated view. It shows up
 * in all of the dialogue boxes and putting 'You' in it doesn't make sense."
 *
 * ⚠️ THE RULING ABOVE `#you-face` STILL BINDS: "A PICTURE AND NOTHING ELSE. A
 * picture plus a name and a role would turn 'You' into a named participant on
 * four screens and edge toward looking like an account, which the welcome screen
 * promises there is not." That forbids a name and role BESIDE the face. It
 * explicitly sanctions a picture, and an initial is the picture. So this suite
 * also pins that `#rail-me-name` is untouched.
 *
 *   node --test web.you-face-1183.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

test('every surface that draws the person takes it from one function', () => {
  /* 🛑 THIS IS THE REAL GUARD. paintRailMe already drew the initial while
     Settings and the org hub still said "You", which is how Josh found two of
     three wrong. This file names that failure itself, 12,000 lines up, about the
     file picker: "three surfaces, one job, and the ones nobody was editing
     stayed behind." Pinning the OUTPUT of one site would not have caught it. */
  const calls = PAGE.match(/youFaceHtml\(\)/g) || [];
  assert.ok(calls.length >= 4,
    `expected the helper defined once and called at all three surfaces, saw ${calls.length}`);

  /* No surface may rebuild the picture-or-word decision for itself. */
  const inlined = PAGE.match(/YOU_PIC \? '<img src="' \+ youPicUrl\(\)/g) || [];
  assert.deepEqual(inlined, [],
    'a surface is deciding this on its own again instead of calling youFaceHtml()');
});

test('the person is drawn dark, so they are not mistaken for an agent', () => {
  const rule = PAGE.match(/\.youtint\s*\{[^}]*\}/);
  assert.ok(rule, '.youtint must exist');
  assert.match(rule[0], /background:\s*#[0-9a-f]{6}/i,
    'a literal colour, because agent disc tints are literals and stay pale in both themes');
  assert.doesNotMatch(rule[0], /background:\s*var\(/,
    'a token would invert in dark mode and land the person on the same pale ground as the agents');
});

test('the name label is left alone, per the ruling', () => {
  assert.match(PAGE, /id="rail-me-name">You</,
    'the ruling forbids a name beside the face; only the FACE changed');
});

test('CONTROL: these assertions can fail', () => {
  const brokenDrift = "face.innerHTML = YOU_PIC ? '<img src=\"' + youPicUrl() + '\" alt=\"\">' : 'You';";
  assert.ok(/YOU_PIC \? '<img src="' \+ youPicUrl\(\)/.test(brokenDrift),
    'the inlined-decision pattern must match the shape it is meant to catch');
  const tokenRule = '.youtint { background: var(--k-ink); }';
  assert.match(tokenRule, /background:\s*var\(/,
    'the token check must recognise a token when it sees one');
});
