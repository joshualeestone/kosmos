#!/usr/bin/env node
'use strict';
/**
 * #3955: release.sh step 1b-ii. Is web/whats-new.json the highlights for the version being cut?
 *
 *   node tools/whats-new-check.js <version> [file]
 *
 * Exit 0 when it is. Exit 1, with the reasons, when it is missing, for another version, or not a
 * file the window can show: the cut stops before anything is built or bumped, so the operator
 * writes the file (or, for a hotfix with nothing to announce, sets KOSMOS_CUT_NO_WHATS_NEW=1, which
 * release.sh handles before calling this). Exit 2 on a usage error.
 */
const fs = require('node:fs');
const path = require('node:path');
const whatsnew = require('../engine/whatsnew');

function main(argv) {
  const version = argv[0];
  const file = argv[1] || whatsnew.FILE;
  const name = path.relative(process.cwd(), file) || file;   // the file actually read, in the messages
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    process.stderr.write('usage: node tools/whats-new-check.js <version like 0.6.98> [file]\n');
    return 2;
  }
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch {
    process.stderr.write(name + ' is missing. Write the highlights for ' + version
      + ' (1 to 5: an icon, a short title and one line each) and commit it before cutting, or set'
      + ' KOSMOS_CUT_NO_WHATS_NEW=1 to cut with no "What\'s new" window.\n');
    return 1;
  }
  let obj;
  try { obj = JSON.parse(raw); } catch {
    process.stderr.write(name + ' is not valid JSON.\n');
    return 1;
  }
  const bad = whatsnew.problems(obj, version);
  if (bad.length) {
    process.stderr.write(name + ' is not ready for ' + version + ':\n' + bad.map((b) => '  - ' + b).join('\n') + '\n'
      + 'Fix it and commit it before cutting, or set KOSMOS_CUT_NO_WHATS_NEW=1 to cut with no "What\'s new" window.\n');
    return 1;
  }
  process.stdout.write(name + ': ' + obj.highlights.length + ' highlight(s) for ' + version + '\n');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main };
