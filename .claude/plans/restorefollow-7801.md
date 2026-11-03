# restorefollow-7801: restore screen follow-ups (kosmos#7801)

Follow-up to #7404's restore screen (#7808), from its review round 8. Two items.

## 1. A refusal outlives its state

`#pb-files-msg` (role=alert) kept a refusal until the next See or Restore press, so a restore that
ended meanwhile showed its end line beside a message that no longer applied.

Call: `pbfRead` clears the message when a read sees a restore START (not running -> running) or END
(running -> not running). One exception, held on the message rather than on a read: a start refused
with code `restore_running` sets `PBF.msgRunning`. That message is kept by any read that sees a
restore running (it is what the message says) and cleared by any read that sees none running,
whether or not a read ever saw the other restore (challenge iteration 2). Any `pbfMsg` call resets
the flag.

Known and accepted: a read that sees a start or an end also clears a message from the person's own
See press ("There are no backups from this account yet."). A missing sentence, never a wrong one.

Rejected (challenge iteration 1): exempting forced reads. The exemption then belonged to a read, not
to the message, and missed both ways: a refused start whose own read failed lost its reason to the
next idle read, and a Stop refused for any reason whose own read saw the end kept a stale message.

Weakest premise: the only refusal that survives a start is the one coded `restore_running`. A
refusal the board words the same way under another code is cleared on a start (the conservative
direction: a missing sentence, never a wrong one).

When a restore this tab saw end has no answer to show, focus goes to See your backups rather than to
the now-always-shown, empty end line.

## 2. The end line may not be announced

`#pb-files-last` (aria-live=polite) changed `hidden` and its text in the same repaint, and many
screen readers do not announce a region that appears already filled.

Call: the region is never hidden (markup, paint). Only its text changes. `.fhint:empty` is
`display: none`, which would drop the empty region from the accessibility tree exactly as `hidden`
did, so `#pb-files-last:empty { display: block; margin: 0; }` overrides it (id beats class), leaving
no band when empty.

Then (challenge iteration 7): an always-present live region reads aloud whatever the first read
after a show writes into it, so an end from hours ago would be announced as news. The region starts
`aria-live="off"` and `pbfPaint` makes it polite only once a paint has already shown the board's
answer (`PBF.liveReady`). The first fill after a show (page load, or On after Off, when the status
is null) is quiet; the 5-second repaint makes it polite before any later read, so an end this tab
sees is announced. Weakest premise: this relies on a paint running between the first read and the
next one. Today every later read goes out from `pbfShow`, which paints before the answer lands; a
new caller that reads twice with no paint between would fill the second quietly too.

## Not in scope (card's smaller notes)

- A restore that starts and ends between two 60-second idle reads leaves an old list up.
- A failed partial restore does not say how many files landed. New copy wants Mona Lisa's words.

## Tests

`web.pbrestore-7404.test.js`, each new test red-checked against a mutant of the page:
- refusal cleared on a later read that sees an end, and one that sees a start (red on main's page);
- refusal kept on a read that sees no change;
- an "already running" refusal kept when its own read sees the restore, and when only a later read
  does (red with the `PBF.msgRunning` exemption removed);
- a refused Stop whose own read sees the end loses its message (red with a forced-read exemption);
- a start refused for another reason is cleared when a restore begins;
- an "already running" refusal cleared by a read that sees nothing running, with and without a read
  that saw the restore (red with that message never cleared);
- the end line never hidden in markup, CSS and paint (red on main's page); two older assertions now
  check the line's text instead of its visibility;
- end focus: a stopped restore with no copy focuses the end line; an end with nothing to say focuses
  See your backups (red with focus always on the end line);
- Off drops a kept refusal and its flag.

`docs/browser-checks/render-pbrestore-end-7801.js` (Chromium and WebKit, page from disk, no board):
CONTROL an empty `.fhint` computes display none; while a restore runs the end line is shown, empty,
display block, no height; at the end the same element carries the end words; the read that sees the
end clears an old refusal. Red on main's page, and with the `#pb-files-last:empty` override removed.
It measures display, not the accessibility tree itself.
