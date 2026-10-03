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
 * The language comes from this computer's setting: on a Mac the first preferred language (`defaults read -g
 * AppleLanguages`), or the AGENT_WORKFORCE_PERSON_LOCALE override (the test runners set it to en; a Settings picker is
 * not built). Only those two act. Node's Intl locale is the only other source, and it is ICU's user locale (the
 * REGION setting on Windows, LANG on Linux), not the display language, so it neither adds nor removes a block: off a
 * Mac, and on a Mac whose read failed, an agent's file is left exactly as it is. A sure English read writes no block
 * and removes one an agent already has.
 *
 * Where it sits: writing the block takes it out and appends it again, so it ends the file, where April measured it
 * (top of file was 2/2 too; mid-file is untested). A block added later goes behind it until the next board start,
 * whose sweep runs last and moves it back.
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
  if (!s || s === 'C' || s === 'POSIX' || /^und(-|$)/i.test(s)) return null;
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
 * The person's locale and how it was read: `{ tag, sure }`. The override and a Mac's `defaults` answer are sure;
 * Node's Intl locale is a fallback (the region setting on Windows, LANG elsewhere, or a Mac whose `defaults` read failed
 * or timed out), and a fallback changes nothing: one bad read at a busy boot must not strip every agent's block, and a
 * region setting must not put agents into a language the person does not read. `o` is a test seam
 * ({ env, platform, run, intl }); production passes nothing.
 */
let source = null;   // test seam: what the no-argument read reads (production: the real machine)
let cached;   // a SURE read is kept for the process; a fallback is read again once FALLBACK_MS has passed
let fallbackAt = 0;
const FALLBACK_MS = 5 * 60 * 1000;   // review 4: a hanging `defaults` (2 s timeout) must not stall every create
function read(o) {
  if (!o && cached !== undefined && (cached.sure || Date.now() - fallbackAt < FALLBACK_MS)) return cached;
  if (!o) { const got = read(source || {}); cached = got; fallbackAt = got.sure ? 0 : Date.now(); return got; }
  const opts = o;
  const env = opts.env || process.env;
  const forced = normalise(env.AGENT_WORKFORCE_PERSON_LOCALE);
  if (forced) return { tag: forced, sure: true };
  if ((opts.platform || process.platform) === 'darwin') {
    const mac = macPreferred(opts.run);
    if (mac) return { tag: mac, sure: true };
  }
  let tag = null;
  try { tag = normalise(opts.intl !== undefined ? opts.intl : Intl.DateTimeFormat().resolvedOptions().locale); } catch { tag = null; }
  return { tag, sure: false };
}
/** The person's locale (the tag alone). */
function detect(o) { return read(o).tag; }

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

/** `text` with the block for `tag` at its end, or without the block when the language is English. */
function applyTo(text, tag, opts) {
  const body = blockBody(tag);
  // A read that is not sure changes nothing, in either direction (see read()).
  if (opts && opts.keep) return String(text == null ? '' : text);
  if (!body) return projects.removeBlock(text, START, END);
  // Already the last thing in the file (or not there yet): replaced in place, or appended. Otherwise taken out and
  // appended again, so it ends the file. In place is byte-equal when nothing changed, so no write.
  const at = projects.findBlock(String(text == null ? '' : text), START, END);
  const last = !at || at.ambiguous || !String(text).slice(at.end).trim();
  return projects.spliceBlock(last ? text : projects.removeBlock(text, START, END), body, START, END);
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
    const got = opts && Object.prototype.hasOwnProperty.call(opts, 'tag') ? { tag: opts.tag, sure: opts.sure !== false } : read();
    // Nothing to do (a read that is not sure changes nothing): told, without touching the file (review 4: no boot noise).
    if (!got.sure) return { state: projects.TOLD.TOLD, because: null };
    const current = instructions.read(sessionName);
    // English with no file, or one we may not change: there is no block to remove, so nothing to report either.
    if (!blockBody(got.tag) && !current.exists) return { state: projects.TOLD.TOLD, because: null };
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
    const next = applyTo(current.text || '', got.tag, { keep: !got.sure });
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
  const got = opts && Object.prototype.hasOwnProperty.call(opts, 'tag') ? { tag: opts.tag, sure: opts.sure !== false } : read();
  const told = [];
  for (const a of roster) {
    if (!a || !a.sessionName || a.isNamedOurs !== true) continue;
    told.push({ agent: a.sessionName, ...tellAgent(a.sessionName, roster, { tag: got.tag, sure: got.sure }) });
  }
  return told;
}

module.exports = { _resetForTests: (src) => { cached = undefined; fallbackAt = 0; source = src || null; }, _ageFallbackForTests: () => { fallbackAt -= FALLBACK_MS; }, START, END, normalise, macPreferred, read, detect, isEnglish, languageName, blockBody, applyTo, tellAgent, syncEveryone };
