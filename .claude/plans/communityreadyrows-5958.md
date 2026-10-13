# communityreadyrows-5958: the design review of "Where each agent stands"

Card kosmos#5958, items 4 and 5: a follow-up to slice 2 (kosmos#6039, already on main). The screen merged before
anybody had looked at it: its design shots waited four hours for a turn and the PR's checks finished first. Mona
Lisa reviewed the shots afterwards (kosmos#5958, 2026-10-13) and asked for five changes. This is those five.

## Change
1. **The name leads a closed row.** The name takes the size the summary had (`.9375rem`) and is semibold; the summary
   is one step smaller (`.875rem`) in the secondary colour.
2. **What needs the person comes first in the summary, with a noun and a dot.** `2 items waiting for you` is the
   summary's first part (it was last, as "2 waiting for you"). The parts are joined with a middle dot and carry no
   full stops. The board also sends those first words alone as `needsYou`, and the page draws the Tasks page's
   Needs Your Decision dot before exactly those words. A dot, never a left bar.
3. **The same in the open row.** The line "N items it wrote are under Waiting for you." is first and is the only one
   marked (`needsYou: true`); the page draws the same dot before it.
4. **The note is two sentences** (the review's exact text).
5. **The open row's items have no gap between them**, so they sit as close as the note's own lines.

The board still builds every word; the page still writes only times and, now, the dot. `engine/communityready.js`
decides which words need the person; the page reads no wording to find them.

## Decided
- **"Waiting for you" is not made a link.** The review offered it as my call. It is a behaviour change (focus moves,
  the list above may be closed or empty by the time it is pressed) that deserves its own look, not a rider on a
  restyle.
- **The dot's colour is `var(--danger)` directly.** `--tsk-decision` is that colour but is defined on `#panel-tasks`
  only; used in Settings it would be undefined and the dot would paint nothing.
- **A screen reader hears "Needs you: " before the marked words** (a visually hidden span, as the other dots in the
  app have). The dot alone says nothing to someone not looking.

## Rejected
- Putting the wording rule on the page (find "waiting for you" in the summary and mark it). The page would be
  reading wording, which slice 2's rule forbids, and a reworded summary would silently lose its dot.
- A second summary field for the page and the old one kept for anything else. Nothing else reads `owner.summary`
  (searched: the engine file and its test are the only readers), so there is one summary.

## Verify
- `node --test engine/communityready.test.js`: 46 pass. New assertions: the marked line is first and the only one
  marked; `needsYou` is the summary's first part; no full stop between or after the parts; controls with nothing
  waiting.
- Every community test (engine, cli, server): 990 pass, 0 fail. The source-sweep guards: 197 pass. Every
  `web*.test.js`: 2763 pass.
- The browser check `render-community-ready-5958.js` has seven new arms that MEASURE the review's asks: the name is
  larger than the summary and semibold; the two differ in colour; only the row with something waiting has a dot, once,
  before its words; the dot is a round 8px mark with a colour; nothing has a left bar; in the open row the first line
  alone has the dot; no gap between items.
- **NOT RUN: any browser check.** Every size, colour and spacing claim above is what the CSS should give, and on the
  last screen I worked on that reasoning was wrong twice in a row (a panel's rule on `<p>` out-ranked the class). The
  check is queued; nothing about the look is claimed until it has run.
- NOT RUN: the full suite; new design shots.

## Weakest premise
That the secondary colour (`--label-2`) is defined, and readable, in Settings in both themes. It is used by the
chevron in this same list already, which is why I believe it; the browser check asserts only that it differs from the
name's colour, not that it is readable.

## What would change this
A second thing on a row that needs the person. Then `needsYou` is a list of parts, not the first one.
