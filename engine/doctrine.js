'use strict';

/**
 * The consented refresh of the working rules (#539): what a person's click
 * adds to an instruction file they own, composed here and NOWHERE ELSE.
 *
 * The constraint the whole card hangs on (Mona Lisa's, on the card): role
 * text is PERSON-OWNED after creation and deliberately never rewritten.
 * This module is allowed near it because nothing here is silent and the
 * person is the author of the change: the click on the ruled dialog is the
 * same act as pasting the missing sections in themselves, with Kosmos
 * holding the pen. Anything that writes without the click, or touches a
 * byte outside the managed span, breaks the ownership rule for real and
 * should be reverted on sight.
 *
 * Built to Angel's nine constraints (2026-08-24, read from the code, on
 * the card's thread), each carried where it bites:
 *
 *   1/7  the marker pair is CONSTANT, defined in projects.js and in
 *        ALL_MARKERS(), so neutralise() knows it and findBlock can find
 *        the span forever (a dated marker could never be re-found, and the
 *        next refresh would append a second block);
 *   2    nothing user-derived enters the span -- every byte is defaults.js's
 *        own text plus Mona Lisa's sentences -- so there is nothing to
 *        neutralise, which is stated rather than discovered;
 *   3    ONE composition, two readers: the dialog shows what planFor
 *        composed and the click writes THAT file text, proven by hash;
 *   4    a true no-op never writes: nothing-missing composes nothing, and
 *        an up-to-date span is detected on its SECTION CONTENT before any
 *        dated sentence is composed, so a byte never moves for a date;
 *   5    ambiguity refuses with a reason and never reports success on an
 *        unchanged return;
 *   6    everything outside the markers is untouched because the only
 *        writer is projects.spliceBlock; no hand edits anywhere, EXCEPT
 *        (#4890) an unedited plain copy of an earlier block, which is
 *        Kosmos's own text: it is cut out byte for byte (pastBlockIn) and
 *        its place taken by the span;
 *   8    presence is per-section by HEADING across the WHOLE file, managed
 *        or not: an old agent carrying the doctrine as plain text appends
 *        NOTHING, unless (#4890) that text is an unedited earlier block,
 *        which is offered the current rules in its place;
 *   9    section text comes from defaults.js's one source (#629), so a
 *        refreshed block byte-matches what a fresh birth writes.
 */

const crypto = require('node:crypto');
const defaults = require('./defaults');
const projects = require('./projects');
const instructions = require('./instructions');
const store = require('./store');
const PAST = require('./doctrine-past');

const START = projects.DOCTRINE_START;
const END = projects.DOCTRINE_END;

/** The click-day date, in the plain form Mona Lisa's sentence carries. */
function clickDate(now) {
  const d = now instanceof Date ? now : new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/* Mona Lisa's sentences (her ruling, verbatim): the dated one is the FIRST
   line inside the constant markers, never the marker itself. "Kosmos may
   update this block" is TRUE: a later consented refresh recomposes the
   span through this same module. */
function openingLine(now) {
  return `<!-- Kosmos added the working rules below on ${clickDate(now)}, with your OK. Kosmos may update this block when the rules change; your own words above and below it are never touched. -->`;
}
const CLOSING_LINE = '<!-- end of the working rules -->';
/* #4890: the same frame at birth, where nobody clicked. It starts with the words sectionContentOf strips, so a
   refresh compares the rules and never this line. */
function birthLine(now) {
  return `<!-- Kosmos added the working rules below on ${clickDate(now)}, when it made this agent. Kosmos may update this block when the rules change, with your OK; your own words above and below it are never touched. -->`;
}

/** The span body for a given set of sections, dated the day of the click (or of the birth, given `opening`). */
function spanBody(sectionsList, now, opening) {
  return [opening || openingLine(now), '', sectionsList.map((s) => s.text).join('\n'), '', CLOSING_LINE].join('\n');
}

/**
 * #4890: the working rules as an agent is BORN with them, inside the managed span, so a later change under an
 * existing heading reaches it through the consented refresh. Before this, birth wrote them as plain text
 * (defaults.appendTo) and planFor can offer a plain file only the headings it lacks, so such a change reached
 * new agents only. Text that already carries the rules is returned as it is; text that already holds a
 * doctrine marker (pasted from another agent's file) gets the plain block rather than a span spliced among
 * markers it did not write.
 */
function atBirth(text, now, maxBytes) {
  const body = String(text == null ? '' : text);
  if (body.includes(defaults.RULES_PHRASE)) return body;
  if (body.includes(START) || body.includes(END)) return defaults.appendTo(body);
  const spanned = projects.spliceBlock(body, spanBody(defaults.sections(), now, birthLine(now)), START, END);
  /* The frame costs a few hundred bytes. Where only the plain block fits under the caller's cap, the agent gets
     the plain block (as before #4890) rather than none. */
  if (maxBytes && Buffer.byteLength(spanned, 'utf8') > maxBytes) return defaults.appendTo(body);
  return spanned;
}

/**
 * #4890: where an unedited plain copy of an EARLIER block sits in this text, or null. "Unedited" is a byte match
 * against a fingerprint in doctrine-past.js, starting at the rules' first heading line and ending at a line end. The current block is in
 * that table too and is not reported here: a plain copy of today's rules has nothing to update.
 */
function pastBlockIn(body, past, skip) {
  const first = defaults.sections()[0].heading;
  const current = defaults.block();
  const rows = past || PAST;
  for (let at = body.indexOf(first); at >= 0; at = body.indexOf(first, at + 1)) {
    if (at > 0 && body[at - 1] !== '\n') continue;
    if (skip && at < skip.end && at >= skip.start) continue;   // earlier rules inside a span are the span path's
    for (const row of rows) {
      const slice = body.slice(at, at + row.length);
      if (slice.length !== row.length || slice === current) continue;
      const after = body[at + row.length];
      if (after !== undefined && after !== '\n' && after !== '\r') continue;   // words typed onto its last line are an edit
      if (crypto.createHash('sha256').update(slice).digest('hex') === row.sha256) return { start: at, end: at + row.length, version: row.version };
    }
  }
  return null;
}

/** The section content of a span body, with the dated frame taken off, so
    up-to-date-ness is decided on the RULES, never on the date (constraint 4:
    a write that only re-dates the sentence is a write for nothing). */
function sectionContentOf(spanInner) {
  return String(spanInner == null ? '' : spanInner)
    .split('\n')
    .filter((line) => !line.startsWith('<!-- Kosmos added the working rules below on ')
      && line !== CLOSING_LINE)
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * What a refresh would do to this text, composed ONCE. Pure. Returns:
 *   { state: 'could_not', because }                     ambiguity, refused
 *   { state: 'current' }                                nothing to add; NO write may follow
 *   { state: 'refresh', sections, spanNext, fileNext, hash, replacing? }
 *
 * `replacing` (#4890) is true when the click also removes an unedited plain
 * copy of an earlier block. `past` is the fingerprint table, for tests only;
 * engine/doctrine-past.js otherwise.
 *
 * `sections` is what the dialog lists; `fileNext` is what a click writes;
 * `hash` is how the click proves it consents to THIS composition and not a
 * file that changed since the dialog (the could-not arm of the race is an
 * honest "look again", never a write on a guess).
 */
function planFor(text, now, past) {
  const body = String(text == null ? '' : text);
  const found = projects.findBlock(body, START, END);
  if (found && found.ambiguous) {
    return { state: 'could_not', because: `its instructions contain ${found.pairs} Kosmos working-rules blocks, so we cannot tell which is ours and did not change anything` };
  }
  /* #4890: a plain copy of an EARLIER block, byte for byte, is Kosmos's own text that nobody edited, so the
     click may replace it with the current rules. Only a copy OUTSIDE any span counts: a span holds earlier
     rules too, and those are brought current by the span path below. */
  const old = pastBlockIn(body, past, found || null);
  if (old && !(found && old.start < found.end && old.end > found.start)) {
    const all = defaults.sections();
    if (found) {
      /* A span AND a plain old copy (a person who clicked an earlier refresh that added only missing headings):
         the copy goes, and the span takes every section, so a same-heading change reaches this agent too. */
      const without = body.slice(0, old.start) + body.slice(old.end).replace(/^\r?\n/, '');
      const plan = planFor(without, now, past);
      if (plan.state === 'refresh') return { ...plan, replacing: true };
      if (plan.state === 'current') return { state: 'refresh', replacing: true, sections: [], spanNext: '', fileNext: without, hash: hashOf(without) };
      return plan;
    }
    /* No span: the span takes the copy's place. A heading the person also carries outside it is theirs and is
       not written again (constraint 8, as the span path below does). */
    const outside = body.slice(0, old.start) + body.slice(old.end);
    const wanted = all.filter((s) => !outside.includes(s.heading));
    if (wanted.length) {
      const spanNext = spanBody(wanted, now);
      const fileNext = body.slice(0, old.start) + `${START}\n${spanNext}\n${END}` + body.slice(old.end);
      return { state: 'refresh', replacing: true, sections: wanted, spanNext, fileNext, hash: hashOf(fileNext) };
    }
  }
  if (found) {
    /* An existing managed span: its sections are OURS to bring current;
       sections a person carries OUTSIDE the span are theirs and are never
       duplicated (whole-file heading presence decides "outside"). */
    /* ⚠️ THE READ BOUNDARY MATCHES THE WRITE BOUNDARY (Angel's review of
       #637): spliceBlock replaces to the FIRST end after start (found.end),
       so the span is read to exactly there. A lastIndexOf(END) here jumped
       to a stray END marker in the person's prose after the block, over-
       extended the read into their words, misclassified an up-to-date file
       as refresh (a write for a non-change, rotating their one-deep undo)
       and pulled prose headings into the composed block. The write was
       always bounded; the read now is too. */
    const spanInner = body.slice(body.indexOf('\n', found.start) + 1, found.end - END.length);
    const outside = body.slice(0, found.start) + body.slice(found.end);
    const wanted = defaults.sections().filter((s) => spanInner.includes(s.heading) || !outside.includes(s.heading));
    if (!wanted.length) return { state: 'current' };
    const wantedContent = wanted.map((s) => s.text).join('\n');
    if (sectionContentOf(spanInner) === wantedContent) return { state: 'current' };
    const spanNext = spanBody(wanted, now);
    const fileNext = projects.spliceBlock(body, spanNext, START, END);
    return { state: 'refresh', sections: wanted, spanNext, fileNext, hash: hashOf(fileNext) };
  }
  /* No span: an agent born with the doctrine as plain text, or born before
     it. Only genuinely absent sections are offered (constraint 8); a file
     carrying every section as the person's own text appends NOTHING. */
  const missing = defaults.missingFrom(body);
  if (!missing.length) return { state: 'current' };
  const spanNext = spanBody(missing, now);
  const fileNext = projects.spliceBlock(body, spanNext, START, END);
  return { state: 'refresh', sections: missing, spanNext, fileNext, hash: hashOf(fileNext) };
}

function hashOf(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

/**
 * What the banner and the dialog need for one agent, no write anywhere.
 */
function status(sessionName, now) {
  const current = instructions.read(sessionName);
  if (!current.exists) {
    return { state: 'could_not', because: current.because || 'it has no instructions file yet' };
  }
  const plan = planFor(current.text || '', now);
  let profile = {};
  try { profile = store.readProfile(sessionName) || {}; } catch { profile = {}; }
  return {
    ...plan,
    carried: Number.isFinite(profile.doctrineVersion) ? profile.doctrineVersion : null,
    currentVersion: defaults.DOCTRINE_VERSION,
    declined: profile.doctrineDeclined === defaults.DOCTRINE_VERSION,
  };
}

/**
 * The consented write, the reports.tellAgent shape: gate, read, plan,
 * refuse-or-write, and a verdict in a sentence. `expectHash` is the hash
 * the dialog showed; a file that changed since then refuses with "look
 * again" rather than writing a composition nobody saw.
 */
function refresh(sessionName, roster, opts) {
  try {
    const vouched = !!(opts && opts.trusted);
    if (!vouched && !projects.heldExactly(sessionName, roster)) {
      return {
        state: 'could_not',
        because: !Array.isArray(roster)
          ? 'we could not check which agents are running'
          : roster.some((a) => a && a.sessionName === sessionName)
            ? 'something is running under this name, but we cannot tell that it is this agent'
            : 'we could not find an agent with exactly this name on this computer',
      };
    }
    const current = instructions.read(sessionName);
    if (!current.exists && !current.editable) {
      return { state: 'could_not', because: current.because || 'it keeps its instructions somewhere we cannot safely change' };
    }
    if (!current.exists) {
      return { state: 'could_not', because: 'it has no instructions file yet, and we will not create one' };
    }
    const plan = planFor(current.text || '', opts && opts.now);
    if (plan.state === 'could_not') return plan;
    if (plan.state === 'current') {
      /* Already has them: said, never silent, and NOTHING is written --
         not even a re-dated sentence (constraint 4: a no-op write rotates
         the person's one-deep .previous undo for a non-change). */
      return { state: 'current' };
    }
    /* Two consent strengths, each stated where it is enforced (Angel's
       review, decision recorded): the PER-AGENT route REQUIRES the hash,
       so that path's "the click writes exactly what the dialog showed" is
       enforced, not asserted; the FLEET path passes none, deliberately --
       its dialog lists NAMES, and Mona Lisa's ruling makes the fleet click
       name-level consent ("consent for the listed names only"), with the
       freshly-composed write still incapable of wrong bytes. A stale hash
       refuses with look-again rather than writing a composition nobody
       saw; the hash embeds the click-day date, so a dialog opened at 23:59
       and clicked at 00:01 refuses falsely once and the retry works --
       known, benign, and cheaper than a dateless hash. */
    if (opts && opts.expectHash && opts.expectHash !== plan.hash) {
      return { state: 'could_not', because: 'its instructions changed since you looked, so nothing was written; look again' };
    }
    /* The write: the SAME fileNext the plan composed and the dialog hashed.
       spliceBlock already preserved every byte outside the markers. */
    instructions.write(sessionName, plan.fileNext, current.version, undefined,
      { who: 'kosmos', because: plan.replacing ? 'replaced its older working rules with the current ones, with your OK' : 'added the working rules, with your OK' });
    try {
      store.writeProfile(sessionName, { doctrineVersion: defaults.DOCTRINE_VERSION });
    } catch { /* the file is the truth; the record catches up on the next write */ }
    return { state: 'added', sections: plan.sections.map((s) => s.heading) };
  } catch (err) {
    const raw = (err && err.message) || '';
    return {
      state: 'could_not',
      because: /larger than an instruction file should be/.test(raw)
        ? 'its instructions are already at the size limit'
        : (raw || 'we could not write to its instructions'),
    };
  }
}

/** "Not now", remembered server-side per agent until the rules themselves
    change: keyed on the version, so a future bump un-hides the banner. */
function decline(sessionName) {
  try {
    store.writeProfile(sessionName, { doctrineDeclined: defaults.DOCTRINE_VERSION });
    return { declined: true };
  } catch {
    return { declined: false, because: 'we could not save that choice' };
  }
}

module.exports = { START, END, spanBody, clickDate, planFor, status, refresh, decline, hashOf, atBirth, birthLine, pastBlockIn };
