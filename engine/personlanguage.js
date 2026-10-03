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
 * not built). A sure read (either of those) is kept for the process, the override included; a failed one is retried
 * after FALLBACK_MS (5 minutes). Only those two act. Node's Intl locale is the only other source, and it is ICU's user locale (the
 * REGION setting on Windows, LANG on Linux), not the display language, so it neither adds nor removes a block: off a
 * Mac, and on a Mac whose read failed, an agent's file is left exactly as it is. A sure English read writes no block
 * and removes one an agent already has.
 *
 * Where it sits: appended at the end when it is missing, then replaced where it is; never moved. Measured: end and top
 * of the file 2/2 each (April), and at 64% of a 7,670-word file 2/2 (10-02), so no position depends on where it sits.
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
    const out = (run || ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })))('/usr/bin/defaults', ['read', '-g', 'AppleLanguages']);   // absolute, as machine.js does: never whatever is first on PATH
    // The FIRST element of the array only (review 8): an entry that does not parse is not sure, never the second one.
    const first = String(out).replace(/^\s*\(\s*/, '').split(/[,)\n]/)[0].trim().replace(/^"|"$/g, '');
    return /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/.test(first) ? normalise(first) : null;
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
let cached;   // a SURE read is kept for the process (a language changed while the board runs reaches new agents at
              // the next board start); a fallback is read again once FALLBACK_MS has passed
let fallbackAt = 0;
const FALLBACK_MS = 5 * 60 * 1000;   // review 4: a hanging `defaults` (2 s timeout, synchronous: it blocks the whole board's
                                     // event loop) is asked at most once per window, not on every create
function read(o) {
  if (!o && cached !== undefined && (cached.sure || Date.now() - fallbackAt < FALLBACK_MS)) return cached;
  if (!o) { const got = read(source || {}); cached = got; fallbackAt = got.sure ? 0 : Date.now(); return got; }
  const opts = o;
  const env = opts.env || process.env;
  // A 2 or 3 letter language subtag, as the Mac read requires: BCP 47 also allows 5 to 8 letters, so "english" would be
  // a (wrong) tag that reads as a sure non-English language (review 11).
  const forcedRaw = normalise(env.AGENT_WORKFORCE_PERSON_LOCALE);
  const forced = forcedRaw && /^[a-z]{2,3}(-|$)/i.test(forcedRaw) ? forcedRaw : null;
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
    // Language plus script, never the region (review 19): zh-Hant is "Traditional Chinese", not "Chinese", since the
    // script decides what the person can read; the region (es-MX) only changes the tag beside the name.
    const loc = new Intl.Locale(tag);
    // Chinese with no script in the tag (zh-HK, zh-TW, zh-MO, as Apple writes them): infer it, so Hong Kong and Taiwan
    // read "Traditional Chinese" (review 21). Only for Chinese: maximize() would turn "es" into "Spanish (Latin)".
    const script = loc.script || (loc.language === 'zh' ? loc.maximize().script : undefined);
    const base = script ? `${loc.language}-${script}` : loc.language;
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
    /* #5050 follow-up (Renet, 2026-10-03): the community is one shared English channel, and #5108's bug triage groups
       --kosmos-bug reports by the words in their titles, so a report in another language would neither group nor
       match a card. Measured before shipping (see the plan). */
    'Posts to the Kosmos+ community, including Kosmos bug reports, stay in English, so every agent and the people who read them can follow.'
  ].join('\n');
}

/** `text` with the block for `tag` at its end, or without the block when the language is English. */
function applyTo(text, tag) {
  const body = blockBody(tag);
  const str = String(text == null ? '' : text);
  if (!body) {
    const at0 = projects.findBlock(str, START, END);
    // With the person's (or anyone's) text after it, cut exactly the block and keep one blank line between what remains
    // (review 11: removeBlock joins the paragraphs across the gap). Last in the file: removeBlock, byte for byte.
    if (at0 && !at0.ambiguous && str.slice(at0.end).trim()) return cutOut(str, at0);
    return projects.removeBlock(str, START, END);
  }
  /* Replaced where it sits, or appended when missing; never moved (review 15). Every measured position held (end, top,
     64%), so a move would only rewrite the file, rotate the person's one-deep undo and prompt a restart for nothing.
     Byte-equal when nothing changed, so no write. Two blocks: spliceBlock returns the text unchanged. */
  return projects.spliceBlock(str, body, START, END);
}

/* `str` without the block at `at`, what was before and after it rejoined with one blank line in the file's own line
   ending. Only line breaks at the seam are trimmed; everything after the block, its end included, stays as written. */
function cutOut(str, at) {
  const eol = str.includes('\r\n') ? '\r\n' : '\n';   // the file's own line ending, as dmfiles.spliceTop keeps it (review 21)
  const before = str.slice(0, at.start).replace(/(\r?\n)+$/, '');
  const rest = str.slice(at.end).replace(/^(\r?\n)+/, '');   // the text after it is otherwise left exactly as it was
  if (!rest) return before ? before + eol : '';
  return before ? before + eol + eol + rest : rest;
}


/* Whether anything (a file, a link, a folder) is at `p`; lstat, so a dangling link counts as something. */
function somethingAt(p) {
  if (!p) return false;
  try { require('node:fs').lstatSync(p); return true; } catch { return false; }
}

/** Put the block in (or take it out of) one agent's instructions. connections.tellAgent's guards, minus its bypass. */
function tellAgent(sessionName, roster, opts) {
  try {
    if (!projects.heldExactly(sessionName, roster)) {   // no "trusted" bypass: nothing here needs one (review 13)
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
    // Nothing at the instructions path (no file, or no folder at all, as for an agent with no worker folder): this module
    // never creates one, so there is nothing to change and nothing to report, in any language (review 14). Something
    // there that cannot be read safely is not that: it is reported, as connections.tellAgent does (review 15).
    if (!current.exists && !somethingAt(current.path)) return { state: projects.TOLD.TOLD, because: null };
    if (!current.exists) return { state: projects.TOLD.COULD_NOT, because: current.because || 'it keeps its instructions somewhere we cannot safely change' };
    const found = projects.findBlock(current.text || '', START, END);
    if (found && found.ambiguous) {
      return {
        state: projects.TOLD.COULD_NOT,
        because: `its instructions contain ${found.pairs} Kosmos language blocks, so we cannot tell which is ours and did not change anything`,
      };
    }
    const next = applyTo(current.text || '', got.tag);
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
