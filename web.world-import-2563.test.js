"use strict";
/**
 * #2563: "Add my agents from an existing Kosmos" at create time (web UI slice).
 *
 * These run the SHIPPED functions from web/index.html against a fake document, so what is
 * under test is the code that ships, not a paraphrase. The engine endpoints
 * (GET /api/worlds/list, POST /api/worlds { importAgentsFrom }) are LIVE on main (merged as
 * the #2563 engine slice), so a checked create really copies agent profiles. The load-bearing
 * web behaviour here is: the control renders from a list when there IS one, HIDES itself when
 * the list is empty/absent (the graceful-degrade for a board that cannot answer), and the
 * create payload carries importAgentsFrom ONLY when the person actually checked a Kosmos.
 *
 *   node --test web.world-import-2563.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

function slice(name) {
  // Anchor on the `async` variant first so the extracted source keeps its `async`
  // keyword (worldImportFetch/worldAddSubmit are async; dropping `async` makes their
  // `await` a syntax error). Falls back to a plain function (worldImportRender).
  let at = SCRIPT.indexOf('async function ' + name + '(');
  if (at < 0) at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' moved or renamed; re-anchor this test');
  return SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 2);
}
const RENDER = slice('worldImportRender');
const FETCH = slice('worldImportFetch');
const SUBMIT = slice('worldAddSubmit');

// A minimal fake element: enough for worldImportRender (createElement + property sets +
// appendChild) and for reading the result back.
function fakeEl() {
  return {
    _children: [], className: '', type: '', value: '', textContent: '', hidden: false,
    appendChild(c) { this._children.push(c); return c; },
  };
}

function runRender(worlds) {
  const listEl = fakeEl();
  const wrapEl = fakeEl();
  const document = { createElement: () => fakeEl() };
  const wrap = `${RENDER}\n worldImportRender(_worlds, _list, _wrap);`;
  // eslint-disable-next-line no-new-func
  new Function('document', '_worlds', '_list', '_wrap', wrap)(document, worlds, listEl, wrapEl);
  return { listEl, wrapEl };
}

test('#2563: an empty list HIDES the control (the graceful-degrade before the engine lands)', () => {
  for (const empty of [[], null, undefined]) {
    const { listEl, wrapEl } = runRender(empty);
    assert.equal(wrapEl.hidden, true, 'the control did not hide for ' + JSON.stringify(empty));
    assert.equal(listEl._children.length, 0, 'rows were rendered for an empty list');
  }
});

test('#2563: a populated list renders one labelled checkbox per Kosmos with its agent count', () => {
  const { listEl, wrapEl } = runRender([
    { id: 'w1', name: 'Client work', agentCount: 2 },
    { id: 'w2', name: 'Side project', agentCount: 1 },
    { id: 'w3', name: 'Fresh', agentCount: 0 },
  ]);
  assert.equal(wrapEl.hidden, false, 'the control stayed hidden with Kosmoses to import from');
  assert.equal(listEl._children.length, 3, 'expected one row per Kosmos');

  const row0 = listEl._children[0];
  const cb0 = row0._children[0];
  const txt0 = row0._children[1];
  assert.equal(cb0.type, 'checkbox', 'the control is not a checkbox');
  assert.equal(cb0.value, 'w1', 'the checkbox value is not the world id (needed for importAgentsFrom)');
  assert.equal(txt0.textContent, 'Client work (2 agents)', 'the row label/count is wrong');
  // Singular vs plural, and the zero case.
  assert.equal(listEl._children[1]._children[1].textContent, 'Side project (1 agent)', 'singular agent count');
  assert.equal(listEl._children[2]._children[1].textContent, 'Fresh (0 agents)', 'zero-agent count');
});

// A row is a <label> that wraps the checkbox + text, so the count text is the checkbox's
// accessible name and the whole row is a click target (AA). Assert that structure.
test('#2563: each row is a label wrapping the checkbox and its text (accessible name)', () => {
  const { listEl } = runRender([{ id: 'w1', name: 'A', agentCount: 3 }]);
  const row = listEl._children[0];
  assert.equal(row.className, 'world-import-row');
  assert.equal(row._children.length, 2, 'a row must hold exactly the checkbox and its label span');
  assert.equal(row._children[0].type, 'checkbox');
  assert.equal(row._children[1].textContent, 'A (3 agents)');
});

async function runFetch(fetchStub) {
  const wrap = `${FETCH}\n return worldImportFetch();`;
  // eslint-disable-next-line no-new-func
  return new Function('fetch', wrap)(fetchStub);
}

test('#2563: worldImportFetch returns the worlds on 200 and [] on ANY failure', async () => {
  const ok = await runFetch(async () => ({
    ok: true, json: async () => ({ worlds: [{ id: 'w1', name: 'A', agentCount: 2 }, { id: 'w2', name: 'B' }] }),
  }));
  assert.deepEqual(ok.map((w) => w.id), ['w1', 'w2'], 'valid worlds were dropped');

  assert.deepEqual(await runFetch(async () => ({ ok: false, json: async () => ({}) })), [], 'a non-2xx (absent endpoint) must yield []');
  assert.deepEqual(await runFetch(async () => ({ ok: true, json: async () => { throw new Error('bad'); } })), [], 'an unparseable body must yield []');
  assert.deepEqual(await runFetch(async () => { throw new Error('network'); }), [], 'a network error must yield []');
  // A junk shape (no worlds array) yields [], and entries missing id/name are filtered out.
  assert.deepEqual(await runFetch(async () => ({ ok: true, json: async () => ({ worlds: 'nope' }) })), [], 'a non-array worlds must yield []');
});

async function runSubmit(nameValue, checkedIds) {
  const captured = {};
  const boxes = checkedIds.map((id) => ({ value: id, checked: true }))
    .concat([{ value: 'unchecked', checked: false }]); // a present-but-unchecked box must be excluded
  const els = {
    'world-add-name': { value: nameValue },
    'world-add-go': { disabled: false },
    'world-add-msg': { textContent: '' },
  };
  const document = {
    getElementById: (id) => els[id],
    querySelectorAll: (sel) => {
      assert.equal(sel, '#world-add-import-list .world-import-cb', 'submit read the wrong selector');
      return boxes;
    },
  };
  const fetchStub = async (url, opts) => { captured.url = url; captured.body = JSON.parse(opts.body); return { ok: true, json: async () => ({}) }; };
  const wrap = `${SUBMIT}\n return worldAddSubmit();`;
  // eslint-disable-next-line no-new-func
  await new Function('document', 'fetch', 'worldAddClose', 'worldsFetch', 'worldswOpen', wrap)(
    document, fetchStub, () => {}, async () => {}, () => {},
  );
  return captured;
}

test('#2563: the create payload carries importAgentsFrom ONLY when a Kosmos is checked', async () => {
  const withImport = await runSubmit('My Kosmos', ['w1', 'w2']);
  assert.equal(withImport.url, '/api/worlds');
  assert.deepEqual(withImport.body, { name: 'My Kosmos', importAgentsFrom: ['w1', 'w2'] },
    'checked Kosmoses must be sent as importAgentsFrom (and an unchecked box excluded)');

  const noImport = await runSubmit('Plain', []);
  assert.deepEqual(noImport.body, { name: 'Plain' },
    'with nothing checked the payload must be byte-identical to today ({ name }), no importAgentsFrom key');
  assert.equal(Object.prototype.hasOwnProperty.call(noImport.body, 'importAgentsFrom'), false,
    'importAgentsFrom must be absent, not present-and-empty, so existing create behaviour is untouched');
});
