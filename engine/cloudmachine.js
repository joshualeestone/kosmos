'use strict';
/**
 * kosmos#4903 S5: whether this board runs on a Kosmos cloud machine (a box Kosmos created for the person, reached
 * only through a browser), so the page can speak to a person who has no terminal and no local browser on it.
 *
 * ONE source of truth, never a second copy: the install-time latch the cloud installer writes into the tunnel's state
 * dir after `kosmos-tunnel setup cloud` registered the box (kosmos#4903, PigeonPete's correction 2): an empty
 * regular file named `hosted`, on Linux only. Not `KOSMOS_CLOUD=1`: that sits in the installer's provision.env and
 * never reaches the board's environment, and a variable that did could disagree with the latch.
 *
 * 🛑 WORDS AND FLOW ONLY, NEVER ADMISSION. Who may open this board is decided by kosmos-tunnel's gate, which needs
 * the latch AND a coordinator-signed claim AND a Linux build. Nothing on the board grants or refuses anyone on the
 * strength of this answer; a wrong answer here shows the wrong sentence, nothing more.
 */
const fs = require('fs');
const path = require('path');

const LATCH = 'hosted';

/* `platform` and `stateDir` are seams for tests; the board passes neither. A symlink is not the latch (the installer
   writes a regular file), and anything unreadable is "not a cloud machine": the Mac and PC wording stays. */
function isCloudMachine({ platform = process.platform, stateDir } = {}) {
  if (platform !== 'linux') return false;
  try {
    // Inside the try: the page stamp calls this on every page request, so no failure here may ever throw.
    const dir = stateDir || require('./remote').stateDir();
    return fs.lstatSync(path.join(dir, LATCH)).isFile();
  } catch {
    return false;
  }
}

module.exports = { isCloudMachine, LATCH };
