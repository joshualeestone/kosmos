'use strict';

/**
 * #4418 (Josh, 2026-09-28): the gold unread edge (#3743) is OFF everywhere for now. unreadEdgeApply is the one
 * place a bubble is marked data-unread (which is all the edge's CSS draws on), so this runs the real function
 * against a thread whose newest agent message is unread, and asserts nothing is marked.
 * CONTROL: the same function with the switch on marks that message, so the fixture really would draw the edge.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

function run(on) {
  const marked = [];
  const bubble = (id) => ({ attrs: new Set(), isConnected: true,
    hasAttribute(a) { return this.attrs.has(a); }, setAttribute(a) { this.attrs.add(a); marked.push(id); }, removeAttribute(a) { this.attrs.delete(a); } });
  const row = (id) => { const bd = bubble(id); return { dataset: { mid: id }, textContent: 'words', querySelector: () => bd }; };
  const rows = [row('m1'), row('m2')];
  const root = { querySelectorAll: () => rows };
  const src = page.liftConst(SCRIPT, 'UNREAD_EDGE_ON').replace(/= false;/, '= ' + on + ';') + '\n'
    + 'const UNREAD_EDGE = new Map(); let UNREAD_IO = null; const UNREAD_WATCHED = new Set();\n'
    + page.lift(SCRIPT, 'unreadEdgeBacklog') + '\n' + page.lift(SCRIPT, 'unreadEdgeApply') + '\n'
    + 'return { unreadEdgeBacklog, unreadEdgeApply };';
  const f = new Function('unreadEdgeWatch', src)(() => {});
  f.unreadEdgeBacklog('dm:ada', 1);   // the thread opened with one unread message: the newest
  f.unreadEdgeApply(root, 'dm:ada');
  return marked;
}

test('#4418: the page ships with the unread edge switched off', () => {
  assert.match(SCRIPT, /const UNREAD_EDGE_ON = false;/);
});

test('#4418: an unread agent message is NOT marked, so no gold edge is drawn anywhere', () => {
  assert.deepEqual(run(false), []);
});

test('#4418 CONTROL: with the switch on, the same unread message would be marked', () => {
  assert.deepEqual(run(true), ['m2']);
});
