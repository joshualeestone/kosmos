'use strict';

/*
 * kosmos#8865: the words for `kosmos start-check`, in a module that requires nothing, so both CLIs print the same
 * sentences from the board's answer (GET /api/board/start-check, engine/storecheck.js report()).
 *
 * Why it exists: after a crash restart the board checks its own data files first (#7248) and the page says what it
 * found (#8287), but an agent could not read that, so it scanned the data folder by hand and concluded nothing in
 * Kosmos would have told it (feedback, 2026-11-21). This prints the same facts the page shows.
 *
 * It never says the files are fine unless the scan ran and looked at everything (`checked` true and nothing unread).
 */

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/** The lines to print for one report. Pure: the same report always gives the same lines. */
function renderLines(r) {
  if (!r || typeof r !== 'object' || r.ran !== true) {
    return ['Kosmos has no result from this start\'s check of its own files (it did not run, has not finished, or its answer could not be read), so it cannot say whether any is damaged.'];
  }
  const looked = Number.isInteger(r.looked) && r.looked >= 0 ? r.looked : null;
  const seen = looked === null ? '' : ' (' + plural(looked, 'file', 'files') + ')';
  const unread = Number.isInteger(r.unread) && r.unread > 0 ? r.unread : 0;
  const damaged = Number.isInteger(r.damaged) && r.damaged > 0 ? r.damaged : 0;
  const lines = [];
  if (damaged === 0) {
    if (unread > 0 || r.checked !== true) {
      lines.push('Kosmos checked its own files at this start' + seen + ' and found none damaged, but it could not look at '
        + (unread > 0 ? plural(unread, 'file or folder', 'files or folders') : 'all of them') + ', so it cannot say those are fine.');
    } else if (looked === 0) {
      lines.push('Kosmos found none of its own files to check at this start (a new install has none yet), so none is damaged.');
    } else {
      lines.push('Kosmos checked its own files at this start' + seen + ': none is damaged.');
    }
    return lines;
  }
  lines.push('Kosmos checked its own files at this start' + seen + ' and found ' + damaged + ' damaged.'
    + (unread > 0 ? ' It could not look at ' + plural(unread, 'other file or folder', 'other files or folders') + ', so there may be more.' : ''));
  const files = Array.isArray(r.files) ? r.files : [];
  /* review 2: put back is counted by the board (`restored`), never inferred from a shorter list, which a dismissal
     also empties. */
  const restored = Number.isInteger(r.restored) && r.restored > 0 ? Math.min(r.restored, damaged) : 0;
  if (restored > 0) {
    lines.push(restored === damaged ? 'All of them were put back from a good copy since the start.'
      : restored + ' of them ' + (restored === 1 ? 'was' : 'were') + ' put back from a good copy since the start.');
  }
  if (restored === damaged) return lines;
  if (r.dismissed === true && files.length === 0) {
    lines.push('The person has seen the list and dismissed it for this start, so it is not listed again until the next start.');
    return lines;
  }
  for (const f of files) {
    if (!f || typeof f.file !== 'string') continue;
    let line = '- ' + f.file + ' ' + (typeof f.says === 'string' ? f.says : 'is damaged')
      + (typeof f.holds === 'string' ? ' (it holds ' + f.holds + ').' : '.');
    line += f.savedOver === true ? ' It has been saved since the start, so what it holds now is newer than what was found.' : ' Kosmos left it as it is.';
    if (f.backup && typeof f.backup.file === 'string') {
      line += ' A good copy' + (typeof f.backup.at === 'string' ? ' saved ' + f.backup.at : '') + ' is at ' + f.backup.file + '; the person can put it back in Kosmos.';
    } else if (f.secret === true) {
      line += ' It holds a key or something that can be taken back, so Kosmos keeps no copy of it.';
    } else if (f.problem === 'toobig' || f.problem === 'unopenable') {
      // review 3: the scan does not look for a copy of these (storecheck.js scan), so "none was found" would be untrue.
      line += ' Kosmos did not look for a good copy of it.';
    } else {
      line += ' No good copy of it was found.';
    }
    lines.push(line);
  }
  return lines;
}

module.exports = { renderLines };
