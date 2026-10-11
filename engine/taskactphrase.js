'use strict';
/**
 * #5874: one recorded task event (engine/taskchat.js) in plain words, for the CLIs (`kosmos task activity`, on the Mac
 * and on Windows). It is the page's tkActPhrase (web/index.html), with the page's member lookup passed in as
 * `nameOfMember(sessionName)`. The page cannot require this file, so it keeps its own copy; taskactphrase.test.js holds
 * the two to the same words for every kind and fails when either knows a kind the other does not.
 * The words are RAW (taskchat keeps them unescaped): a caller printing to a terminal makes them one line itself.
 */
function phrase(ev, nameOfMember) {
  const nameOf = (sn) => (sn ? (typeof nameOfMember === 'function' ? nameOfMember(sn) : sn) || sn : null);
  switch (ev.kind) {
    case 'created': { const who = nameOf(ev.who); return (who ? 'Created and given to ' + who : 'Created') + (ev.parent ? ', under task ' + ev.parent : '') + (ev.doneWhen ? '. Done when: ' + ev.doneWhen : ''); }
    case 'assigned': { const who = nameOf(ev.who); return who ? who + ' put on a part' : 'A part left with nobody on it'; }
    case 'part-added': return 'A part added' + (ev.sentence ? ': ' + ev.sentence : '');
    case 'part-closed': return 'A part marked done';
    case 'part-reopened': return 'A part put back';
    case 'due-set': return ev.dueDate ? 'Due date set to ' + ev.dueDate : 'Due date set';
    case 'due-cleared': return 'Due date cleared';
    // #5152: what finished means for the task, set or taken off (by an agent, named, or from the screen).
    case 'done-when-set': { const who = ev.person ? 'You' : nameOf(ev.by); return (who ? who + ' set' : 'Set') + ' what done means' + (ev.doneWhen ? ': ' + ev.doneWhen : ''); }
    case 'done-when-cleared': { const who = ev.person ? 'You' : nameOf(ev.by); return (who ? who + ' took' : 'Took') + ' off what done means'; }
    case 'hold-set': return ev.via === 'agent' ? 'Put on hold by an agent' : 'Put on hold';
    case 'hold-cleared': return ev.via === 'agent' ? 'Taken off hold by an agent' : ev.via === 'close' ? 'Taken off hold, as it was closed' : 'Taken off hold';
    // #3861: a task put under another task on its project, or taken out from under one.
    case 'parent-set': return ev.parent ? 'Put under task ' + ev.parent : 'Put under another task';
    case 'parent-cleared': return 'Taken out from under its task';
    // kosmos#4787: a recurring task's rule, and each run its owner reported (kosmos task ran).
    case 'repeat-set': return ev.words ? 'Set to repeat ' + ev.words : 'Set to repeat';
    case 'repeat-cleared': return 'No longer repeats';
    case 'run': { const who = ev.person ? 'You' : nameOf(ev.by); return (who ? who + ' ran it' : 'Ran') + (ev.late ? ', late' : '') + (ev.unchanged ? (ev.inferred ? ', the same note again' : ', nothing new') : '') + (ev.note ? ': ' + ev.note : ''); }   // kosmos#5643: said, or only a repeated note
    /* kosmos#4787 slice 3 (review 5): who reviews it, and a missed run with who was told. */
    case 'reviewer-set': return ev.person ? 'You will be told if a run is missed' : (nameOf(ev.who) || 'An agent') + ' will be told if a run is missed';
    case 'reviewer-cleared': return 'Nobody is told now if a run is missed';
    case 'missed': {
      const runs = ev.more === true ? 'More than ' + ev.count + ' runs missed' : Number(ev.count) > 1 ? ev.count + ' runs missed' : 'A run was missed';
      if (ev.person) return runs + '; you review it';
      const who = nameOf(ev.told) || 'its reviewer';
      return runs + (ev.reached === false ? '; Kosmos could not reach ' + who : '; ' + who + ' was told');
    }
    // #768: a free-text message recorded via the composer. `who` is optional (a
    // message typed on the board carries none today; the field is honoured now so
    // an authored message reads correctly when two-way delivery lands later). The
    // whole return is esc()'d once at the render site, like every other phrase.
    case 'said': { const who = nameOf(ev.who); return (who ? who + ': ' : '') + (ev.text || ''); }
    case 'closed': return 'Marked done';
    case 'undone': return ev.files === 1 ? 'One file’s changes undone' : 'File changes undone (' + (Number(ev.files) || 0) + ' files)';   // #5153 slice 4
    case 'reopened': return 'Put back';
    /* #3951: who marked it built and what was left; and why the mark went. */
    case 'built': { const who = ev.person ? 'You' : nameOf(ev.by); return (who ? who + ' marked it built' : 'Marked built') + (ev.note ? ': ' + ev.note : ''); }
    case 'unbuilt': { if (ev.reason === 'new work') return 'No longer built: there is new work on it';
      if (ev.reason === 'it repeats') return (ev.person ? 'You made it repeat' : 'Made to repeat') + ', so it is no longer built';   // #4787
      const who = ev.person ? 'You' : nameOf(ev.by); return who ? who + ' took the built mark off' : 'Built mark taken off'; }
    default: return String(ev.kind);
  }
}

module.exports = { phrase };
