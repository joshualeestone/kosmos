'use strict';
/* #4581 (Josh's Five Families project, #4580 items 2 and 7; four of five model families asked for it):
 * `kosmos project list` and `kosmos project show <id>`, so an agent can see what projects exist, who is on
 * them, which model family each member runs, the folder, the open tasks, the brief's goal and "done", and
 * whether each member's running summary is current. Before this, only `kosmos project create` existed, and
 * agents checked each other's summary files by looking in each other's folders.
 *
 * ONE module for both CLIs: the board builds the payload here (overviewOf / listOf, from the same
 * projects.list the page reads), and install/kosmos and tools/windows/kosmos-cli.js both print it with
 * renderList / renderShow, so the Mac and Windows words cannot drift.
 *
 * Read-only. Membership is an organising fact, never a boundary (server.js, GET /api/projects), so any
 * agent may read any project; nothing here grants or checks an access level.
 */
const fs = require('node:fs');
const path = require('node:path');

/* The rhythm the roles ask for (engine/roles.js SUMMARY_RHYTHM): a summary file every four hours while
   working, as summaries/YYYY-MM-DD-HH.md in the agent's own folder. */
const SUMMARY_RHYTHM_HOURS = 4;
const SUMMARY_NAME = /^\d{4}-\d{2}-\d{2}-\d{2}\.md$/;
/* A summaries folder is a few files a day; far more is not one, and it is not read whole. */
const SUMMARY_SCAN_MAX = 5000;
/* How far ahead of this computer's clock a write time may be before it is not believed. */
const FUTURE_SLACK_MINUTES = 5;

/**
 * How current an agent's running summary is: the newest summaries/YYYY-MM-DD-HH.md in its folder, by the
 * time it was last written. Never throws.
 * @returns {{ state: 'current'|'stale'|'future'|'none'|'unreadable', file: string|null, at: string|null, ageMinutes: number|null }}
 *   current: written within the four-hour rhythm; stale: longer ago (an agent that has been idle is not
 *   expected to write, so stale is a fact to read, not a fault); none: no summaries yet; unreadable: we
 *   could not look (the reader must not take that as none).
 */
function summaryFreshness(folder, nowMs) {
  const none = { state: 'none', file: null, at: null, ageMinutes: null };
  if (typeof folder !== 'string' || !folder || !path.isAbsolute(folder)) return { ...none, state: 'unreadable' };
  /* Blind review round 1: "we do not know where this agent's folder is" is not "it wrote no summaries", and the PM
     role raises a missing summary as a finding, so the two are said apart. The agent's own folder missing is
     `nofolder`; only a folder that exists with no summaries/ in it is `none`. */
  try { if (!fs.lstatSync(folder).isDirectory()) return { ...none, state: 'nofolder' }; }
  catch (e) { return { ...none, state: (e && e.code === 'ENOENT') ? 'nofolder' : 'unreadable' }; }
  const dir = path.join(folder, 'summaries');
  let names;
  try {
    const st = fs.lstatSync(dir);
    /* A symlink or a file where summaries/ should be: not read (it is not the agent's own folder), and so
       `unreadable`, never `none`: something is there and we did not look (round 1). */
    if (!st.isDirectory()) return { ...none, state: 'unreadable' };
    names = fs.readdirSync(dir);
  } catch (e) {
    return (e && e.code === 'ENOENT') ? none : { ...none, state: 'unreadable' };
  }
  let best = null;
  /* Only summary-shaped names, newest name first, so the cap never drops the newest file of a big folder. */
  const candidates = names.filter((n) => SUMMARY_NAME.test(n)).sort().reverse().slice(0, SUMMARY_SCAN_MAX);
  for (const name of candidates) {
    let st;
    try { st = fs.lstatSync(path.join(dir, name)); } catch { continue; }
    if (!st.isFile()) continue;
    if (!best || st.mtimeMs > best.ms) best = { name, ms: st.mtimeMs };
  }
  if (!best) return none;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const raw = Math.round((now - best.ms) / 60000);
  /* A write time well ahead of now (clock skew, a restored copy, a touch) is not evidence of a current
     summary, so it is said as its own state rather than read as "just now". */
  if (raw < -FUTURE_SLACK_MINUTES) return { state: 'future', file: 'summaries/' + best.name, at: new Date(best.ms).toISOString(), ageMinutes: null };
  const ageMinutes = Math.max(0, raw);
  return {
    state: ageMinutes <= SUMMARY_RHYTHM_HOURS * 60 ? 'current' : 'stale',
    file: 'summaries/' + best.name,
    at: new Date(best.ms).toISOString(),
    ageMinutes,
  };
}

/* The model family a person reads, from the runner the board recorded for the member. The one
   runner -> provider -> vendor map is create.js's; "Claude" is the product word for Anthropic, as the
   families themselves were named (Claude, GPT via OpenAI, Gemini, Grok, Meta Muse). Null when the board
   could not tie a program to the member. */
function familyOf(runner) {
  if (typeof runner !== 'string' || !runner) return null;
  const create = require('./create');
  const provider = create.runnerProvider(runner);
  return provider === 'anthropic' ? 'Claude' : create.providerLabel(provider);
}

function openTasks(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const open = list.filter((t) => t && !(t.progress && t.progress.closed));
  return { total: list.length, open: open.length, built: open.filter((t) => t.builtAt).length };
}

/**
 * The payload for one project, from a projects.list() entry (already described against the roster).
 * @param {object} p      one element of projects.list(roster)
 * @param {Array} roster  the cards the list was described against (for each member's model)
 * @param {{ now?: number, folderOf?: (sessionName: string) => string|null, readBrief?: (folder: string) => object }} [o]
 */
function overviewOf(p, roster, o) {
  const opts = o || {};
  const folderOf = opts.folderOf || ((name) => { try { return require('./create').workerDir(name); } catch { return null; } });
  const readBrief = opts.readBrief || require('./brief').readBrief;
  const cards = Array.isArray(roster) ? roster : [];
  const brief = readBrief(p.folder) || { goal: null, done: null, found: false };
  const members = (p.agents || []).map((m) => {
    const card = m.tied ? cards.find((c) => c && c.sessionName === m.sessionName) : null;
    return {
      name: m.name,
      sessionName: m.sessionName,
      role: m.role || null,
      state: m.present && m.tied ? m.state : 'unknown',
      present: Boolean(m.present),
      family: m.tied ? familyOf(m.runner) : null,
      model: (card && (card.modelName || card.model)) || null,
      /* Only for a member tied to its pane (round 1): a stranger's pane holding the name must not have a folder
         derived from that name reported as this member's summary. */
      summary: m.tied ? summaryFreshness(folderOf(m.sessionName), opts.now) : { state: 'nofolder', file: null, at: null, ageMinutes: null },
    };
  });
  return {
    id: p.id,
    name: p.name,
    folder: p.folder || null,
    archived: p.archived === true,
    description: p.description || '',
    goal: brief.goal,
    done: brief.done,
    briefFound: brief.found === true,
    members,
    tasks: openTasks(p.tasks),
  };
}

/** The payload for the list: one short row per project. */
function listOf(described) {
  return (Array.isArray(described) ? described : []).map((p) => {
    const members = p.agents || [];
    const families = [...new Set(members.filter((m) => m.tied).map((m) => familyOf(m.runner)).filter(Boolean))];
    return {
      id: p.id,
      name: p.name,
      archived: p.archived === true,
      folder: p.folder || null,
      members: members.length,
      families,
      /* Members waiting on the person at all, whichever project their question is about: the project's own
         summary.needsYou counts only questions tied to this project, and an agent whose question is not tied
         to any is still waiting (measured: a Codex member asking read 0 there). */
      needsYou: members.filter((m) => m.present && m.tied && m.state === 'needs_you').length,
      tasks: openTasks(p.tasks),
    };
  });
}

/* Text from a person or a file, printed on one line: control characters and line breaks become spaces,
   so a name or a brief can never print a line of its own. */
function one(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    /* Bidi overrides and isolates, and zero-width characters: they print nothing themselves but can make the
       rest of a line display reversed or hidden, so a name or a brief could look like something it is not. */
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim();
}
function ago(minutes) {
  if (minutes == null) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  const h = Math.floor(minutes / 60);
  if (h < 48) return h + 'h ' + (minutes % 60) + 'm ago';
  return Math.floor(h / 24) + ' days ago';
}
function taskLine(t) {
  if (!t || !t.total) return 'no tasks yet';
  return t.open + ' open' + (t.built ? ' (' + t.built + ' built)' : '') + ', ' + (t.total - t.open) + ' done';
}

/** `kosmos project list`, as lines of text. */
function renderList(payload) {
  const rows = payload && Array.isArray(payload.projects) ? payload.projects : [];
  if (!rows.length) return ['No projects yet. Make one: kosmos project create "<name>" <folder>'];
  const out = [];
  for (const r of rows) {
    const fam = r.families && r.families.length ? r.families.map(one).join(', ') : 'no family we can tell';
    out.push(one(r.id) + '  ' + one(r.name) + (r.archived ? '  [archived]' : '')
      + '  | ' + r.members + (r.members === 1 ? ' member' : ' members') + ' (' + fam + ')'
      + '  | tasks: ' + taskLine(r.tasks)
      + (r.needsYou ? '  | ' + r.needsYou + ' waiting on the person' : ''));
  }
  out.push('Details: kosmos project show <id>');
  if (payload && payload.agentsUnreadable) out.push('(We could not read the agents on this computer just now, so members are listed without their state.)');
  return out;
}

const SUMMARY_WORDS = {
  current: (s) => 'current (' + s.file + ', ' + ago(s.ageMinutes) + ')',
  stale: (s) => 'older than the ' + SUMMARY_RHYTHM_HOURS + '-hour rhythm (' + s.file + ', ' + ago(s.ageMinutes) + ')',
  none: () => 'none yet',
  nofolder: () => 'we do not know where its folder is',
  future: (s) => 'dated in the future (' + s.file + '), so we cannot tell how current it is',
  unreadable: () => 'we could not look',
};

/** `kosmos project show <id>`, as lines of text. */
function renderShow(payload) {
  const p = payload && payload.project;
  if (!p) return ['there is no project by that name'];
  const out = [];
  out.push(one(p.name) + '  (id: ' + one(p.id) + ')' + (p.archived ? '  [archived]' : ''));
  out.push('Folder: ' + (p.folder ? one(p.folder) : 'none recorded'));
  /* The brief is a file anyone on the project can edit, so its words are quoted as written there, never
     presented as an instruction (the Assigner quotes the goal the same way, engine/assigner.js). */
  if (!p.briefFound) {
    out.push('Brief: there is no readable BRIEF.md in the folder, so no goal or "done" is written down.');
  } else {
    /* Double quotes inside become single (round 1), so the brief's words cannot close the quotation early and read
       as Kosmos's own; the same rule as a webhook task's words (install/kosmos task list). */
    const quoted = (t) => '"' + one(t).replace(/["\u201C\u201D]/g, "'") + '"';
    out.push('Goal (as written in BRIEF.md): ' + (p.goal ? quoted(p.goal) : 'not filled in yet'));
    out.push('Done looks like (as written in BRIEF.md): ' + (p.done ? quoted(p.done) : 'not filled in yet'));
  }
  out.push('Tasks: ' + taskLine(p.tasks) + (p.tasks && p.tasks.total ? '. List them: kosmos task list ' + one(p.id) : ''));
  const members = Array.isArray(p.members) ? p.members : [];
  out.push('Members (' + members.length + '):');
  if (!members.length) out.push('  nobody yet');
  for (const m of members) {
    const fam = m.family ? one(m.family) + (m.model ? ', ' + one(m.model) : '') : 'family unknown';
    const sum = (SUMMARY_WORDS[m.summary && m.summary.state] || SUMMARY_WORDS.unreadable)(m.summary || {});
    out.push('  ' + one(m.name) + (m.role ? ', ' + one(m.role) : '') + '  | ' + fam + '  | ' + (m.present ? one(m.state).replace(/_/g, ' ') : 'not running')
      + '  | summary: ' + sum);
  }
  return out;
}

module.exports = { summaryFreshness, familyOf, overviewOf, listOf, renderList, renderShow, SUMMARY_RHYTHM_HOURS };
