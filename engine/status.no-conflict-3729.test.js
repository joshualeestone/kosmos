'use strict';
/**
 * #3729 (Josh, 2026-09-25 07:32, testing 0.6.94): "These are still showing these status messages
 * that I do not ever want to see ... I dont even what there to be a space on these to have any
 * message like this injected."
 *
 * The engine still computes `conflict` (its record of an agent's reports and its screen
 * disagreeing), but the card it sends the board never carries it: every `stateConflict:` the
 * engine writes is null. Pinned at the source, with comments stripped so a comment that mentions
 * the old value cannot satisfy it, and with a count so a scan that found nothing cannot pass. The
 * page side (no slot, nothing rendered, Mac and Windows) is web.said-line.test.js and
 * docs/browser-checks/render-no-conflict-3729.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'status.js'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

test('#3729: every card the engine builds sends stateConflict as null', () => {
  const sites = [...CODE.matchAll(/\bstateConflict\s*:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
  assert.equal(sites.length, 2, 'expected the two card builders (panelessCard and snapshot); found ' + JSON.stringify(sites));
  for (const v of sites) assert.equal(v, 'null', 'a card builder sends the conflict sentence again: stateConflict: ' + v);
});

test('#3729 control: the engine still computes the sentences, so the zero above is a choice, not a lost feature', () => {
  assert.ok(CODE.includes("conflict: 'its screen shows a question its reports do not mention'"), 'control: the engine no longer computes this conflict');
  assert.ok(CODE.includes("conflict: 'it reported stopping, but it is still running'"), 'control: the engine no longer computes this conflict');
  assert.ok(!/stateConflict\s*:\s*status\.conflict/.test(CODE), 'status.conflict is copied onto a card again');
});
