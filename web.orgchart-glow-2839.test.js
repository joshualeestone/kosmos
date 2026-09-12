'use strict';
/**
 * #2839 (Josh, 0.6.57 live review): the org chart shows each agent's state as a
 * glow behind the node - green for working, red for needs-you - "so you can
 * really see quickly: these three agents are working, this one has an issue".
 *
 * Same state model as the cards (cardStOf): green = working, red = attn
 * (needs_you), and nothing else glows (idle/paused/stopped/unknown/restarting
 * stay quiet, the "red is rare so it lands" rule the cards follow). needsYou wins
 * where both could read, so the rare red is never hidden by working.
 *
 * Source-string guards (the org view is not renderable from this bot session);
 * they pin the wiring and the colours so a regression fails in `yarn test`.
 *
 *   node --test web.orgchart-glow-2839.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

test('the org node derives a state-glow class from the shared card-state table', () => {
  const paint = SCRIPT.slice(SCRIPT.indexOf('function paintOrg'), SCRIPT.indexOf('function orgLiveStart'));
  assert.ok(paint.length > 0, 'could not bound the paintOrg body');
  /* working is read through cardStOf, the same shared table needs-you uses, so
     the glow cannot drift from the card/list/detail state colours. */
  assert.match(paint, /const working = cardStOf\(a\)\.st === 'working';/,
    'working state is not derived from the shared cardStOf table');
  /* needsYou wins the glow (red over green), so the rare needs-you signal is
     never suppressed by a working state (#2146 precedence). */
  assert.match(paint, /const glowCls = needsYou \? ' onode-attn' : working \? ' onode-working' : '';/,
    'the glow class is not needsYou-first (attn) then working, else none');
});

test('the node button gets the glow class', () => {
  const at = SCRIPT.indexOf('nodes.push(\'<button class="onode');
  assert.ok(at > -1, 'the org node button markup moved');
  const end = SCRIPT.indexOf("</button>');", at);
  const node = SCRIPT.slice(at, end);
  assert.match(node, /class="onode' \+ glowCls \+ '"/,
    'the glow class is not appended to the onode button');
});

test('the glow CSS uses the card state colours, green for working and red for needs-you', () => {
  const working = PAGE.match(/\.onode\.onode-working \.face \{[^}]*\}/);
  const attn = PAGE.match(/\.onode\.onode-attn \.face \{[^}]*\}/);
  assert.ok(working, 'no .onode.onode-working .face glow rule');
  assert.ok(attn, 'no .onode.onode-attn .face glow rule');
  /* The SAME rgba the cards use: working green rgba(47,125,90), needs-you red
     rgba(179,38,30). A box-shadow halo (renders outside the overflow:hidden
     disc), no hard ring so it sits behind the context gauge. */
  assert.match(working[0], /box-shadow:[^}]*rgba\(47, ?125, ?90/,
    'the working glow is not the card green rgba(47,125,90)');
  assert.match(attn[0], /box-shadow:[^}]*rgba\(179, ?38, ?30/,
    'the needs-you glow is not the card red rgba(179,38,30)');
});
