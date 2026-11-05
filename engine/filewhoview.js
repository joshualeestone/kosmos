'use strict';
/* kosmos#7989 slice 2: `kosmos project who <file>`, the words for one project file's record (filewriters.about, served by
 * GET /api/project-file/who). An agent that finds a shared file "changed after it last read it" runs this before it calls
 * the change unexplained: it says which agent Kosmos last saw about to change the file, who owns it (the first agent seen
 * changing it, slice 1), and whether that recorded write is the file's last change or something Kosmos did not see came
 * after it.
 *
 * Pure: no file, no clock. The Mac CLI prints renderWho(answer); a Windows CLI can print the same lines.
 *
 * The words say "Kosmos last saw ... about to change it", never "changed by": the record is made before the edit (the
 * keep-before-write hook), so an edit that failed, or a person's save inside the window after it, reads the same.
 */
const { one } = require('./projectview');

/* A name as the board shows it, with its session name when that differs (so the reader can message it). */
function who(agent, shown) {
  const a = one(agent);
  const s = one(shown);
  return s && s !== a ? s + ' (' + a + ')' : a;
}

/* The lines for one answer. `answer` is the route's JSON; anything not that shape prints one line saying so. */
function renderWho(answer) {
  const d = answer && typeof answer === 'object' ? answer : {};
  if (d.ok !== true) {
    if (d.because === 'outside') return ['That file is not inside any project\'s folder (a link inside one that leads elsewhere counts as elsewhere), so Kosmos keeps no record of who changes it.'];
    if (d.because === 'folder') return ['That is a folder, not a file. Ask about one file in it.'];
    return ['Kosmos could not read who changes that file' + (d.error ? ': ' + one(d.error) : '') + '.'];
  }
  const lines = [];
  // Review 2: quoted, with its own quotes made single, so a name cannot pass for words of this output.
  lines.push('File: "' + one(d.name).replace(/"/g, "'") + '"   (project ' + one(d.projectName || d.projectId) + ', ' + one(d.projectId) + ')');
  if (!d.exists) lines.push('The file is not there now.');
  const seen = d.lastSeen && typeof d.lastSeen === 'object' && d.lastSeen.agent ? d.lastSeen : null;
  if (!seen) {
    lines.push('Kosmos has no record of any agent changing it.');
    // Review 1: no record is not proof of a person: the record lapses (30 days, or past 2000 files) and began with #5812.
    if (d.exists) lines.push('So Kosmos cannot say who changed it last: a person, a tool that writes outside the edit hook (a shell command, a script), or a change older than its record.');
  } else {
    lines.push('Kosmos last saw ' + who(seen.agent, seen.shown) + ' about to change it, at ' + one(seen.at) + '.');
    if (d.exists && d.modified) {
      if (d.lastChange === 'seen') lines.push('The file\'s last change (' + one(d.modified) + ') came within two minutes of that, so it was most likely that edit.');
      // Review 2: the recorded agent is not ruled out: an edit approved minutes after its prompt lands late.
      else if (d.lastChange === 'after') lines.push('The file changed again after that, at ' + one(d.modified) + ', and Kosmos did not see who made that change: it may be ' + who(seen.agent, seen.shown) + '\'s edit landing late (after a permission prompt), another agent whose edit Kosmos missed, a person, or a tool writing outside the edit hook.');
      // Review 1: an older time is not proof the content is unchanged (cp -p, rsync -t, unzip restore old times).
      else if (d.lastChange === 'before') lines.push('Its modification time (' + one(d.modified) + ') is older than that, so that edit does not seem to have landed (it may have failed), a tool restored an older time, or the folder is on another computer whose clock differs.');
    }
  }
  if (d.owner && typeof d.owner === 'object' && d.owner.agent) {
    lines.push('Owner: ' + who(d.owner.agent, d.owner.shown) + ', the first agent seen changing it here (in the record Kosmos keeps).');
  } else if (seen) {
    lines.push('Owner: none known. Kosmos records an owner only for a file it first saw changed after owners began to be kept.');
  }
  return lines;
}

module.exports = { renderWho };
