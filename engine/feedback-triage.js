'use strict';

/**
 * Smart triage for the daily product-feedback reports (kosmos#2246, the RECEIVE
 * side of #2037).
 *
 * Josh, 2026-09-05: capture the daily write-ups agents make about bugs and
 * improvements, and "have a smart process to review what things are good and
 * what we should add ... not just automatically getting it and blindly
 * implementing it or adding cards from it."
 *
 * 🔑 THIS MODULE NEVER OPENS A CARD AND NEVER IMPLEMENTS ANYTHING. It reads
 * feedback report bodies (as authored by `engine/feedback.js`) and produces a
 * ranked DRAFT digest a human reviewer works from: candidates that clear a
 * stated bar, likely noise (with the reason), and items that look like an
 * existing open card (so we do not re-file a duplicate). Card creation stays a
 * human action by construction: nothing here has a write path to GitHub.
 *
 * 🔒 ADVERSARIAL-INPUT SAFE. A report body is untrusted agent-authored text.
 * Everything here is pure string work: no eval, no regex built from report
 * content, nothing shelled out. A report cannot cause an action; the worst a
 * hostile body can do is land in the digest as a candidate, where a human sees
 * it before anything happens.
 *
 * Pure by design: `triage()` takes the reports and the open-card titles as
 * arguments and returns a plain object. It touches no disk and no network, so
 * it is unit-testable and cannot drift onto the wrong store. The CLI verb
 * (`kosmos feedback triage`) is the impure shell that reads the feedback store
 * and, optionally, the open-card titles, then calls in here.
 */

/** Words that, alone, carry no action -- pure sentiment or filler. An item made
 *  only of these (plus short glue) is noise, not a suggestion. */
const SENTIMENT = new Set([
  'love', 'loved', 'like', 'liked', 'great', 'good', 'nice', 'awesome',
  'amazing', 'cool', 'thanks', 'thank', 'thankyou', 'perfect', 'fine', 'ok',
  'okay', 'happy', 'excellent', 'wonderful', 'best', 'fantastic', 'super',
]);

/** Signals that an item names something concrete to change or fix. Presence of
 *  any of these lifts an item above the noise floor. Deliberately broad and
 *  advisory: the reviewer sees the reasons and can override. */
const ACTION = new Set([
  'error', 'errors', 'fail', 'failed', 'fails', 'failing', 'crash', 'crashed',
  'crashes', 'broke', 'broken', 'bug', 'wrong', 'incorrect', 'missing', 'cannot',
  'cant', 'couldnt', 'doesnt', 'wont', 'should', 'add', 'adds',
  'added', 'allow', 'support', 'confusing', 'confused', 'unclear', 'slow', 'hang',
  'hangs', 'hung', 'stuck', 'timeout', 'timed', 'instead', 'jump', 'jumps', 'jumping',
  // kosmos#4415: 'but', 'because', 'when', 'if', 'would', 'could' and 'expected' are gone: they are in nearly every
  // sentence (measured on the 39 live reports, 2026-09-28: 158 of 177 items cleared the bar), and 'expected' mostly
  // arrives as "worked as expected".
  'need', 'needs', 'needed', 'improve', 'better', 'fix',
  'unable', 'blocked', 'blocker', 'refused', 'rejected', 'empty', 'blank', 'lost',
  'duplicate', 'duplicated', 'twice', 'race', 'stale', 'silent', 'silently',
  // Visual / layout bugs are a big share of fresh-install feedback and rarely
  // use the words above, so name them explicitly or a real UI report ("the
  // label overlaps the icon") scores as noise.
  'overlap', 'overlaps', 'overlapping', 'clipped', 'cut', 'cutoff', 'hidden',
  'misaligned', 'misplaced', 'truncated', 'garbled', 'offscreen', 'overflow',
  'overflows', 'overflowing', 'cramped', 'tiny', 'huge', 'unreadable',
]);

/** kosmos#4415: words that NEGATE an action word shortly after them. "Nothing appears broken", "no errors", "did not
 *  crash" name a thing that went RIGHT; counting the action word made a clean report the top candidate (raised 7
 *  times in the live store). An action word within NEGATION_REACH words after one of these, IN THE SAME CLAUSE, does
 *  not count; a comma, a full stop, "and" or "but" ends a negation's reach ("never finishes, stuck forever" is a bug:
 *  the comma keeps `never` off `stuck`). A negated word is neutral, not evidence of a clean report: only the CLEAN
 *  phrases below say that ("didn't load" is a failure, not a success). */
const NEGATORS = new Set(['no', 'not', 'nothing', 'never', 'none', 'without', 'zero', 'didnt', 'isnt', 'wasnt', 'arent',
  'werent', 'nor', 'neither', 'rather']);   // 'rather': "ready for work rather than stuck or blocked" (live, 09-28)
const NEGATION_REACH = 4;   // 4, not 3: "rather than stuck or blocked" puts `blocked` four words after `rather`
/** A negator directly followed by one of these is an idiom about the reporter, not about the problem: "not sure why
 *  export crashed", "wasn't able to save", "not clear why it fails". It negates nothing. */
const NOT_NEGATING_NEXT = new Set(['sure', 'clear', 'certain', 'obvious', 'able', 'why', 'how', 'possible', 'only']);
const CLAUSE_BREAK = /[,.;:!?\n]+|\s(?:and|but)\s/i;

/** kosmos#4415: the report form's own questions (engine/roles.js, the daily report block), which come back as items
 *  of their own. Matched exactly, not by shape: a short line ending in "?" is often a real report ("Why does export
 *  crash?"). feedback-triage.test.js holds this list equal to roles.js. */
const FORM_QUESTIONS = [
  'What bugs did you hit today, or what did your user ask for that is not wired up yet?',
  'Is anything broken?',
  'What would make the app better, on the technical side or for the people using it?',
  'How are tasks going?',
];

/** kosmos#4415: an item made only of this kind of statement reports that nothing was wrong. */
const CLEAN = /\b(?:worked|works|working) (?:as expected|fine|correctly|well)\b|\bno (?:issues?|problems?|errors?|bugs?|crashes?)\b|\bnothing (?:appears |seemed |seems |was |is )?(?:broken|wrong|failed|off)\b|\bwithout (?:any )?(?:issues?|errors?|problems?)\b|\brather than (?:stuck|blocked|broken|failing|failed)\b/;

/** Stop-words removed before token overlap so two phrasings of one issue match. */
const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in',
  'on', 'at', 'it', 'its', 'this', 'that', 'these', 'those', 'and', 'or', 'for',
  'with', 'as', 'by', 'from', 'so', 'i', 'we', 'you', 'my', 'our', 'me', 'us',
  'do', 'did', 'does', 'have', 'has', 'had', 'not', 'no', 'yes', 'up', 'down',
]);

/** Lowercase, strip markdown emphasis/links/code, collapse to words. Shared by
 *  classification and matching so the two never disagree about an item's text. */
function normalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/`+/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [label](url) -> label
    .replace(/[*_>#~]/g, ' ')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Content tokens (normalized, stop-words removed, deduped-per-item for overlap). */
function tokens(text) {
  const seen = new Set();
  for (const w of normalize(text).split(' ')) {
    if (w && !STOP.has(w)) seen.add(w);
  }
  return seen;
}

/**
 * Split one report body into candidate items.
 *
 * The body is freeform markdown, but the pm-role instruction asks for "a short
 * note of what did not work and what would make it better", which in practice
 * is a list or a few short paragraphs. So: each top-level list item is one
 * candidate; each blank-line-separated paragraph that is not a heading is one
 * candidate. Headings are dropped (they label, they do not suggest). A list
 * item's wrapped continuation lines and sub-bullets fold into it.
 */
function parseItems(body) {
  const lines = String(body == null ? '' : body).split(/\r?\n/);
  const items = [];
  let current = null;
  let currentIndent = 0;
  const push = () => {
    if (current != null) {
      const t = current.trim();
      if (t) items.push(t);
    }
    current = null;
  };
  const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
  const heading = /^\s*#{1,6}\s+/;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') { push(); continue; }
    if (heading.test(line)) { push(); continue; }
    const m = line.match(bullet);
    if (m) {
      // A bullet more indented than the CURRENT item's bullet is a sub-point
      // and folds into it; a bullet at the same or lesser indent starts a new
      // item. Relative to the current item, not an absolute >=4: a whole list
      // that happens to be indented (every bullet at 4+) must still be N items,
      // not one item with N-1 sub-points folded in.
      const indent = (line.match(/^\s*/) || [''])[0].length;
      if (current != null && indent > currentIndent) {
        current += ' ' + m[1].trim();
      } else {
        push();
        current = m[1].trim();
        currentIndent = indent;
      }
    } else if (current != null) {
      // A continuation line of the current item (wrapped prose or a bullet's
      // second line).
      current += ' ' + line.trim();
    } else {
      // A bare paragraph line with no bullet: start a paragraph item. Reset the
      // fold baseline to 0 so a stale currentIndent from an earlier deeply-
      // indented bullet cannot make a following bullet fold into this paragraph.
      current = line.trim();
      currentIndent = 0;
    }
  }
  push();
  return items;
}

/** kosmos#4415: an item that is one of the report form's questions, or the start of one (a question wrapped over two
 *  lines arrives as two items). A question followed by an answer is NOT one. */
function isFormQuestion(item) {
  const n = normalize(item);
  if (!n) return false;
  return FORM_QUESTIONS.some((q) => { const qn = normalize(q); return qn === n || (qn.startsWith(n) && n.split(' ').length >= 3); });
}

/**
 * Advisory signal/noise score for one item. Returns { score, reasons }.
 *
 * The bar (stated in docs/feedback-triage.md): an item is worth a reviewer's
 * attention when it is actionable (names something concrete to change or fix),
 * is more than a fragment, and is not pure sentiment. Scores are advisory and
 * carry their reasons so a reviewer can override; nothing is dropped silently.
 */
function classify(item) {
  const norm = normalize(item);
  const words = norm ? norm.split(' ') : [];
  const content = [...tokens(item)];
  const reasons = [];
  let score = 0;

  if (words.length < 3 || content.length < 2) {
    reasons.push('too short to be actionable');
    return { score: 0, reasons };
  }

  if (isFormQuestion(item)) {
    reasons.push('a question from the report form, not an answer');
    return { score: 0, reasons };
  }
  /* kosmos#4415: an action word negated in its own clause does not count ("no errors", "nothing broken"). */
  const actionHits = [];
  for (const clause of String(item).split(CLAUSE_BREAK)) {
    const cw = normalize(clause).split(' ').filter(Boolean);
    const negates = (j) => NEGATORS.has(cw[j]) && !NOT_NEGATING_NEXT.has(cw[j + 1]);
    cw.forEach((w, i) => {
      if (!ACTION.has(w)) return;
      let negated = false;
      for (let j = Math.max(0, i - NEGATION_REACH); j < i; j++) if (negates(j)) negated = true;
      if (!negated) actionHits.push(w);
    });
  }
  /* A short line ending in ":" that starts like a question is an agent's own heading ("What would make it better:"),
     written in its own words so no exact list can hold it; a lead-in that does not ("Export fails with this error:")
     is a report and is kept. A line ending in "?" is only dropped when it is the form's own question (above). */
  if (words.length <= 8 && /:\s*$/.test(String(item).trim())
    && /^(?:what|how|is|are|any|anything|which|where|when|who|why)\b/.test(norm)) {
    reasons.push('a heading, not a report');
    return { score: 0, reasons };
  }
  /* Clean when a clause is a clean phrase and no OTHER clause carries a negation: "could not find the button but it
     works fine" has a problem in its other clause and is a report; "the queue is idle and ready rather than stuck" is
     clean. (A problem WORD anywhere already made actionHits non-empty.) */
  const clauses = String(item).split(CLAUSE_BREAK).map((c) => normalize(c)).filter(Boolean);
  const cleanAt = clauses.findIndex((c) => CLEAN.test(c));
  if (!actionHits.length && cleanAt !== -1
    && clauses.every((c, k) => k === cleanAt || CLEAN.test(c) || !c.split(' ').some((x) => NEGATORS.has(x)))) {
    reasons.push('reports that nothing was wrong');
    return { score: 0, reasons };
  }
  if (actionHits.length) {
    score += Math.min(actionHits.length, 3);
    reasons.push('names something to change or fix (' + [...new Set(actionHits)].slice(0, 4).join(', ') + ')');
  }

  const sentimentHits = words.filter((w) => SENTIMENT.has(w)).length;
  const nonSentimentContent = content.filter((w) => !SENTIMENT.has(w));
  if (sentimentHits && nonSentimentContent.length < 2) {
    reasons.push('mostly sentiment, no concrete suggestion');
    return { score: 0, reasons };
  }

  if (content.length >= 6) {
    score += 1;
    reasons.push('carries enough detail to act on');
  }

  if (!actionHits.length) {
    reasons.push('no clear action word; may be context rather than a suggestion');
  }

  return { score, reasons };
}

/** Jaccard overlap of two pre-tokenized sets, 0..1. */
function jaccardOfSets(ta, tb) {
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

/** Jaccard overlap of two items' content tokens, 0..1. */
function similarity(a, b) {
  return jaccardOfSets(tokens(a), tokens(b));
}

/**
 * Cluster near-duplicate items across all reports so one recurring issue is one
 * candidate, not N. Single-linkage on the similarity threshold. Returns an
 * array of clusters, each { members: [entryIndex...] }. `entries` is the flat
 * list of { text, date } produced by the caller.
 */
function groupDuplicates(entries, threshold) {
  const th = typeof threshold === 'number' ? threshold : 0.6;
  const clusters = [];
  const clusterOf = new Array(entries.length).fill(-1);
  // Tokenize each entry ONCE. The fixed-point loop below compares members to
  // candidates repeatedly, so tokenizing inside the comparison (via similarity)
  // re-did the same work O(passes x members x n) times -- a real cliff on a large
  // --dir of near-identical reports. With the sets precomputed the loop is set
  // intersections only.
  const tokenSets = entries.map((e) => tokens(e.text));
  for (let i = 0; i < entries.length; i += 1) {
    if (clusterOf[i] !== -1) continue;
    const members = [i];
    clusterOf[i] = clusters.length;
    // True single-linkage: re-scan ALL unassigned entries against ALL current
    // members until the cluster stops growing. A forward-only single pass is
    // order-dependent -- a chain A~B, B~C, A!~C clusters as [A,B,C] but splits
    // as [A,C,B], because C is only ever compared to A -- and would list one
    // recurring issue as two entries depending on report order. Iterating to a
    // fixed point makes the clustering order-independent. n is the item count
    // over the reports being triaged (a day, or a --dir of collected reports);
    // at realistic feedback volume the extra passes are cheap, and it always
    // terminates (a cluster stops growing once no unassigned entry links in).
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < entries.length; j += 1) {
        if (clusterOf[j] !== -1) continue;
        if (members.some((m) => jaccardOfSets(tokenSets[m], tokenSets[j]) >= th)) {
          clusterOf[j] = clusters.length;
          members.push(j);
          grew = true;
        }
      }
    }
    clusters.push({ members });
  }
  return clusters;
}

/**
 * For one item, the best-matching open-card title (by content overlap) if it is
 * over the threshold, else null. READ-ONLY against the card list: a match is
 * FLAGGED, never re-filed.
 */
function matchOpenCard(text, cardTitles, threshold) {
  const th = typeof threshold === 'number' ? threshold : 0.5;
  let best = null;
  let bestScore = 0;
  for (const title of cardTitles || []) {
    const s = similarity(text, title);
    if (s >= th && s > bestScore) { best = title; bestScore = s; }
  }
  return best ? { title: best, score: Number(bestScore.toFixed(2)) } : null;
}

/**
 * The whole triage pass over a set of reports.
 *
 * reports: [{ date, body }] (body already frontmatter-stripped by the caller).
 * opts: { openCards?: [title...], signalThreshold?, dupThreshold?, cardThreshold? }
 *
 * Returns a DRAFT digest object:
 *   candidates: worth review -- deduped clusters that clear the bar and do not
 *     match an open card. Each { text, dates:[...], count, score, reasons }.
 *   duplicatesOfOpenCards: cleared-the-bar items that resemble an open card,
 *     each { text, dates, matchesCard:{title,score} } -- flagged, not re-filed.
 *   noise: items below the bar, each { text, date, reasons }.
 *   summary: { reports, items, candidates, duplicatesOfOpenCards, noise }.
 * No card is created; this is input to a human review step.
 */
function triage(reports, opts) {
  const o = opts || {};
  const signalThreshold = typeof o.signalThreshold === 'number' ? o.signalThreshold : 1;
  const openCards = o.openCards || [];

  // Flatten every report into dated entries.
  const entries = [];
  for (const r of reports || []) {
    for (const text of parseItems(r && r.body)) {
      entries.push({ text, date: (r && r.date) || null });
    }
  }

  // Classify first; noise never reaches clustering (so a cluster is a real,
  // actionable recurring issue, not two fragments that happen to share words).
  const noise = [];
  const kept = [];
  for (const e of entries) {
    const c = classify(e.text);
    if (c.score >= signalThreshold) kept.push({ ...e, ...c });
    else noise.push({ text: e.text, date: e.date, reasons: c.reasons });
  }

  const clusters = groupDuplicates(kept, o.dupThreshold);
  const candidates = [];
  const duplicatesOfOpenCards = [];
  for (const cl of clusters) {
    const members = cl.members.map((i) => kept[i]);
    // The clearest phrasing represents the cluster: the highest-scoring member,
    // tie broken by length so the representative carries the most detail.
    const rep = members.slice().sort((a, b) => (b.score - a.score) || (b.text.length - a.text.length))[0];
    const dates = [...new Set(members.map((m) => m.date).filter(Boolean))].sort();
    const reasons = [...new Set([].concat(...members.map((m) => m.reasons)))];
    const record = {
      text: rep.text,
      dates,
      count: members.length,
      score: Math.max(...members.map((m) => m.score)),
      reasons,
    };
    const card = matchOpenCard(rep.text, openCards, o.cardThreshold);
    if (card) duplicatesOfOpenCards.push({ ...record, matchesCard: card });
    else candidates.push(record);
  }

  // Rank candidates: recurring first (count), then score, then most detailed.
  candidates.sort((a, b) => (b.count - a.count) || (b.score - a.score) || (b.text.length - a.text.length));

  return {
    candidates,
    duplicatesOfOpenCards,
    noise,
    summary: {
      reports: (reports || []).length,
      items: entries.length,
      candidates: candidates.length,
      duplicatesOfOpenCards: duplicatesOfOpenCards.length,
      noise: noise.length,
    },
  };
}

/**
 * Render a triage result as a human-readable markdown digest. Header states
 * plainly that no card was opened -- the digest is input to a human review, not
 * an action log.
 */
function renderDigest(result, meta) {
  const m = meta || {};
  const out = [];
  out.push('# Feedback triage (draft for review)');
  out.push('');
  out.push('No card was opened and nothing was changed. This digest is input to a');
  out.push('human review: read the candidates, discard the noise, and open cards');
  out.push('for the ones that clear the bar. See docs/feedback-triage.md.');
  out.push('');
  if (m.range) out.push('Reports: ' + m.range);
  const s = result.summary;
  out.push('Summary: ' + s.reports + ' report(s), ' + s.items + ' item(s) -> '
    + s.candidates + ' candidate(s), ' + s.duplicatesOfOpenCards
    + ' likely already carded, ' + s.noise + ' below the bar.');
  out.push('');

  out.push('## Candidates for review (' + result.candidates.length + ')');
  if (!result.candidates.length) out.push('_none_');
  result.candidates.forEach((c, i) => {
    const seen = c.count > 1 ? ' (raised ' + c.count + ' times: ' + c.dates.join(', ') + ')' : (c.dates[0] ? ' (' + c.dates[0] + ')' : '');
    out.push((i + 1) + '. ' + c.text + seen);
    out.push('   - why: ' + c.reasons.join('; '));
  });
  out.push('');

  out.push('## Likely already carded -- confirm before re-filing (' + result.duplicatesOfOpenCards.length + ')');
  if (!result.duplicatesOfOpenCards.length) out.push('_none_');
  result.duplicatesOfOpenCards.forEach((c) => {
    out.push('- ' + c.text);
    out.push('   - resembles open card: "' + c.matchesCard.title + '" (overlap ' + c.matchesCard.score + ')');
  });
  out.push('');

  out.push('## Below the bar (' + result.noise.length + ')');
  if (!result.noise.length) out.push('_none_');
  result.noise.forEach((n) => {
    out.push('- ' + n.text + (n.date ? ' (' + n.date + ')' : ''));
    out.push('   - ' + n.reasons.join('; '));
  });
  out.push('');
  return out.join('\n');
}

/**
 * The whole digest `kosmos feedback triage` prints, from the reports
 * (engine/feedback.js reportsForTriage) and the open-card titles as text, one per
 * line. Still pure. Both CLIs call this rather than each assembling the range
 * line and the card list, so the Mac and Windows digests are one derivation
 * (win32-cli-verbs).
 *
 * The range reads "no reports found" only when there are none; reports with no
 * dated filename say so rather than heading real items with "no reports found".
 */
function digestFor(reports, cardsText) {
  const all = Array.isArray(reports) ? reports : [];
  const openCards = String(cardsText == null ? '' : cardsText).split('\n').map((s) => s.trim()).filter(Boolean);
  const result = triage(all, { openCards });
  const dates = all.map((r) => r.date).filter(Boolean).sort();
  const range = all.length === 0 ? 'no reports found'
    : dates.length ? (dates[0] + ' .. ' + dates[dates.length - 1])
    : all.length + ' report(s), no dated filenames';
  return renderDigest(result, { range });
}

/**
 * kosmos#4415 slice 2: the pulled reports that ARRIVED after `sinceSec` (epoch seconds), read from each report's
 * own `generated_at` line (engine/feedbackpull.js writes it into the frontmatter). A report with no readable
 * generated_at is left out rather than guessed at: the daily post covers what is new, and an undated report
 * cannot be placed on either side of the last post. Pure; the daily job (tools/feedback-digest-daily.sh) reads
 * the files and hands them in as { name, body }.
 */
function freshSince(files, sinceSec, nowSec) {
  const since = Number(sinceSec);
  /* A generated_at is the install's own clock. One running fast would be "new" in every digest until that time came,
     so a stamp more than ten minutes ahead of this run is left out, like an undated one. */
  const latest = (Number.isFinite(Number(nowSec)) ? Number(nowSec) : Date.now() / 1000) + 600;
  const { stripFrontmatter } = require('./feedback');
  const out = [];
  for (const f of Array.isArray(files) ? files : []) {
    const body = String((f && f.body) || '');
    const m = /(?:^|\n)generated_at:\s*(\S+)/.exec(body);
    const at = m ? Date.parse(m[1]) : NaN;
    if (Number.isFinite(at) && Number.isFinite(since) && at / 1000 > since && at / 1000 <= latest) {
      /* The pulled frontmatter (date, install, generated_at) comes off here, as the CLI's reportsForTriage does:
         left in, it was glued onto the first item and put an install id into #admin. */
      out.push({ date: String((f && f.name) || '').slice(0, 10), body: stripFrontmatter(body) });
    }
  }
  return out;
}

/**
 * kosmos#4415 slice 2: the SHORT post the daily job puts in #admin: the counts, the top five candidates, and the
 * link to /admin's Reports inbox, where every report is read and marked triaged. '' when there is nothing new, so
 * the job posts nothing rather than a daily "0 new". It never opens a card (#2246: a person decides).
 */
const ADMIN_TOP = 5;
function adminSummary(reports, cardsText, adminUrl) {
  const fresh = Array.isArray(reports) ? reports : [];
  if (!fresh.length) return '';
  const openCards = String(cardsText == null ? '' : cardsText).split('\n').map((x) => x.trim()).filter(Boolean);
  const res = triage(fresh, { openCards });
  const lines = ['Daily reports: ' + fresh.length + ' new since the last digest. ' + res.candidates.length + ' to review, '
    + res.duplicatesOfOpenCards.length + ' look already carded, ' + res.noise.length + ' below the bar.'];
  /* Report text is written by any install on the internet and lands where agents read, under the bot's name: each
     line goes in as inline code (backticks swapped out), so a markdown link does not render and nothing reads as the
     bot's own words. */
  for (const c of res.candidates.slice(0, ADMIN_TOP)) lines.push('- `' + String(c.text).replace(/\s+/g, ' ').replace(/`/g, "'").slice(0, 220) + '`');
  if (res.candidates.length > ADMIN_TOP) lines.push('...and ' + (res.candidates.length - ADMIN_TOP) + ' more.');
  lines.push('This counts reports that arrived since the last digest; one delivered late is only in the inbox. '
    + 'Read them all, and mark them triaged: ' + adminUrl + ' (Reports). No card was opened.');
  return lines.join('\n').slice(0, 1900);   // one Discord message
}

module.exports = {
  normalize, tokens, parseItems, classify, similarity,
  groupDuplicates, matchOpenCard, triage, renderDigest, digestFor,
  freshSince, adminSummary, FORM_QUESTIONS, // kosmos#4415
};
