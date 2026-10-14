'use strict';

/**
 * #6180 part 4 (Josh, 2026-10-14 17:05: "when we create agents here we should mark it as optional to assign them to a
 * project"): the team creator's Project field says it is optional and offers "No project for now". Runs the page's
 * own tcFillProjects against a stub select; reads the field's label from the page.
 *
 *   node --test web.noproject-6180.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const SRC = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(SRC);

function fill(projects) {
  const sel = { value: '', options: [], replaceChildren(...o) { this.options = o; } };
  const doc = {
    getElementById: (id) => (id === 'tc-project' ? sel : null),
    createElement: () => ({ value: '', textContent: '' }),
  };
  const TC = { team: { label: 'Marketing' } };
  const capM = SCRIPT.match(/const TC_PROJECT_NAME_CAP = [^;]+;/);
  assert.ok(capM, 'TC_PROJECT_NAME_CAP moved; the lift needs it');
  const cap = capM[0];
  new Function('document', 'TC', 'PROJECTS', cap + '\n' + page.lift(SCRIPT, 'tcFillProjects') + '\nreturn tcFillProjects;')(doc, TC, projects)();
  return sel;
}

test('#6180: the team creator offers "No project for now" and keeps a new project as the default', () => {
  const sel = fill([{ id: 'p1', name: 'Launch', archived: false }]);
  const opts = sel.options.map((o) => [o.value, o.textContent]);
  assert.deepEqual(opts.find((o) => o[0] === 'none'), ['none', 'No project for now'], 'the no-project choice does not read "No project for now"');
  assert.equal(sel.value, 'new', 'the default is no longer a new project (the card kept that default)');
  assert.ok(opts.some((o) => o[0] === 'id:p1'), 'CONTROL: the existing project is still offered, so the lift ran the real list');
});

test('#6180: the team creator\'s Project field is labelled optional', () => {
  assert.match(SRC, /<label class="flabel" for="tc-project">Project \(optional\)<\/label>/, 'the Project field does not say it is optional');
});
