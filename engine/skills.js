'use strict';

/**
 * Skills an agent can be given (#477, #478): folders of SKILL.md files in the
 * two places the runtime actually reads. GLOBAL is the user-level directory
 * every agent loads because every agent runs as this user — global by
 * construction, no distribution machinery to drift. PER-AGENT is the agent's
 * own workspace directory, loaded for sessions started there.
 *
 * The list is always READ FROM DISK, never from a record that can disagree
 * with what the runtime will load. An unreadable directory answers ok:false
 * with a sentence, never an empty list (unreadable-as-empty is the lie this
 * codebase keeps hunting).
 *
 * Adding writes the runtime's own convention, read from a real skill on this
 * machine before this file was written: <dir>/<slug>/SKILL.md with `name:`
 * and `description:` frontmatter. No overwrite: a skill that exists is a
 * refusal, not a replace, because replacing silently loses somebody's work.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_BODY = 64 * 1024;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function globalDir() {
  return process.env.AGENT_WORKFORCE_SKILLS_DIR
    || path.join(os.homedir(), '.claude', 'skills');
}

function agentDir(workerDir) {
  return path.join(workerDir, '.claude', 'skills');
}

function slugFor(name) {
  return String(name == null ? '' : name).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/* Frontmatter, best-effort: the two fields the screens show. A file with no
   frontmatter is still a skill (the runtime loads it); it lists by folder
   name with no description rather than being hidden. */
function readMeta(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8').slice(0, 8192); } catch { return null; }
  const meta = { name: null, description: null, title: null };
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (m) {
    const n = m[1].match(/^name:\s*(.+)$/m);
    const d = m[1].match(/^description:\s*(.+)$/m);
    if (n) meta.name = n[1].trim();
    if (d) meta.description = d[1].trim();
  }
  /* The first heading after the frontmatter is the human title: the
     convention wants name: to be the slug, and a slug is not a thing to
     show a person. */
  const body = m ? text.slice(m[0].length) : text;
  const h = body.match(/^#\s+(.+)$/m);
  if (h) meta.title = h[1].trim();
  return meta;
}

function list(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      // No directory yet is a real, ordinary answer: no skills.
      return { ok: true, skills: [] };
    }
    return { ok: false, because: 'we could not read the skills folder', skills: [] };
  }
  const skills = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const file = path.join(dir, ent.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const meta = readMeta(file) || {};
    skills.push({
      key: ent.name,
      name: meta.title || meta.name || ent.name,
      description: meta.description || null,
    });
  }
  skills.sort((a, b) => a.key.localeCompare(b.key));
  return { ok: true, skills };
}

function add(dir, { name, body } = {}) {
  const slug = slugFor(name);
  if (!slug || !SLUG_RE.test(slug)) {
    return { ok: false, because: 'give the skill a short name in letters and numbers' };
  }
  const text = String(body == null ? '' : body).trim();
  if (!text) {
    return { ok: false, because: 'write what the skill should do; an empty skill teaches nothing' };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY) {
    return { ok: false, because: 'that is longer than a skill file should be' };
  }
  const home = path.join(dir, slug);
  if (fs.existsSync(home)) {
    return { ok: false, because: `there is already a skill called ${slug}; pick another name rather than replacing it` };
  }
  const shown = String(name).trim().slice(0, 80);
  /* The description the list will show: the body's first line, capped. */
  const firstLine = text.split('\n')[0].slice(0, 200);
  const file = [
    '---',
    `name: ${slug}`,
    `description: ${firstLine}`,
    '---',
    '',
    `# ${shown}`,
    '',
    text,
    '',
  ].join('\n');
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'SKILL.md'), file, 'utf8');
  } catch {
    return { ok: false, because: 'we could not write the skill file' };
  }
  return { ok: true, key: slug };
}

/**
 * Take a skill out. The whole folder goes, because SKILL.md may sit beside
 * assets the convention allows; a missing skill is a refusal with a sentence,
 * not a silent success, so a double-click tells the truth twice.
 */
function remove(dir, key) {
  const slug = String(key == null ? '' : key).trim();
  if (!SLUG_RE.test(slug)) return { ok: false, because: 'that is not a skill name we can look up' };
  const home = path.join(dir, slug);
  if (!fs.existsSync(path.join(home, 'SKILL.md'))) {
    return { ok: false, because: 'there is no skill by this name here' };
  }
  try {
    fs.rmSync(home, { recursive: true });
  } catch {
    return { ok: false, because: 'we could not remove the skill folder' };
  }
  return { ok: true };
}

module.exports = { globalDir, agentDir, list, add, remove, slugFor };
