'use strict';
/**
 * #5874: one recorded task event (engine/taskchat.js) in plain words, for the CLIs (`kosmos task activity`, on the Mac
 * and on Windows). It is the page's tkActPhrase (web/index.html), with the page's member lookup passed in as
 * `nameOfMember(sessionName)`. The page cannot require this file, so it keeps its own copy; taskactphrase.test.js holds
 * the two to the same words for every kind and fails when either knows a kind the other does not.
 * The words are RAW (taskchat keeps them unescaped): a caller printing to a terminal makes them one line itself.
 *
 * `opts.forAgent` (the CLIs, whose reader is an agent): the page speaks to the person as "You"; read by an agent, "You"
 * would name the agent, so it says "The person". And words a person or an agent wrote are QUOTED, as `kosmos task list`
 * quotes words Kosmos did not write: a message (`said`, which carries no author on the board, tasks.say, so it is
 * marked too), a part's sentence, the done-when checks, and a run's or a built mark's note. None can then pass for one
 * of the lines Kosmos writes about the task. A repeat's words are Kosmos's own (from the schedule) and are not quoted.
 * Names are not quoted either: they are the agents' card names (what the page's member rows and its tskAgentName both
 * show, so a former member is named the same way), set by the person or read off an agent's identity line. A due date,
 * a count and a task number are Kosmos's own validated values. Every printed line is made one line, with control and
 * format characters taken out, by the CLIs. The parity test holds the page mode (no opts) to the page; the agent
 * wording is held by cli.task-activity-5874.test.js and this file's own forAgent tests. Without opts the words are the page's, which
 * taskactphrase.test.js holds them to.
 */
/* Quote characters inside a message become a plain apostrophe (and brackets plain ones), so a message cannot close its
   own quotation: install/kosmos's `task list` q(), the same set. */
const quoted = (v) => '"' + String(v).normalize('NFKC').replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
  .replace(/["\u02BA\u02EE\u2032\u2035\u05F4\u3003\u275D\u275E\p{Pi}\p{Pf}]/gu, "'")
  .replace(/\p{Ps}/gu, '(').replace(/\p{Pe}/gu, ')') + '"';
function phrase(ev, nameOfMember, opts) {
  const agent = Boolean(opts && opts.forAgent);
  const YOU = agent ? 'The person' : 'You';
  /* Review 2: words a person or an agent wrote (a part's sentence, the done-when checks, a run's or a built mark's note)
     are quoted too, worded for an agent, so none of them can read as a line of Kosmos's own. */
  const own = (v) => (agent ? quoted(v) : v);
  const nameOf = (sn) => (sn ? (typeof nameOfMember === 'function' ? nameOfMember(sn) : sn) || sn : null);
  switch (ev.kind) {
    case 'created': { const who = nameOf(ev.who); return (who ? 'Created and given to ' + who : 'Created') + (ev.parent ? ', under task ' + ev.parent : '') + (ev.doneWhen ? '. Done when: ' + own(ev.doneWhen) : ''); }
    case 'assigned': { const who = nameOf(ev.who); return who ? who + ' put on a part' : 'A part left with nobody on it'; }
    case 'part-added': return 'A part added' + (ev.sentence ? ': ' + own(ev.sentence) : '');
    case 'part-closed': return 'A part marked done';
    case 'part-reopened': return 'A part put back';
    case 'due-set': return ev.dueDate ? 'Due date set to ' + ev.dueDate : 'Due date set';
    case 'due-cleared': return 'Due date cleared';
    // #5152: what finished means for the task, set or taken off (by an agent, named, or from the screen).
    case 'done-when-set': { const who = ev.person ? YOU : nameOf(ev.by); return (who ? who + ' set' : 'Set') + ' what done means' + (ev.doneWhen ? ': ' + own(ev.doneWhen) : ''); }
    case 'done-when-cleared': { const who = ev.person ? YOU : nameOf(ev.by); return (who ? who + ' took' : 'Took') + ' off what done means'; }
    case 'hold-set': return ev.via === 'agent' ? 'Put on hold by an agent' : 'Put on hold';
    case 'hold-cleared': return ev.via === 'agent' ? 'Taken off hold by an agent' : ev.via === 'close' ? 'Taken off hold, as it was closed' : 'Taken off hold';
    // #3861: a task put under another task on its project, or taken out from under one.
    case 'parent-set': return ev.parent ? 'Put under task ' + ev.parent : 'Put under another task';
    case 'parent-cleared': return 'Taken out from under its task';
    // kosmos#4787: a recurring task's rule, and each run its owner reported (kosmos task ran).
    case 'repeat-set': return ev.words ? 'Set to repeat ' + ev.words : 'Set to repeat';
    case 'repeat-cleared': return 'No longer repeats';
    case 'run': { const who = ev.person ? YOU : nameOf(ev.by); const missed = Number(ev.missedBefore) >= 1 ? Number(ev.missedBefore) : 0; return (who ? who + ' ran it' : 'Ran') + (ev.late ? ', late' : '') + (missed ? ', after ' + (ev.missedMore === true ? 'more than ' + missed + ' missed runs' : missed === 1 ? '1 missed run' : missed + ' missed runs') : '') + (ev.unchanged ? (ev.inferred ? ', the same note again' : ', nothing new') : '') + (ev.note ? ': ' + own(ev.note) : ''); }   // kosmos#5643: said, or only a repeated note
    /* kosmos#4787 slice 3 (review 5): who reviews it, and a missed run with who was told. */
    case 'reviewer-set': return ev.person ? YOU + ' will be told if a run is missed' : (nameOf(ev.who) || 'An agent') + ' will be told if a run is missed';
    case 'reviewer-cleared': return 'Nobody is told now if a run is missed';
    case 'hold-stale': {   // #6209 part 3: an owner still working a held task in its room was asked about the hold
      const who = nameOf(ev.told) || 'its owner';
      return ev.reached === false ? 'Still on hold while ' + who + ' worked in its room; Kosmos could not reach ' + who
        : 'Still on hold while ' + who + ' worked in its room; ' + who + ' was asked whether the hold still stands';
    }
    case 'missed': {
      const runs = ev.more === true ? 'More than ' + ev.count + ' runs missed' : Number(ev.count) > 1 ? ev.count + ' runs missed' : 'A run was missed';
      if (ev.person) return runs + (agent ? '; the person reviews it' : '; you review it');
      const who = nameOf(ev.told) || 'its reviewer';
      return runs + (ev.reached === false ? '; Kosmos could not reach ' + who : '; ' + who + ' was told');
    }
    case 'said': { const who = nameOf(ev.who); if (agent) return (who ? 'A message from ' + who + ': ' : 'A message: ') + quoted(ev.text || ''); return (who ? who + ': ' : '') + (ev.text || ''); }
    /* #5842: a message kept for an agent out of usage, sent once it could be, or dropped a day later (the page's words;
       worded for an agent, the person's own message is "the person's message", as "You" is "The person" above). */
    case 'kept-sent': case 'kept-dropped': {
      const to = nameOf(ev.to) || 'an agent';
      const subject = ev.person === true ? (agent ? 'the person\u2019s message' : 'your message') : ev.from ? 'the message from ' + nameOf(ev.from) : 'a message';
      const Subject = ev.person === true ? (agent ? 'The person\u2019s message' : 'Your message') : ev.from ? 'A message from ' + nameOf(ev.from) : 'A message';
      const behind = ev.behind === true;
      if (ev.kind === 'kept-dropped') return Subject + ' to ' + to + ' was never sent: '
        + 'Kosmos kept it ' + (behind ? 'behind earlier messages' : 'while ' + to + ' was out of usage') + ' and could not send it within a day';
      const kept = behind ? ', kept behind earlier messages, ' : ', kept while ' + to + ' was out of usage, ';
      const when = behind ? 'once the messages ahead of it had gone' : 'once ' + to + ' was back';
      return ev.state === 'unconfirmed'
        ? 'Kosmos tried to send ' + subject + ' to ' + to + ' ' + when + ', but could not confirm ' + to + ' got it'
        : Subject + ' to ' + to + kept + 'was sent ' + when; }
    case 'closed': return 'Marked done';
    case 'undone': return ev.files === 1 ? 'One file’s changes undone' : 'File changes undone (' + (Number(ev.files) || 0) + ' files)';   // #5153 slice 4
    case 'reopened': { const who = ev.person ? YOU : nameOf(ev.by); return (who ? who + ' put it back' : 'Put back') + (ev.why ? ': ' + own(ev.why) : ''); }   // #6157
    /* #3951: who marked it built and what was left; and why the mark went. */
    case 'built': { const who = ev.person ? YOU : nameOf(ev.by); return (who ? who + ' marked it built' : 'Marked built') + (ev.note ? ': ' + own(ev.note) : ''); }
    case 'unbuilt': { if (ev.reason === 'new work') return 'No longer built: there is new work on it';
      if (ev.reason === 'it repeats') return (ev.person ? YOU + ' made it repeat' : 'Made to repeat') + ', so it is no longer built';   // #4787
      const who = ev.person ? YOU : nameOf(ev.by); return who ? who + ' took the built mark off' : 'Built mark taken off'; }
    default: return String(ev.kind);
  }
}

module.exports = { phrase };
