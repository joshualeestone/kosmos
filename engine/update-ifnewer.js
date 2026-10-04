'use strict';

/**
 * #4382: the look behind `kosmos update --if-newer`, for a Mac whose board is stopped on purpose.
 *
 * A computer set to "Connect to agents on another computer" (#4356) runs no board, and the board
 * is what looks for updates (update.js polls the pointer and runs the installer). So the Mac app
 * asks the CLI at launch and once a day, and the CLI asks this file. It runs the board's OWN rules,
 * by requiring the board's own modules rather than copying them:
 *   - the channel: env first, then the install's source-channel stamp (update.updateChannel);
 *   - the pointer for that channel, and on staging the prod pointer beside it (update.refresh, #2969);
 *   - newer(): strictly numeric, unknown loses;
 *   - the consent: autoupdate.read(), where an absent file is ON and an unreadable one is OFF.
 *
 * It decides and prints; it never installs. The CLI runs the installer, because beginInstall()
 * refuses outside a board (the live-execution gate) and spawns detached, and an update the app is
 * waiting on must be one it can wait for.
 *
 * Prints ONE tab-separated line on stdout, and exits 0 whenever it could say something:
 *   current  <running>
 *   newer    <latest> <on|off|unreadable> <setup url> <release base> <pointer channel> <subscribed channel>
 *   unknown  <reason>                      (exit 1: the host could not be reached or read)
 *   source                                 (exit 1: not an installed copy; source updates with git)
 */

const fs = require('node:fs');
const { fileURLToPath } = require('node:url');
const update = require('./update');
const autoupdate = require('./autoupdate');

/* A file:// release base is one the installer already accepts (setup.sh serves its whole release
   path over it, and test-install drives it that way), but node's fetch does not read file URLs.
   So a file base is read from disk here, answering the same way a host would: a missing file is
   a 404, never "could not reach". Only for file:// bases; every other base uses the real fetch. */
function fileFetcher(url) {
  try {
    const body = fs.readFileSync(fileURLToPath(String(url).replace(/\?.*$/, '')), 'utf8');
    return Promise.resolve({ ok: true, json: () => Promise.resolve().then(() => JSON.parse(body)) });
  } catch {
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  }
}

function consentWord() {
  const pref = autoupdate.read();
  if (!pref.ok) return 'unreadable';
  return pref.on ? 'on' : 'off';
}

async function decide() {
  if (!update.installedRoot()) return { line: ['source'], code: 1 };
  if (/^file:/i.test(update.releaseBase())) update.setFetcher(fileFetcher);
  /* checkNow() runs refresh(), which ends in the board's maybeAutoInstall(). Here that must never start
     an install: the CLI runs the installer and waits for it. So the board's auto-install reads the
     preference as off for this process, whatever the switch says; the consent this file reports is
     read from autoupdate.read() directly (consentWord), not through that override. */
  update.setAutoPref(() => ({ on: false, ok: true }));
  const look = await update.checkNow();
  if (!look.reached) return { line: ['unknown', 'the release host could not be reached'], code: 1 };
  if (!look.readable) return { line: ['unknown', 'the release host answered, but not with a version'], code: 1 };
  const offer = update.available();
  if (!offer) return { line: ['current', String(update.RUNNING)], code: 0 };
  return {
    line: ['newer', offer.version, consentWord(), update.setupUrl(), update.releaseBase(), update.installPointer(), update.updateChannel()],
    code: 0,
  };
}

if (require.main === module) {
  decide().then(({ line, code }) => {
    process.stdout.write(line.map((v) => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t') + '\n');
    process.exitCode = code;
  }, (err) => {
    process.stdout.write('unknown\t' + String(err && err.message || err).replace(/[\t\r\n]+/g, ' ') + '\n');
    process.exitCode = 1;
  });
}

module.exports = { decide, fileFetcher };
