'use strict';

/*
 * #5663 review 3: a block inserted above 'use strict' turned a 2,000-line module into sloppy mode, silently: a directive
 * that is not the first statement does nothing, and nothing else fails. Every tracked .js file that carries the
 * directive must carry it first (after a shebang, comments and whitespace).
 * Known false red: an unindented line that is only the directive, inside a template literal or a block comment of a
 * file with no real directive. None exists; an indented (function-level) directive is not matched.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');

function misplaced(text) {
  // Either quote, with or without the semicolon (review 4).
  if (!/^(['"])use strict\1;?\s*(\/\/.*)?$/m.test(text)) return false;
  const rest = text.replace(/^#!.*\n/, '').replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
  return !/^(['"])use strict\1/.test(rest);
}

test('#5663: a file that says \'use strict\' says it first', () => {
  const files = execFileSync('git', ['-C', REPO, 'ls-files', '*.js'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(files.length > 100, 'CONTROL: the file list is the repo, not empty: ' + files.length);
  // A tracked file deleted in the working tree is skipped (review 17): its absence is not a directive problem.
  const bad = files.filter((f) => fs.existsSync(path.join(REPO, f)) && misplaced(fs.readFileSync(path.join(REPO, f), 'utf8')));
  assert.deepEqual(bad, [], 'the directive is not the first statement, so it does nothing');
});

test('#5663: CONTROL, the check sees a misplaced directive and passes a first one', () => {
  assert.equal(misplaced("const x = 1;\n'use strict';\n"), true);
  assert.equal(misplaced("/* a */\nconst x = 1; /* b */\n'use strict';\n"), true);
  assert.equal(misplaced("#!/usr/bin/env node\n// note\n/* block\n */\n'use strict';\nconst x = 1;\n"), false);
  assert.equal(misplaced('const x = 1;\n"use strict"\n'), true);
  assert.equal(misplaced('"use strict";\nconst x = 1;\n'), false);
  assert.equal(misplaced("const x = 1;\n'use strict'; // why\n"), true);
  assert.equal(misplaced('const x = 1;\n'), false);
});
