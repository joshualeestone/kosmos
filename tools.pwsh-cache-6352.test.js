'use strict';
/* #6352: pwsh replays a per-user startup profile (powershell/StartupProfileData-NonInteractive under the cache folder)
 * and rewrites it on every run. One damaged write made every later pwsh start crash (rc 134) and failed
 * tools/test-publish-r2-3725.sh 87 of 87 in every validation on the fleet Mac until the file was moved aside.
 *
 * So a shell test that starts the REAL pwsh gives it a cache folder of its own (pwsh reads XDG_CACHE_HOME on macOS
 * and Linux) before its first run: a damaged shared profile cannot reach it, and parallel runs cannot tear the shared
 * one. A real pwsh is recognised by the test looking it up (`command -v pwsh`); a test that makes a fake pwsh does not.
 *
 * Measured once, both arms, with the damaged profile from that night as the outer cache: without the export the
 * script failed 87 (rc 134); with it, all passed and the damaged file was untouched. That run is not repeated here
 * (it needs the damaged file); this pins that the export stays ahead of every pwsh start.
 *
 * Found by `command -v pwsh` only: a script that finds pwsh another way (`which`, `type -P`, a fixed path) or holds it
 * in a variable not named PWSH is not checked. The first test pins that the sweep finds the one script known today.
 *
 * Not covered: a node test that spawns pwsh off Windows (none today; tools.win-setup-ps1.test.js runs pwsh only on
 * Windows, where the profile lives under LOCALAPPDATA).
 *   node --test tools.pwsh-cache-6352.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOOLS = path.join(__dirname, 'tools');
// At column 0, so it is not inside an if or a function body, where it might not run.
const EXPORT = /^export XDG_CACHE_HOME="\$TMP\/[^"]+"\s*$/;

/* The line index of the first line that starts pwsh: the script's own "$PWSH" variable or pwsh by name, followed by
   a flag (a test of the variable, such as [ -z "$PWSH" ], is not a start). */
function firstPwshRun(lines) {
  return lines.findIndex((l) => !/^\s*#/.test(l) && !/command -v pwsh/.test(l) && /"?\$\{?PWSH\}?"?\s+-|(^|[\s;&|(])pwsh\s+-/.test(l));
}

const realPwshTests = fs.readdirSync(TOOLS)
  .filter((f) => /^test-.*\.sh$/.test(f))
  .filter((f) => /command -v pwsh/.test(fs.readFileSync(path.join(TOOLS, f), 'utf8')));

test('#6352: there is a shell test that starts the real pwsh (so the sweep below checks something)', () => {
  assert.ok(realPwshTests.includes('test-publish-r2-3725.sh'), 'the sweep found ' + JSON.stringify(realPwshTests));
});

for (const f of realPwshTests) {
  test(`#6352: ${f} gives pwsh its own cache folder before it first starts it`, () => {
    const lines = fs.readFileSync(path.join(TOOLS, f), 'utf8').split('\n');
    const run = firstPwshRun(lines);
    assert.ok(run >= 0, `${f} looks pwsh up but this test cannot find where it starts it: re-anchor firstPwshRun`);
    const exp = lines.findIndex((l) => EXPORT.test(l));
    assert.ok(exp >= 0, `${f} starts the real pwsh with the shared per-user cache (export XDG_CACHE_HOME="$TMP/..." first)`);
    assert.ok(exp < run, `${f} exports XDG_CACHE_HOME on line ${exp + 1}, after its first pwsh start on line ${run + 1}`);
  });
}
