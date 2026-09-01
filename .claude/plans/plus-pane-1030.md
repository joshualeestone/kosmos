# Settings > Kosmos+ screen 1 (#1030) — HANDOFF LEDGER

**Branch:** `plus-pane-1030` · **HEAD:** `539c82cc` · pushed, clean, 0 behind main
**State:** built and green. **No challenge loop has been run.** No proof file exists, so
`gh pr create` will be refused by the gate until somebody runs one.

Handed off by Angel at ~90% context on Splinter's instruction, rather than starting a loop
that could not finish. The previous loop on this repo converged at iteration 35; that does
not fit in what I had left, and running out mid-loop leaves a branch with no proof and no
ledger, which is worse than either.

## What this is

The in-app Settings > Kosmos+ pane, screen 1. It replaces a prose pane with the designed
screen: five value cards, a heading, the honest signup sentence, and two doors.

Rendered copy, as it now stands:

```
Your Kosmos, wherever you are
Access your agents and projects from your phone or any computer, even while you are
away from this computer. Get notified when work finishes or an agent needs you.

  Access Kosmos anywhere   Open your board from another computer, tablet, phone...
  Kosmos on your phone     Use the native iOS and Android apps...
  Know when you are needed Get notified when an agent finishes, hits a blocker...
  Work with others         Invite people and their agents into selected projects...
  Private by design        Your work remains on this computer. Connections are
                           end-to-end encrypted, and every new device requires approval.

Sign-up is not open yet. When it opens it happens on the Kosmos website, not in here...

[ Join Kosmos+ ]  [ Already a member? Sign in ]
```

## Built from

`/design/first-step` (screen 1) and `/design/journeys` (the flow). Per Josh's ruling those
two are the spec and the older mocks are deprecated. `plus-flow-blue` in particular is
superseded: it points at installkosmos.com where journeys points at kosmosplus.com.

## Two shipped guards constrain this, and the design violates both

The design leads on FLOW and STRUCTURE. It does not get to reintroduce either of these:

1. **`engine/machine.test.js`** forbids "this Mac" in speaking files (kosmos#1004, Josh:
   call it "this computer"). The mock says "this Mac" throughout. Kosmos does not only run
   on a Mac, and the page says "this computer" 125 times.
2. **`web.plus-tab.test.js`** forbids a hostname anywhere in this copy, because the domain
   is explicitly temporary. Every address arrives from `KOSMOS_SITE` at paint time and the
   markup carries none.

⚠️ That second guard's stated reason pairs the temporary domain with "the price is not
ruled". **Pricing IS ruled now** ($10, live). The hostname half still stands, so the guard
is right for half its stated reason. Worth correcting the comment, not the guard.

## Four defects in my own work, caught by SHIPPED GUARDS before any reviewer

This is the part worth reading. None of these was found by review; all four were found by
tests that already existed, running against the person who wrote the change.

| what I did | which guard caught it | how |
|---|---|---|
| deleted "Sign-up is not open yet" | `web.plus-tab.test.js` | it asserts the sentence is present. **It is still TRUE**: measured, kosmosplus.com says signup is not open and the coordinator refuses payments on both settings |
| put the price in my own comment | the price guard | it matches the whole section **including comments**, correctly: this page is served verbatim and its comments are public |
| shipped a dead Sign in button | the no-dead-buttons guard | state 1 grew a control with no handler |
| wrote a comment saying signing in "happens here" | `web.plus-signup.test.js` | Josh ruled signup happens on the site; my comment contradicted my own copy fifteen characters away |

⭐ Two of the four were caught **because those guards read comments**. That is the correct
design and it is worth defending if anyone proposes narrowing them: the browser does not
distinguish copy from comment either.

## One guard I NARROWED, deliberately, and why

`web.plus-tab.test.js` forbade **every** control in state 1 ("it is marketing and a link;
the sign-in belongs in state 2"). `journeys` and `first-step` both draw **two doors** on
screen 1, so the spec moved.

The rule's real protection is *do not ship a button the service cannot honour*. A control
that NAVIGATES honours exactly what it says. So it now forbids **a control that promises a
service** rather than any control, which is what it always meant.

**The door earns its place:** `state2` is otherwise **unreachable**. `paintPlus` shows it
only for a configured machine and nothing signals payment, so without this control the
designed sign-in screen cannot be seen at all. That is Josh's 2026-08-30 ruling ("i dont
care if the app side is ready yet ... i want to see all the design implemented").

Perturbation-verified, three arms: no handler reds, a different control reds, deleting the
honest sentence reds.

## CSS decision

Uses the page's own `--k-*` tokens, **zero hardcoded colours**. The design pages are the
dark marketing site; this pane lives in an app with light and dark themes, so copying the
mock's literal palette would have looked right in one theme and wrong in the other.
Structure and copy from the design, colour from here.

## What a loop still needs to check

Nobody has reviewed this. Specifically unexamined:

- **the rendered pane in a browser, in both themes.** I asserted the CSS uses tokens; I did
  not render it. Contrast, wrapping at narrow widths, and the value grid's `auto-fit` at
  small sizes are all unverified.
- **the second door's destination.** `plus-site-link` gets `KOSMOS_SITE + '/plus'` where
  `KOSMOS_SITE` is `installkosmos.com`. That URL is live (200, real Kosmos+ page), but
  `journeys` says signup happens at **kosmosplus.com**. Three Plus pages now exist and I
  did not repoint a shared constant on my own judgement. **This is the most likely real
  defect on the branch.**
- **whether my new pins can be defeated by a different legitimate form.** They were
  perturbed by deletion and by substitution, not exhaustively. On this repo a pin has been
  defeated three separate ways today: a negation, a swapped ternary arm, and a different
  spelling of the same markup.
- `state2` and `state3` are untouched by this branch and unverified against the design.

## My weakest premise

**That screen 1 is the right unit of work.** I built one screen of a six-screen journey
because it was the one Josh named and the one my file owns. If the pane is meant to carry
the whole in-app flow, this is a foundation and not a deliverable, and the next four
screens will want a different structure than the one I chose (a single `plus-state1` block
that swaps to `plus-state2`).

Second weakest: **I decided "Already a member? Sign in" should reveal state 2 rather than
open the site.** `journeys` shows both doors on screen 1 but does not settle where the
sign-in one goes. Revealing state 2 is defensible because the sign-in must happen in the
app (different origin, no session to pick up), and because it makes an unreachable screen
reachable. It is still my call, not a ruled one.

## Not mine, raised elsewhere

- `delivery.rs` emails "sign in to Kosmos" while the page says "Kosmos+". Routed to Mona
  Lisa. It fires on `signup/start`, so it is on the live path today.
- `design/signin-branded.html` carries every pre-rename string and is internally
  contradictory. Named on kosmos-relay PR #12, not edited.
