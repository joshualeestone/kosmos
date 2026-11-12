'use strict';
/**
 * kosmos#8378: a stand-in runner binary (claude, codex, gemini, ...) that this platform counts as runnable.
 *
 * A test that points AGENT_WORKFORCE_<RUNNER>_BIN at a sandbox stub wrote an extensionless `#!/bin/sh` script with
 * mode 0755. That is runnable on macOS and Linux, and on Windows it is not: there a file runs by its extension
 * (PATHEXT), so engine/runners.js isRunnable refused the stub and every create or adopt answered "we could not find
 * Claude on this computer". The stub is still written at the same path, so the test's variable and every path it
 * asserts are unchanged; on Windows a `<name>.cmd` beside it is what runners.js finds for that path (pathextCandidates
 * tries the extensions in order, the way Windows looks a bare command up). Nothing in these tests runs the stub.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Write the stub `name` in `dir` (made if missing) and return its path, `dir/name`, as the test used before. */
function writeRunnerStub(dir, name, platform = process.platform) {
  fs.mkdirSync(dir, { recursive: true });
  const at = path.join(dir, name);
  fs.writeFileSync(at, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(at, 0o755);
  if (platform === 'win32') fs.writeFileSync(at + '.cmd', '@exit /b 0\r\n');
  return at;
}

/** Remove the stub `name` from `dir`, the .cmd beside it included, so the runner is really gone on every platform. */
function removeRunnerStub(dir, name) {
  const at = path.join(dir, name);
  fs.rmSync(at);
  fs.rmSync(at + '.cmd', { force: true });
}

module.exports = { writeRunnerStub, removeRunnerStub };
