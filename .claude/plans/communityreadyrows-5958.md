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

## Review 2 (2026-10-13, sonnet), at 4335865c7
0 BLOCKER, 0 WARNING, 0 CONVENTION, 3 NIT. Converged.
- **NIT, not taken:** the "Needs you: " prefix repeats, for a screen reader, what the dot already says to the eye.
  That is on purpose: the dot is hidden from a screen reader, so the words are the only place it hears it.
- **NIT, not taken, a design call:** the dotted first line's text starts 14px right of the lines under it. The
  design reviewer sees it in the new shots and decides.
- **NIT, not recorded:** the reviewer's reply was cut off partway through the third. I did not ask for it again
  and I do not know what it said.

## The browser check and the shots (2026-10-13, finished 11:35 and 11:36 CDT, at 4335865c7)
- `render-community-ready-5958.js`: exit 0, 61 arms passed, 0 failed. The seven arms that MEASURE the review's asks:
  the name is 15px semibold over a 14px summary; the two colours differ (rgb(20,22,26) and rgb(74,79,87)); only the
  row with something waiting has a dot, once, before its words; the dot is a round 8px mark, rgb(179,38,30); nothing
  carries a left bar; in the open row the first line alone has the dot; the items sit 0px apart.
- Four shots, light and dark, desktop and phone, in ~/work/design-shots/kosmos-5958/. The tool's phone audit: no tap
  target under 44, no field under 16px.
- **I looked at all four.** What they show: the name reads first and the summary under it is quieter; one red dot on
  the row that needs the person, and one on the first line when it is open; no bar down the side; in dark the
  summary is a lighter grey on the dark card and reads easily (this file's weakest premise). Two things a design
  reviewer may not like, both real in the picture: the dotted lines' words start a dot's width to the right of the
  lines under them (review 2's NIT), and the closed row's dotted summary starts to the right of the other rows'
  summaries for the same reason.

## One commit after the browser run (68732d0bb), words in a CSS comment
The surface gate failed on this branch when I ran it alone before opening the PR: a CSS COMMENT I wrote named the
tasks panel's id, which three task checks claim as their surface. The comment now says "the tasks panel". The rule
beside it is byte for byte what the browser measured. After it: the surface gate exits 0, every `web*.test.js`
passes (2763), the source-sweep guards pass (134). The browser check was NOT rerun for a comment.
I ran the gate here because the same gate, unrun after a last fix, turned kosmos#6057 red this morning.

## Not run
The full suite on this branch (CI runs it on the PR). A person or the design reviewer looking at the new shots:
asked, not yet answered when the PR was opened.

## The design review's second pass, and the hanging dot (2026-10-13)
Mona Lisa looked at the four shots and approved with ONE change (on #5958): hang the dot in the margin, so the words
it marks start on the same edge as the lines around them. Both things I had flagged in the shots had that one cause.
She kept the two dots in the open row (the summary marks the row, the first line marks the item) and the 13px third
size (a later card).
- Built at 408cb5c3e: the dot is pulled back by its own 8px and the 6px after it.
- The browser check has a new arm, HANG, at the desktop width and at 390 px: where the WORDS start (the first text
  the eye meets, not the box), dotted against plain, in the summary and in the open row; each dot wholly left of its
  words; no dot off the screen.
- **Measured by CI's browser-checks run on the PR at 408cb5c3e (run 38434115121), all ten HANG arms passed:**
  desktop, the dotted and the plain summary both start at 546.5 and the dotted first line and the line under it both
  at 566.5; at 390 px, 49 and 49, 69 and 69. The dots sit 6px left of their words (532.5 to 540.5, 552.5 to 560.5;
  35 to 43, 55 to 63).
- My own run of the check and the new shots are still waiting for a turn on this machine. Nothing here rests on
  them; when they come they go on the card for her.
- At that head CI's four workflows on the PR are green (test, browser-checks, linux-setup, windows).
- No reviewer has read 408cb5c3e. It is one CSS property, a comment, and the check's new arm.
