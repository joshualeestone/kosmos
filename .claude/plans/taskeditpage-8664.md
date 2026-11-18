# taskeditpage-8664: edit a task's title or detail on its page (the page half of #8664)

Card: kosmos#8664. The command-line half merged as #8688 (POST .../task/<n>/text, `kosmos task edit`). Night shift,
Renet Tilley.

## Decision
- The task page gets a quiet "Edit title or detail" link under the title (linkish, as "+ Add subtask": the page's one
  strong action stays Mark as done). It opens a full-width form under the head with the task's title and detail, the
  title focused; Save (the page's primary style) and Cancel (secondary).
- Save sends only what changed to the #8688 route; an emptied detail is sent as null (cleared); an empty title is
  refused on the page with nothing sent. From the page the edit is the person's, so the route records it as theirs
  and an agent cannot later reword it. The board's refusal words show in #tk-msg.
- The form has its own inputs, which paintTaskPage never touches, so the five-second repaint cannot wipe what is
  being typed; opening another task closes it; Save and Cancel give focus back to the link.
- docs/browser-checks/render-taskedit-8664.js pins all of it, light and dark, 1400 and 390.

Rejected: editing the title in place (contenteditable on #tk-title): the repaint rewrites #tk-title every five seconds.
Rejected: a modal dialog: the task's other fields stay visible while the person rewords it.

Decided: the link shows on a closed task too, as the route allows (correcting what a task was called changes no work;
done-when refuses a closed task because a check is what the work was judged against, which a title is not).
Save compares against the words the form opened with (kept on the form), not the polled task, so an agent's change
made while the form is open is never sent back over; a save that returns after another task opened leaves that page
alone.

## Weakest premise
That no other task-page script writes to #tk-msg while the form is open; a message from elsewhere would replace a
refusal shown there.
