# computers-8325: the computer switcher does not vanish before the first answer

Josh, 11-09 13:28, on his laptop: the top-left computer control was gone until the first read of his computers landed. It starts false on every page load and lives only in page memory.

## Change
web/index.html remembers the last good answer in this browser (localStorage: that there is somewhere to go, and this computer's own name) and starts the control from it. A good answer overwrites or clears it. A failed read changes nothing, as before.

## Decided
- As the card recommends. Rejected: always showing the control (reverses #6396 for one-computer people); shortening the backoff (does nothing before the first answer, and each read is a signed call).
- Stores no other computer's name or address. This computer's name is already on this person's own screen.
- Not marked as unconfirmed. A remembered control goes after four failed reads with no answer (about two minutes), so a computer whose reads never succeed does not keep offering an empty menu; what is remembered stays, so the next load shows it again for those two minutes.
- A remembered value does not count as seen for the first-time tip, so the tip keeps its one turn.

## Weakest premise
That the page reloaded at all, which nothing here can measure. If it did not, this does not address what he saw, and the next step is the laptop's log from the next occurrence.

## Not covered
Until the first answer or four failed reads, a person whose second computer was removed elsewhere sees a control that then goes.
