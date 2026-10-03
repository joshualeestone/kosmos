'use strict';

/**
 * #5050 (the agent side of "Kosmos in other languages"): one managed block that names the person's language, so an
 * agent starts and posts in it.
 *
 * April measured it (#5050, 2026-10-02, Claude Sonnet with a real instruction file loaded): an agent whose first input
 * is one of Kosmos's English notices answers in English (2/2); the same agent with ONE line naming the person's
 * language answers, and drafts its room post, in that language (4/4, the line at the top or the end of the file).
 * Agents already follow a person who writes first; what they did not do is START in the person's language, because
 * Kosmos's own first words to them are English. So this block is the whole fix for that, and the ~7,500 words of
 * Kosmos instructions stay in English.
 *
 * The language comes from this computer's setting, read once per board start: on a Mac the first preferred language
 * (`defaults read -g AppleLanguages`), else Node's own locale (Intl), which follows the OS setting. English writes
 * no block, and an agent that has one loses it when the setting goes back to English, so an English computer is
 * exactly as before. AGENT_WORKFORCE_PERSON_LOCALE overrides the setting (tests; a Settings picker is not built).
 */

const { execFileSync } = require('node:child_process');
const projects = require('./projects');
const instructions = require('./instructions');

const START = projects.LANGUAGE_START;
const END = projects.LANGUAGE_END;
const WROTE_WHY = 'the person\'s language, from this computer\'s language setting (#5050)';

/* A BCP 47 tag, or null. Accepts the Mac's spellings too ("es_MX", "zh-Hans-CN"). */
function normalise(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/_/g, '-').replace(/\..*$/, '').replace(/@.*$/, '');
  if (!s || s === 'C' || s === 'POSIX') return null;
  try { return Intl.getCanonicalLocales(s)[0] || null; } catch { return null; }
}

/* The Mac's first preferred language, or null. `defaults` prints a plist array: ( "es-MX", "en-US" ). */
function macPreferred(run) {
  try {
    const out = (run || ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })))('defaults', ['read', '-g', 'AppleLanguages']);
    const m = String(out).match(/"?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)"?\s*,?\s*(?:\n|\))/);
    return m ? normalise(m[1]) : null;
  } catch { return null; }
}

/**
 * The person's locale: the override, else the Mac's preferred language, else Node's locale. `o` is a test seam
 * ({ env, platform, run, intl }); production passes nothing.
 */
function detect(o) {
  const opts = o || {};
  const env = opts.env || process.env;
  const forced = normalise(env.AGENT_WORKFORCE_PERSON_LOCALE);
  if (forced) return forced;
  if ((opts.platform || process.platform) === 'darwin') {
    const mac = macPreferred(opts.run);
    if (mac) return mac;
  }
  try { return normalise(opts.intl !== undefined ? opts.intl : Intl.DateTimeFormat().resolvedOptions().locale); } catch { return null; }
}

/* English (any region), unknown, or unreadable: no block. */
function isEnglish(tag) {
  return !tag || /^en(-|$)/i.test(tag);
}

/* The language's name in English ("Spanish"), or the tag itself when the runtime has no name for it. */
function languageName(tag) {
  try {
    const base = new Intl.Locale(tag).language;
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(base);
    return name && name !== base ? name : tag;
  } catch { return tag; }
}

/** The block's words for this locale, or null for English (no block). */
function blockBody(tag) {
  if (isEnglish(tag)) return null;
  const name = languageName(tag);
  /* April's tested variant A word for word (appended at the end of the file: Spanish 2/2 against English 2/2 with no
     block), plus the one sentence she carried over from variant B, which names the confusion the test exposed. */
  return [
    '## The person\'s language',
    '',
    `The person who runs this computer reads ${name} (${tag}, from this computer's language setting). Write to them, and in your project rooms, in ${name} unless they write to you in another language. Kosmos itself talks to you in English; that is not the person's language.`,
  ].join('\n');
}

/** `text` with the block for `tag`: spliced in when there is one, removed when the language is English. */
function applyTo(text, tag) {
  const body = blockBody(tag);
  return body ? projects.spliceBlock(text, body, START, END) : projects.removeBlock(text, START, END);
}

/** Put the block in (or take it out of) one agent's instructions. Same guards as connections.tellAgent. */
function tellAgent(sessionName, roster, opts) {
  try {
    const vouched = !!(opts && opts.trusted);
    if (!vouched && !projects.heldExactly(sessionName, roster)) {
      return {
        state: projects.TOLD.COULD_NOT,
        because: !Array.isArray(roster)
          ? 'we could not check which agents are running'
          : 'we could not find an agent with exactly this name on this computer',
      };
    }
    const tag = opts && Object.prototype.hasOwnProperty.call(opts, 'tag') ? opts.tag : detect();
    const current = instructions.read(sessionName);
    if (!current.exists && !current.editable) {
      return { state: projects.TOLD.COULD_NOT, because: current.because || 'it keeps its instructions somewhere we cannot safely change' };
    }
    if (!current.exists) {
      return { state: projects.TOLD.COULD_NOT, because: 'it has no instructions file yet, and we will not create one' };
    }
    const found = projects.findBlock(current.text || '', START, END);
    if (found && found.ambiguous) {
      return {
        state: projects.TOLD.COULD_NOT,
        because: `its instructions contain ${found.pairs} Kosmos language blocks, so we cannot tell which is ours and did not change anything`,
      };
    }
    const next = applyTo(current.text || '', tag);
    if (next === current.text) return { state: projects.TOLD.TOLD, because: null };
    instructions.write(sessionName, next, current.version, undefined, { who: 'kosmos', because: WROTE_WHY });
    return { state: projects.TOLD.TOLD, because: null };
  } catch (err) {
    const raw = (err && err.message) || '';
    return {
      state: projects.TOLD.COULD_NOT,
      because: /larger than an instruction file should be/.test(raw)
        ? 'its instructions are already at the size limit'
        : (raw || 'we could not write to its instructions'),
    };
  }
}

/** Every agent the board can name as ours; the language is read once for the whole sweep. */
function syncEveryone(roster, opts) {
  if (!Array.isArray(roster)) {
    return [{ agent: null, state: projects.TOLD.COULD_NOT, because: 'we could not check which agents are running' }];
  }
  const tag = opts && Object.prototype.hasOwnProperty.call(opts, 'tag') ? opts.tag : detect();
  const told = [];
  for (const a of roster) {
    if (!a || !a.sessionName || a.isNamedOurs !== true) continue;
    told.push({ agent: a.sessionName, ...tellAgent(a.sessionName, roster, { tag }) });
  }
  return told;
}

module.exports = { START, END, normalise, macPreferred, detect, isEnglish, languageName, blockBody, applyTo, tellAgent, syncEveryone };
