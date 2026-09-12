'use strict';

/**
 * 🛑 EVERY STALENESS VERDICT THAT REACHES A PERSON GOES THROUGH `toldOverride`.
 *
 * #1228. Three call sites of `instructions.staleness` existed; two wrapped it and
 * one did not, so for the same agent at the same moment the member row could say
 * `stale` while the detail panel said `told`. A fourth was found while fixing it:
 * the `/api/agent/<name>/instructions` route served `instructions.read`'s RAW
 * verdict, which made `renderStale`'s `told` branch unreachable from its own data
 * source. Only `toldOverride` produces `told`.
 *
 * ⚠️ THREE CORRECT CALL SITES DO NOT PROTECT THE FOURTH, WHICH IS THE WHOLE
 * REASON THIS FILE EXISTS. The defect was not that somebody wrote the wrong
 * thing; it was that writing the wrong thing looked exactly like writing the
 * right one, and nothing failed. This asserts the SHAPE rather than the count, so
 * a new caller has to be deliberate rather than merely plausible.
 *
 * 📌 It reads source, not behaviour, because that is the only instrument that
 * reaches a caller nobody has written yet.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const FILES = ['server.js', nodePath.join('engine', 'projects.js')];

test('#1228: every instructions.staleness() call is wrapped in toldOverride', () => {
  const unwrapped = [];
  let seen = 0;
  for (const rel of FILES) {
    const src = fs.readFileSync(nodePath.join(__dirname, rel), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      // the call itself, not a comment ABOUT it
      if (!/(?:instructions\.)?staleness\(/.test(line)) return;
      if (/^\s*(\*|\/\/)/.test(line)) return;
      if (!/instructions\.staleness\(/.test(line)) return;
      seen++;
      /* Wrapped either on the same line, or by a `toldOverride(` opened on one of
         the two lines above -- which is how a long call reads once it is split. */
      const window = [lines[i - 2], lines[i - 1], line].filter(Boolean).join(' ');
      if (!/toldOverride\s*\(/.test(window)) unwrapped.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  assert.ok(seen >= 3, `found only ${seen} staleness call sites, so this test is looking in the wrong place`);
  assert.deepEqual(unwrapped, [],
    'a staleness verdict is built without toldOverride, so two surfaces can disagree about one agent');

  /* ⚠️ A SECOND SHAPE THE SCAN ABOVE CANNOT SEE, and perturbing found it: the
     `/api/agent/<name>/instructions` route serves `instructions.read(...)`, whose
     `.staleness` is raw. There is no `instructions.staleness(` text on that line,
     so reverting it left this file green. Asserted by its own shape. */
  const server = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  assert.match(server, /instructions\.read\(/, 'could not find the instructions route to check it');
  const routeWindow = server.slice(server.indexOf('instructions.read('), server.indexOf('instructions.read(') + 600);
  assert.match(routeWindow, /toldOverride\s*\(/,
    'the instructions route serves a raw verdict, so renderStale\'s told branch is unreachable from its own endpoint');
});

/* world-guard-lift-1704: "which Kosmos's agents does this board act on" has ONE
   answer, the booted world's launch key (launchidentity.currentWorldId, read through
   create.serviceLabel / win32job.taskName). #2849's second rule, "a named world may
   not start agents", is lifted on every route, so no spawn path and no resume may
   carry a named-world refusal again, and engine/worldstarts may not decide a world
   itself: it acts only through the keyed identity remove.jobFor hands it. */
test('world-guard-lift-1704: no named-world spawn refusal remains, and no resume takes a second rule', () => {
  const server = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const code = server.replace(/\/\*[\s\S]*?\*\//g, '');
  /* #1704 PR4: an import into the open Kosmos starts its agents by the same resume
     (startImported), so it is held to the same rule. */
  const opened = code.match(/worldstarts\.(drainAtBoot|resumePaused|startImported)\([^)]*\)/g) || [];
  assert.ok(opened.length >= 3, `found ${opened.length} start-on-open calls; expected the boot drain, the no-op switch and the import`);
  assert.ok(opened.some((c) => c.startsWith('worldstarts.startImported(')), 'the import no longer starts through worldstarts');
  for (const call of opened) {
    assert.match(call, /\(\s*\)$/, `${call} passes a gate: a resume on opening a Kosmos starts that Kosmos's own agents`);
  }
  const engine = fs.readFileSync(nodePath.join(__dirname, 'engine', 'worldstarts.js'), 'utf8');
  assert.doesNotMatch(engine, /bootedWorld|DEFAULT_ID/,
    'engine/worldstarts re-derives the named-world rule instead of taking the one it is handed');
  /* And the importer decides nothing about who may start: it copies and records. The
     route asks the one rule about a target it is not serving. */
  const importer = fs.readFileSync(nodePath.join(__dirname, 'engine', 'worldimport.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(importer, /bootedWorld|DEFAULT_ID|spawnRefusal|startImported|installJob/,
    'engine/worldimport decides or performs a start; that is worldstarts\' job, behind the one rule');
  const importRoute = code.slice(code.indexOf('function importIntoWorld('), code.indexOf('function importIntoWorld(') + 1600);
  assert.match(importRoute, /namedWorldSpawnRefusal\(r\.world\.id\)/, 'an import into a Kosmos that is not open does not ask the one rule whether it may run');
});

test('#1228: toldOverride can reuse a store list a caller already holds', () => {
  const projects = require('./engine/projects');
  /* `describe` is handed the store list `list()` already read. If the override
     ignored it and re-read per member, the cost that deferred this fix would be
     real again. Passing a list with no told records must be honoured, not
     silently replaced by a disk read. */
  /* ⚠️ AN EMPTY LIST PROVES NOTHING: the real store is empty in a test run too, so
     both "used the list" and "ignored it and read disk" answer `stale`. The list
     has to be one that CHANGES the verdict. Perturbing caught this: making the
     override ignore `known` left the old version of this test green. */
  const at = new Date().toISOString();
  const verdict = { state: 'stale', wroteBy: { who: 'kosmos', because: 'Kosmos changed it' }, editedAt: at };
  const known = [{ id: 'p1', told: { 'told-agent': { state: 'told', at } } }];
  const used = projects.toldOverride(verdict, 'told-agent', known);
  assert.equal(used.state, 'told',
    'toldOverride ignored the store list it was handed, so describe pays a disk read per member again');
  const unused = projects.toldOverride(verdict, 'told-agent', []);
  assert.equal(unused.state, 'stale', 'an explicit empty list was not honoured');
});
