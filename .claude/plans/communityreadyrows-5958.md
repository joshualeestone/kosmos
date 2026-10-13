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
That the summary, one step smaller and in the secondary colour, is still easy to read in the dark theme. Read from
the source by review 1: `--label-2` is defined on `:root` and in every theme and contrast mode, and in the light
theme it is the same value the summary had before, so only the dark theme's summary changes colour. The browser
check asserts that it differs from the name's colour, not that it is readable; the shots are where that is judged.

## What would change this
A second thing on a row that needs the person. Then `needsYou` is a list of parts, not the first one.

## A third size in the open row, said here because the change list did not
The open row's lines are `<p class="dhint">` inside the Settings panel, and `.panel p` out-ranks `.dhint`, so they are
13px where the name is 15px and the summary 14px. That is from slice 2, not from this change, and it is why the
review measured the items 25px apart: 13px at the panel's 1.6 line height, plus the 4px this change removes. The row
is three sizes; the design reviewer will see it in the new shots.

## Review 1 (2026-10-13, default model), at b1938a6ab
0 BLOCKER, 1 WARNING, 2 CONVENTION, 4 NIT. Not converged.
- **WARNING, taken:** the check's TIME arm read the reminder line by its place in the row, and this change moves it
  down one (the line that needs the person is first now). The check had not run, so nothing had shown it. The line is
  found by its opening words now.
- **CONVENTION, taken:** a test comment still said the parts are joined by a full stop.
- **CONVENTION, taken:** the check's header lists the new LOOK arm and what OPEN now holds.
- **NIT, taken:** the weakest premise, rewritten from what the reviewer read in the source.
- **NIT, taken by saying it:** the third size (the section above).
- **NIT, taken:** the phone arm's longest-summary row sends `needsYou` as the board would.
- **NIT, not taken:** a markup case for `needsYou` in the HOSTILE arm. It is appended as a text node, like every
  other string in the row; the arm covers the name, the summary, a line and the words after a time.
- The reviewer traced every rule that can apply to the name and the summary and found the LOOK arms would hold. A
  reading: the run is the measurement.
