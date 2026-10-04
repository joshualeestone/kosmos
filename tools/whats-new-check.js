#!/usr/bin/env node
'use strict';
/**
 * #3955: release.sh step 1b-ii. Is web/whats-new.json the highlights for the version being cut?
 *
 *   node tools/whats-new-check.js <version> [file]
 *
 * Exit 0 when it is. Exit 3 (round 13: not 1, which node itself gives any crash), with the reasons,
 * when it is missing, for another version, or not a file the window can show: the cut stops before anything is built or bumped, so the operator
 * writes the file (or, for a hotfix with nothing to announce, sets KOSMOS_CUT_NO_WHATS_NEW=1, which
 * release.sh handles before calling this). Exit 2 on a usage error.
 */
const fs = require('node:fs');
const path = require('node:path');

const NOT_READY = 3;   // the file is not ready for this version (every other nonzero means the check could not run)

function main(argvIn) {
  const whatsnew = require('../engine/whatsnew');   // inside main, so a broken module is a thrown error below (exit 2)
  // #5224: --platform=mac|windows names the platform being cut; that platform must show at least one highlight.
  const flags = argvIn.filter((a) => a.startsWith('--platform='));
  const argv = argvIn.filter((a) => !a.startsWith('--platform='));
  const platform = flags.length ? flags[flags.length - 1].slice('--platform='.length) : null;
  if (platform !== null && !whatsnew.PLATFORMS.includes(platform)) {
    process.stderr.write('usage: --platform must be one of ' + whatsnew.PLATFORMS.join(', ') + '\n');
    return 2;
  }
  const version = argv[0];
  const file = argv[1] || whatsnew.FILE;
  const name = path.relative(process.cwd(), file) || file;   // the file actually read, in the messages
  if (!version || !whatsnew.VERSION_RE.test(version)) {
    process.stderr.write('usage: node tools/whats-new-check.js <version like 0.6.98> [file] [--platform=mac|windows]\n');
    return 2;
  }
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code !== 'ENOENT') {   // round 12: a permissions or folder problem is not "missing"
      process.stderr.write(name + ' could not be read (' + e.code + ').\n');
      return 2;   // the check could not read it: not an answer about the file
    }
    process.stderr.write(name + ' is missing. Write the highlights for ' + version
      + ' (1 to 5: an icon, a short title and one line each) and commit it before cutting, or set'
      + ' KOSMOS_CUT_NO_WHATS_NEW=1 to cut with no "Kosmos has been updated" window.\n');
    return NOT_READY;
  }
  let obj;
  try { obj = JSON.parse(raw); } catch {
    process.stderr.write(name + ' is not valid JSON.\n');
    return NOT_READY;
  }
  const bad = whatsnew.problems(obj, version);
  if (bad.length) {
    process.stderr.write(name + ' is not ready for ' + version + ':\n' + bad.map((b) => '  - ' + b).join('\n') + '\n'
      + 'Fix it and commit it before cutting, or set KOSMOS_CUT_NO_WHATS_NEW=1 to cut with no "Kosmos has been updated" window.\n');
    return NOT_READY;
  }
  const per = whatsnew.countsByPlatform(obj);   // #5224: a Mac-only highlight is not shown on Windows
  process.stdout.write(name + ': ' + obj.highlights.length + ' highlight(s) for ' + version + ' ('
    + Object.entries(per).map(([p, c]) => p + ' ' + c).join(', ') + ')\n');
  if (platform !== null && !per[platform]) {
    process.stderr.write(name + ' has no highlight for ' + platform + ': every one is tagged for another platform, so ' + platform
      + ' would show no "Kosmos has been updated" window. Tag one for ' + platform + ', or set KOSMOS_CUT_NO_WHATS_NEW=1 to cut with none.\n');
    return NOT_READY;
  }
  for (const [p, c] of Object.entries(per)) {
    if (!c) process.stderr.write('note: every highlight is for another platform, so ' + p + ' shows no "Kosmos has been updated" window.\n');
  }
  return 0;
}

if (require.main === module) {
  let code;
  try { code = main(process.argv.slice(2)); } catch (e) {
    process.stderr.write('the highlights check could not run: ' + ((e && e.message) || e) + '\n');
    code = 2;
  }
  process.exit(code);
}
module.exports = { main, NOT_READY };
