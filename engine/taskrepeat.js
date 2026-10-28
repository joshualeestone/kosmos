'use strict';
/**
 * kosmos#4787: a task that REPEATS. A recurring job (a monitor every hour, a report every morning) is an ordinary open
 * task owned by the agent that runs it, so the board shows who does it, when it last ran and when it runs next, instead
 * of the job living outside the task list and the work looking ownerless.
 *
 * The rule, in this computer's local time (the board and the person are on it):
 *   { every: 'hour', minute: 0-59 }                  every hour at :MM
 *   { every: 'day',  at: 'HH:MM' }                   every day at HH:MM
 *   { every: 'day',  at: ['HH:MM', ...] }            kosmos#5752: every day at each time (2 to 24, sorted; one time is
 *                                                    stored as the string above, so older rules read as they always did)
 *   { every: 'week', day: 0-6 (Sunday 0), at: 'HH:MM' } every week on that day at HH:MM
 *   { every: 'minutes', n: 15-720 }                  kosmos#6893: every n minutes, on the multiples of n from local
 *                                                    midnight (n divides the day: 15, 30, 45, 90, 120...), so the
 *                                                    slots are the same every day and a person can say when they fall
 * Kosmos does not START the job (the person's own scheduler or the agent's loop does); the agent reports each run
 * (`kosmos task ran`), and the next run is worked out from the rule, never stored, so a changed rule never leaves a
 * stale "next". Pure functions only: the writes are tasks.setRepeat / tasks.recordRun.
 */

const EVERY = ['hour', 'day', 'week', 'minutes'];
/* kosmos#6893: the shortest interval. Review 3: every run is a row in the task's history, which keeps them all, so a
   5-minute task would write 288 a day; 15 is 96, four times the busiest rule before this (hourly). */
const N_MIN = 15;
const N_MAX = 720;    // the longest; past half a day, a daily task with times says it better
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const NOTE_MAX = 500;   // a run's note: one line about what this run found, not the result itself
const TIMES_MAX = 24;   // kosmos#5752: a daily task's times of day; more than hourly is an hourly task

/* The rule as given (CLI or screen), checked whole: a sentence for what is wrong, or null. */
function repeatProblem(r) {
  if (r === null || r === undefined) return null;   // clearing
  if (typeof r !== 'object' || Array.isArray(r)) return 'a repeat has to say how often: every so many minutes, every hour, day or week';
  if (!EVERY.includes(r.every)) return 'a task can repeat every so many minutes, every hour, every day or every week';
  if (r.every === 'minutes') {
    if (!(Number.isInteger(r.n) && r.n >= N_MIN && r.n <= N_MAX && 1440 % r.n === 0)) {
      return 'say the minutes as a number from ' + N_MIN + ' to ' + N_MAX + ' that divides the day evenly (12 hours at most), for example 15, 20, 30, 45 or 90';
    }
    if (r.at !== undefined || r.day !== undefined || r.minute !== undefined) return 'a task every so many minutes takes only the number of minutes';
    return null;
  }
  if (r.every === 'hour') {
    if (r.minute !== undefined && !(Number.isInteger(r.minute) && r.minute >= 0 && r.minute <= 59)) return 'the minute past the hour has to be 0 to 59';
    if (r.at !== undefined || r.day !== undefined) return 'an hourly task takes only the minute past the hour';
    return null;
  }
  /* kosmos#5752: a daily task can run at several times a day, given as a list. A weekly task takes one time. */
  if (r.every === 'day' && Array.isArray(r.at)) {
    if (r.at.length === 0) return 'say the time as HH:MM on a 24-hour clock, for example 09:00';
    if (r.at.length > TIMES_MAX) return 'a daily task can run at most ' + TIMES_MAX + ' times a day';
    if (!r.at.every((a) => typeof a === 'string' && AT_RE.test(a))) return 'say each time as HH:MM on a 24-hour clock, for example 09:00,21:00';
    if (new Set(r.at).size !== r.at.length) return 'say each time of day once';
  } else if (Array.isArray(r.at)) {
    return 'a weekly task runs at one time on its day';
  } else if (typeof r.at !== 'string' || !AT_RE.test(r.at)) return 'say the time as HH:MM on a 24-hour clock, for example 09:00';
  if (r.every === 'day') {
    if (r.day !== undefined || r.minute !== undefined) return 'a daily task takes only the time';
    return null;
  }
  if (!(Number.isInteger(r.day) && r.day >= 0 && r.day <= 6)) return 'a weekly task needs the day of the week';
  if (r.minute !== undefined) return 'a weekly task takes the day and the time';
  return null;
}

/* Only the fields the rule uses, so a stored rule never carries junk from a caller. */
function normalise(r) {
  if (r === null || r === undefined) return null;
  if (r.every === 'hour') return { every: 'hour', minute: r.minute === undefined ? 0 : r.minute };
  // Review 1: every 60 minutes IS hourly, stored as the hourly rule so switching between the two words is no change.
  if (r.every === 'minutes') return r.n === 60 ? { every: 'hour', minute: 0 } : { every: 'minutes', n: r.n };
  if (r.every === 'day') {
    /* kosmos#5752: one time stays a string, so every rule stored before lists existed reads exactly as it did; two or
       more are kept sorted, so the same times in another order are the same rule (setRepeat compares them). */
    if (!Array.isArray(r.at)) return { every: 'day', at: r.at };
    const times = [...r.at].sort();
    return { every: 'day', at: times.length === 1 ? times[0] : times };
  }
  return { every: 'week', day: r.day, at: r.at };
}

function hm(at) { const m = AT_RE.exec(at); return [Number(m[1]), Number(m[2])]; }
/* kosmos#5752: the rule's times of day, as a list (one for a weekly or single-time daily rule). */
function timesOf(r) { return Array.isArray(r.at) ? r.at : [r.at]; }

/* The first scheduled time strictly after `ms`, in local time (a Date number), or null for no rule. A daylight-saving
   jump is taken as the clock gives it: a 02:30 rule on the night 02:00 is skipped lands at 03:30, as local time does. */
function nextAfter(rule, ms) {
  const r = normalise(rule);
  if (!r || repeatProblem(r)) return null;
  const from = new Date(ms);
  const y = from.getFullYear(), mo = from.getMonth(), d = from.getDate();
  /* kosmos#6893: each slot built from (day, 0:00 + k*n minutes), as the other rules build theirs, so a DST day takes its
     slots as the clock gives them. Today, then tomorrow (whose 0:00 is the first slot past today's last). */
  if (r.every === 'minutes') {
    /* Review 1: today's walk starts a slot before the current time, not at midnight: missedRuns and the latest-slot walk
       call this in loops, for every task on every read. */
    const k0 = Math.max(0, Math.floor((from.getHours() * 60 + from.getMinutes()) / r.n) - 1);
    for (let n = 0; n <= 1; n += 1) {
      for (let k = n === 0 ? k0 : 0; k * r.n < 1440; k += 1) {
        const slot = new Date(y, mo, d + n, 0, k * r.n, 0, 0);
        /* Review 3: a time the spring change skips is not moved onto the clock (02:15 would become 03:15, off the
           grid, and crowd the real 03:00 slot): it is dropped, as a person's scheduler would skip it. */
        if (slot.getHours() * 60 + slot.getMinutes() !== k * r.n) continue;
        const t = slot.getTime();
        if (t > ms) return t;
      }
    }
    return null;
  }
  if (r.every === 'hour') {
    // Hour by hour from this hour's slot, each built from its own parts, so the clock's own rules decide a DST hour.
    for (let k = 0; k <= 26; k += 1) {
      const t = new Date(y, mo, d, from.getHours() + k, r.minute, 0, 0).getTime();
      if (t > ms) return t;
    }
    return null;
  }
  const hms = timesOf(r).map(hm);
  /* #4787 review 1: each candidate day is built ONCE from (year, month, day + n, h, m). Moving a built Date by setDate
     kept a spring-forward shift (02:30 that night became 03:30) on every later day. */
  /* kosmos#5752: the earliest candidate after `ms` across the day's times, not the first in list order: a DST jump can
     move one time past a later one (02:30 lands at 03:30, after a 03:00 slot). */
  for (let n = 0; n <= 8; n += 1) {
    let best = null;
    for (const [h, m] of hms) {
      const t = new Date(y, mo, d + n, h, m, 0, 0);
      if (r.every === 'week' && t.getDay() !== r.day) continue;
      if (t.getTime() > ms && (best === null || t.getTime() < best)) best = t.getTime();
    }
    if (best !== null) return best;
  }
  return null;
}

function clock(h, m) {
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? h12 + ampm : h12 + ':' + String(m).padStart(2, '0') + ampm;
}

/* The rule in words, for the row and the task page: "every hour at :15", "every day at 9am", "every Monday at 9:30am". */
function describe(rule) {
  const r = normalise(rule);
  if (!r || repeatProblem(r)) return '';
  if (r.every === 'hour') return 'every hour' + (r.minute ? ' at :' + String(r.minute).padStart(2, '0') : '');
  if (r.every === 'minutes') return r.n % 60 === 0 && r.n > 60 ? 'every ' + (r.n / 60) + ' hours' : 'every ' + r.n + ' minutes';
  const said = timesOf(r).map((a) => clock(...hm(a)));
  const list = said.length === 1 ? said[0] : said.slice(0, -1).join(', ') + ' and ' + said[said.length - 1];
  return (r.every === 'day' ? 'every day' : 'every ' + DAY_NAMES[r.day]) + ' at ' + list;
}

/* kosmos#5836: a run's READING (`kosmos task ran --value`) and what the person was told (`kosmos task told`). Text the
   agent phrases: compared exactly, whitespace runs aside, so "2 errors" and "3 errors" differ. One line, at most VALUE_MAX. */
const VALUE_MAX = 500;
function valueProblem(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return 'a reading has to be text';
  if (!v.replace(/\s+/g, ' ').trim()) return 'say what the reading is';
  if (v.length > VALUE_MAX) return 'a reading is at most ' + VALUE_MAX + ' characters';
  return null;
}
function normValue(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''; }

/* A run's note, checked: trimmed, one line, at most NOTE_MAX characters. */
function noteProblem(note) {
  if (note === undefined || note === null || note === '') return null;
  if (typeof note !== 'string') return 'a run note has to be text';
  if (note.length > NOTE_MAX) return 'a run note is at most ' + NOTE_MAX + ' characters';
  return null;
}

/* kosmos#5752: --at as given: one time stays as it is; times split on commas or spaces become a list (a trailing comma
   leaves an empty entry, which is refused rather than dropped). */
function timesWords(at) {
  if (typeof at !== 'string') return at;
  const s = at.trim();
  return /[,\s]/.test(s) ? s.split(/\s*,\s*|\s+/) : at;
}
/* CLI words to a rule: ('day', { at: '09:00' }), ('week', { on: 'mon', at: '09:30' }), ('hour', { at: ':15' }). */
function fromWords(every, opts = {}) {
  const e = String(every || '').toLowerCase().replace(/ly$/, '').replace(/^dai$/, 'day');   // hourly/daily/weekly too
  /* kosmos#6893: "30m", "30min", "45 minutes", "2h" (the CLIs' word), or every 'minutes' with the number as --at (the
     screen). Anything else in that shape is passed on as a rule the board refuses with the minutes sentence. */
  const short = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/.exec(String(every || '').trim().toLowerCase());
  /* Review 1: a time or a day sent with the word is kept, so the board refuses it ("takes only the number of minutes")
     instead of dropping it without a word. */
  if (short) {
    return { every: 'minutes', n: Number(short[1]) * (/^h/.test(short[2]) ? 60 : 1),
      ...(opts.at === undefined ? {} : { at: opts.at }), ...(opts.on === undefined || opts.on === '' ? {} : { day: opts.on }) };
  }
  if (e === 'minute' || e === 'minutes') {
    const n = opts.at === undefined ? NaN : String(opts.at).trim();
    return { every: 'minutes', n: /^\d{1,4}$/.test(n) ? Number(n) : NaN, ...(opts.on === undefined || opts.on === '' ? {} : { day: opts.on }) };
  }
  if (e === 'hour') {
    const at = opts.at === undefined ? undefined : String(opts.at).replace(/^:/, '');
    return { every: 'hour', ...(at === undefined ? {} : { minute: /^\d{1,2}$/.test(at) ? Number(at) : NaN }) };
  }
  /* kosmos#5752: --at 09:00,21:00 (or "09:00 21:00") is two times a day. One time stays a string. A weekly task given
     several is passed on as a list too, so it is refused with the weekly sentence rather than the bad-time one. */
  const at = timesWords(opts.at);
  if (e === 'day') return { every: 'day', at };
  if (e === 'week') {
    const on = String(opts.on || '').toLowerCase().slice(0, 3);
    const day = DAY_NAMES.findIndex((n) => n.toLowerCase().startsWith(on) && on.length === 3);
    return { every: 'week', day: day === -1 ? undefined : day, at };
  }
  return { every: e };
}

/* #4787 review 1: the next run as the line says it ("today at 9am", "tomorrow at 9am", "Monday at 9:30am", or a date),
   made on the board in the board's own time, beside the rule's words, so one line never mixes two time zones (a Kosmos+
   view from another computer would otherwise read the next run in its own). `now` is passed in. */
function whenWords(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const time = clock(d.getHours(), d.getMinutes());
  const day0 = (x) => { const z = new Date(x); return new Date(z.getFullYear(), z.getMonth(), z.getDate()).getTime(); };
  const days = Math.round((day0(ms) - day0(now)) / 86400000);
  if (days === 0) return 'today at ' + time;
  if (days === 1) return 'tomorrow at ' + time;
  if (days > 1 && days < 7) return DAY_NAMES[d.getDay()] + ' at ' + time;
  /* slice 2: a missed slot is in the past: "yesterday at 9am", or "last Monday at 9am" within the last week (review 5:
     a bare weekday read the same as a weekly task's next run, "Next Monday at 9am"). */
  if (days === -1) return 'yesterday at ' + time;
  if (days < -1 && days > -7) return 'last ' + DAY_NAMES[d.getDay()] + ' at ' + time;
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ' at ' + time;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* #4787 review 1: a repeating task between runs holds no work: its owner is not idle-with-open-work while it waits for
   the next scheduled time. Due again (so open work, nudged and counted) once a scheduled time after its last run (or,
   with no run yet, after it was made) has passed. A task that does not repeat is never waiting. */
/* kosmos#7413 (an outside user's report: a run at 06:15 for a 06:45 slot was taken as not done, and the agent nagged):
   the cap is 30 minutes, not 10. The share of the period still sizes it, so an hourly job keeps its 2 minutes and a
   late 09:55 run still leaves 10:00 due (review 3); a daily or weekly job's run up to 30 minutes early is that slot's. */
const RUN_GRACE_MS = 30 * 60 * 1000;
function graceFor(rule) {
  return Math.min(RUN_GRACE_MS, Math.floor(gapOf(rule) / 30));
}
/* The scheduled slot this task is due for next: the first slot after its last run (or after the rule was set), or null
   when there is no time to measure from (no rule, no stamp, or a run stamped in the future). Shared by
   waitingForNextRun, missedRuns and recordRun's late mark, so the three can never disagree about which slot is due. */
function dueSlot(t, now = Date.now()) {
  if (!t || !t.repeat) return null;
  // review 4: with no run yet, from when the RULE was set (a rule put on an old task is not due at once).
  const raw = Date.parse(t.lastRunAt || t.repeatSetAt || t.createdAt || '');
  if (!Number.isFinite(raw)) return null;
  /* review 2: a run stamped more than a minute in the future (a clock stepped back) cannot say when the job last ran.
     (Measuring from "now" instead would wait for ever, one slot past each check.) A run reported a little early
     (08:59:50 for 09:00) is that slot's run, so the next is measured past a short grace. */
  if (raw > now + 60 * 1000) return null;
  /* review 3: the grace is for a RUN reported early, never for the moment the task was made (a task made at 08:55 for
     09:00 must be due at 09:00), and it is a small share of the period: at most 10 minutes, 2 for an hourly job, so a
     late run at 09:55 for the 09:00 slot still leaves 10:00 due. */
  /* review 5: never before the rule itself: a slot that passed before the rule was set or changed is not missed. */
  const ruleFrom = Date.parse(t.repeatSetAt || t.createdAt || '');
  /* slice 2 review 2: a run made before the rule was set or changed answers nothing under it (its early grace would
     otherwise swallow the new rule's first slot: ran 08:50 hourly, changed to daily 9am at 08:55). */
  if (t.lastRunAt && Number.isFinite(ruleFrom) && raw < ruleFrom) return nextAfter(t.repeat, ruleFrom);
  const fromRun = t.lastRunAt ? raw + graceFor(t.repeat) : raw;
  const since = Number.isFinite(ruleFrom) ? Math.max(fromRun, ruleFrom) : fromRun;
  return nextAfter(t.repeat, since);
}
function waitingForNextRun(t, now = Date.now()) {
  if (!t || !t.repeat) return false;
  const due = dueSlot(t, now);
  // No time to measure from: treat it as work (due), never hide it.
  return due !== null && due > now;
}

/* kosmos#4787 slice 2: a run is MISSED when its scheduled time plus a grace has passed with no run reported since. The
   grace is the smaller of 15 minutes and a quarter of the period, so a job that starts a few minutes late is not called
   missed. Returns { count, more, lastAt } (the slots missed since the last run, counted up to MISSED_CAP, and the latest
   of them), or null when nothing is missed or there is no time to measure from (never claim a miss we cannot see). */
const MISS_GRACE_MS = 15 * 60 * 1000;
const MISSED_CAP = 99;
function missGraceFor(rule) {
  return Math.min(MISS_GRACE_MS, Math.floor(gapOf(rule) / 4));
}
function periodOf(rule) {
  const r = normalise(rule);
  return !r ? 0 : r.every === 'minutes' ? r.n * 60000 : r.every === 'hour' ? 3600000 : r.every === 'day' ? 86400000 : 7 * 86400000;
}
/* kosmos#5752: the shortest time between two slots, which sizes the graces: the period for one time a day, otherwise
   the smallest gap between the day's times, counting the wrap past midnight. The latest-slot walk keeps periodOf, so a
   lopsided pair (09:00 and 09:30) is never walked past. */
function gapOf(rule) {
  const r = normalise(rule);
  /* round 1: a rule that does not check out (a hand-edited stored list) is sized as its period, never read: hm() throws
     on a bad time, and fieldsOf runs for every task in the projects list. nextAfter and describe guard the same way. */
  if (!r || repeatProblem(r) || r.every !== 'day' || !Array.isArray(r.at)) return periodOf(r);
  const mins = r.at.map((a) => { const [h, m] = hm(a); return h * 60 + m; });
  let gap = 1440;
  for (let i = 0; i < mins.length; i += 1) gap = Math.min(gap, ((mins[(i + 1) % mins.length] - mins[i]) + 1440) % 1440 || 1440);
  return gap * 60000;
}
/* The latest scheduled slot at or before `ms`, never earlier than `from` (a slot that is itself due counts), or null.
   Walks forward from two periods back, so it takes a few steps whatever the gap (review 1: reading it off a capped
   count named a slot days old as the latest). */
function latestAtOrBefore(rule, from, ms) {
  if (from === null || from > ms) return null;
  let s = nextAfter(rule, Math.max(from - 1, ms - 2 * periodOf(rule) - 3600000));
  let last = null;
  while (s !== null && s <= ms) { last = s; s = nextAfter(rule, s); }
  return last;
}
/* slice 2: the ONE rule for which slot a run answers, shared by missedRuns and runIsLate so a row never says two
   contradictory things (review 4): the next slot when the run is at most the miss grace before it (a job that started
   at 08:50 for 09:00), otherwise the latest slot at or before the run. `firstSlot` is the rule's first slot. */
/* kosmos#7413: how far BEFORE a slot a run still answers it: the smaller of 30 minutes and a quarter of the period, the
   miss grace's share with a 30-minute cap. An hourly job keeps 15 minutes, as before; a daily or weekly job's run up to
   30 minutes early answers that slot, so it is neither late for the one before nor followed by a missed run. The late
   mark after a slot keeps the miss grace (15 minutes). One window for answeredSlot and firstUnanswered, so the late
   mark and the missed line still agree. */
const EARLY_ANSWER_MS = 30 * 60 * 1000;
function earlyWindowFor(rule) {
  return Math.min(EARLY_ANSWER_MS, Math.floor(gapOf(rule) / 4));
}
function answersEarly(rule, runAt, slot) { return slot !== null && runAt < slot && slot - runAt <= earlyWindowFor(rule); }
function answeredSlot(rule, firstSlot, at) {
  const next = nextAfter(rule, at);
  if (answersEarly(rule, at, next)) return next;
  return latestAtOrBefore(rule, firstSlot, at);
}
/* slice 2: is a run at `at` LATE? Late when the slot it answers had passed by more than the miss grace. A run more
   than the grace before a slot answers the slot before it, so a weekly job run a day early is late for last week's
   run, and the next slot shows as missed if nobody runs it: the two agree. Before the rule's first slot (strictly
   after the rule was set, as in dueSlot) a run is never late. */
function runIsLate(t, at) {
  if (!t || !t.repeat) return false;
  const from = Date.parse(t.repeatSetAt || t.createdAt || '');
  if (!Number.isFinite(from)) return false;
  const ans = answeredSlot(t.repeat, nextAfter(t.repeat, from), at);
  return ans !== null && ans <= at && at - ans >= missGraceFor(t.repeat);
}
/* The first slot the last run did not answer: dueSlot, or the slot after it when the last run was reported up to the miss
   grace before it. Shared by missedRuns and skippedBefore (kosmos#5920), so the board's missed count and the misses a
   recovering run records can never start from different slots. */
function firstUnanswered(t, now) {
  let slot = dueSlot(t, now);
  /* review 1: a run reported up to the early window BEFORE its slot answers that slot (a job that started at 08:50 for
     09:00 ran; kosmos#7413: up to 30 minutes for a daily job), so it is never called missed. */
  /* review 2: only a run made under THIS rule (at or after it was set) answers its first slot early. */
  const lastRun = Date.parse(t.lastRunAt || '');
  const ruleFrom = Date.parse(t.repeatSetAt || t.createdAt || '');
  if (Number.isFinite(lastRun) && answersEarly(t.repeat, lastRun, slot)
    && !(Number.isFinite(ruleFrom) && lastRun < ruleFrom)) slot = nextAfter(t.repeat, slot);
  return slot;
}
function missedRuns(t, now = Date.now()) {
  if (!t || !t.repeat || t.isClosed === true || t.closedAt) return null;
  const grace = missGraceFor(t.repeat);
  let slot = firstUnanswered(t, now);
  if (slot === null || slot + grace > now) return null;
  const first = slot;
  let count = 0;
  while (slot !== null && slot + grace <= now && count < MISSED_CAP) { count += 1; slot = nextAfter(t.repeat, slot); }
  return { count, more: slot !== null && slot + grace <= now, lastAt: latestAtOrBefore(t.repeat, first, now - grace) };
}

/* kosmos#5920: the scheduled slots a run at `at` comes AFTER with none of them run: the slots missedRuns counts at `at`,
   less the one this run answers (answeredSlot, the same rule runIsLate uses). A recovery that lands hours late (a retry
   that held the agent) records ONE run, and moving lastRunAt past the slots it skipped would otherwise make them vanish
   from the count and from the history. Returns { count, more, firstAt, lastAt }, or null when it skipped none. lastAt is
   the last slot COUNTED: past MISSED_CAP it is the cap's slot, and `more` says there were more. */
function skippedBefore(t, at) {
  if (!t || !t.repeat || !Number.isFinite(at)) return null;
  const grace = missGraceFor(t.repeat);
  let slot = firstUnanswered(t, at);
  if (slot === null) return null;
  // With no time the rule was set there is no first slot to answer from (runIsLate says not late there): claim nothing.
  const from = Date.parse(t.repeatSetAt || t.createdAt || '');
  if (!Number.isFinite(from)) return null;
  const answered = answeredSlot(t.repeat, nextAfter(t.repeat, from), at);
  const skipped = (s) => s !== null && s + grace <= at && (answered === null || s < answered);
  let count = 0; let first = null; let last = null;
  while (skipped(slot) && count < MISSED_CAP) { count += 1; if (first === null) first = slot; last = slot; slot = nextAfter(t.repeat, slot); }
  return count ? { count, more: skipped(slot), firstAt: first, lastAt: last } : null;
}

/* kosmos#5920 reviews 1 and 2: the time a run due at `at` must be recorded BEFORE so it answers `at`: the next slot less
   the early window (a record inside it answers the next slot early, which would count this run as missed; kosmos#7413:
   the window answersEarly uses, so the two never disagree),
   rounded down to the minute, so "before 9:22am" can be read to the minute and is never past the real limit (09:22:30
   for runs at 09:00 and 09:30). null with no next slot, when that time has already passed at `now` (no deadline is left
   to meet), and when it is not after the due slot itself (two times a minute apart: the floor lands on the due slot). */
function recordBy(rule, at, now = Date.now()) {
  const next = nextAfter(rule, at);
  if (next === null) return null;
  const by = Math.floor((next - earlyWindowFor(rule)) / 60000) * 60000;
  return by > now && by > at ? by : null;
}

/* kosmos#4787 slice 1b: the fields a screen shows for a repeating task (its rule in words, its next run in this board's
   own time), one derivation for every route that hands tasks to the page (/api/tasks and the projects list). A closed
   task has no next run. */
function fieldsOf(t, now = Date.now()) {
  if (!t || !t.repeat || t.isClosed === true || t.closedAt) return {};
  const nextAt = nextAfter(t.repeat, now);
  const out = { repeatWords: describe(t.repeat), repeatNextAt: nextAt, repeatNextWords: whenWords(nextAt, now) };
  /* review 5: when the next slot would become missed, so an open screen knows when to read again. Review 6: the first
     slot whose grace has NOT yet passed (read at 09:05 for a 9am slot, that is 09:15 today, not 09:15 tomorrow). */
  const grace = missGraceFor(t.repeat);
  const pending = nextAfter(t.repeat, now - grace);
  if (pending !== null) out.repeatMissAfter = pending + grace;
  /* slice 2: the missed runs, in the board's own time like the next run. */
  const missed = missedRuns(t, now);
  if (missed) Object.assign(out, { repeatMissed: missed.count, repeatMissedMore: missed.more, repeatMissedAt: missed.lastAt, repeatMissedWords: whenWords(missed.lastAt, now) });
  return out;
}

/* kosmos#6894: what a recorded run puts in the project room, or null for nothing: { text, note, reading } (note and
   reading are what the line says, '' for a part it does not), so the route can remember exactly what the room heard.
   Only a run that CHANGED something is said, so a task every 30 minutes does not fill the room.
   - Without `said` (the room has heard nothing of this task since the board started): the run's own change, as
     recordRun saw it (`prev` is tasks.runBefore(after)): a note that is the new last change and not word for word the
     last one, or a reading that differs from the one before (a duplicate's corrected reading too).
   - With `said` ({ note, reading }: what the room was last told): measured against THAT, so a change held back by the
     route's hour is said on the first run after it (the task's latest change note; review 5: never a copy held aside,
     which outlived the runs that replaced it) and "was" is a reading the room saw. This side reads the task's state, not the single run, on purpose: it is catching the room up.
   Kosmos says it, in its own voice (messages.roomNote). */
const ROOM_SENTENCE_MAX = 120;
function roomPlain(s, max) { return require('./agentnudge').plainWords(String(s == null ? '' : s).replace(/\p{Cf}/gu, ''), max); }
function sameWords(a, b) { return String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim(); }
function roomRunLine(prev, after, said) {
  if (!after || !after.repeat || !after.lastRunAt) return null;
  const nowReading = after.verified && typeof after.verified.value === 'string' ? after.verified.value : '';
  let note = '';
  let reading = '';
  let was = '';
  if (said) {
    const latest = typeof after.lastChangeNote === 'string' ? after.lastChangeNote : '';
    if (latest && !sameWords(latest, said.note)) note = latest;
    if (nowReading && nowReading !== (said.reading || '')) { reading = nowReading; was = said.reading || ''; }
  } else {
    const before = prev && typeof prev.verified === 'string' ? prev.verified : '';
    if (nowReading && nowReading !== before && (after.duplicate || after.verified.at === after.lastRunAt)) { reading = nowReading; was = before; }
    if (!after.duplicate && after.lastChangeAt === after.lastRunAt && typeof after.lastChangeNote === 'string' && after.lastChangeNote
      && !sameWords(after.lastChangeNote, prev && prev.changeNote)) note = after.lastChangeNote;
  }
  if (!note && !reading) return null;
  const parts = [];
  if (note) parts.push(roomPlain(note, NOTE_MAX));
  if (reading) parts.push('reading ' + roomPlain(reading, VALUE_MAX) + (was ? ' (was ' + roomPlain(was, VALUE_MAX) + ')' : ''));
  return { text: 'Task #' + after.number + ', "' + roomPlain(after.sentence || '', ROOM_SENTENCE_MAX) + '" (' + describe(after.repeat) + '): ' + parts.join('; '), note, reading };
}

module.exports = { roomRunLine, sameWords, VALUE_MAX, valueProblem, normValue, EVERY, DAY_NAMES, NOTE_MAX, repeatProblem, normalise, nextAfter, describe, noteProblem, fromWords, waitingForNextRun, whenWords, fieldsOf, dueSlot, missedRuns, skippedBefore, recordBy, missGraceFor, earlyWindowFor, latestAtOrBefore, runIsLate, answeredSlot, MISSED_CAP };
