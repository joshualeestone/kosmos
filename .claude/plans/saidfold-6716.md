# saidfold-6716: the agent page shows a screen line only when the agent is waiting on something

Card: #6716 (Josh's tiles card). Addition relayed by Splinter 2026-10-20 11:36 (comment on #6716): on an agent's
page, under the Working pill, it showed "<name>'s screen said: ✻ Fermenting... (10m 20s · ↓ 3.3k tokens)", Claude
Code's raw spinner. Wanted: plain "Working for 10 min" or nothing; raw screen text only behind details, and only for a
stuck prompt.

## Done when
- A working (or idle, stopped, restarting, unknown) agent's page shows no screen line at all.
- A waiting agent (needs_you, needs_trust, blocked, auth_failed, rate_limited, connection_lost) shows it, inside a
  closed disclosure whose summary is "What <name>'s screen said"; opening it shows the quote.
- The quote no longer draws a solid left bar (Josh's ruling); it is a hairline box.
- Every test and browser check that pins this element follows the new structure.

## Decisions
- **Nothing for working, rather than "Working for 10 min".** The pill already says Working; a duration would need a
  start time this card does not have a reliable source for. Rejected: parsing the spinner's own timer (that is
  reading the CLI's chrome, the thing this removes). Weakest premise: Josh may still want a duration; that is a
  separate, small follow-up if so.
- **An allowlist of waiting states** (`SAID_STATES`), not "everything but working": a new state shows nothing until
  someone decides it should. Working's retry line ("Retrying in 5s") is hidden too: it is raw CLI text.
  needs_you includes a question the agent reported itself (its words, folded like a trust prompt's): on purpose.
- **The fold's summary is a Tab stop** (a keyboard must be able to open it). Both engines reach it by Tab
  (Option-Tab in WebKit); render-signin-visible-3892 asserts Enter toggles it there, then steps on.
- `.detail-said` leaves web.no-left-bars-3692's allowlist, since it has no left bar now.
- **The conversation's busy line for a failed sign-in no longer quotes the screen** ("last seen: ..."): it was the
  same raw text, unfolded, on the same page as the fold. It still says the sign-in is not working. The guide's side
  chat has no fold, so it keeps the quote (busyRow's `{ quote: true }`, review 8).
- **The fold closes for a new wait (including a move to a different waiting state, review 12), another agent, or a
  page open**, and not when a waiting agent's screen text is empty
  for one poll (review 11 reversed the earlier acceptance: two blind reviews raised it, and keying on the wait was a
  three-line change). Weakest premise: that the engine's state stays in SAID_STATES across that gap.

## Files
- web/index.html: `SAID_STATES`; `paintDetailState` gates the line and the fold; markup `<details id="d-said-box">`
  with `<summary id="d-said-lab">`; `.detail-saidbox`, `.detail-saidlab`, `.detail-said` CSS.
- Tests: web.pill-remembered-3958 (harness + the stale-sample test rewritten: a waiting state shows the line, working
  never does), web.said-attrib (markup and label pins), web.replychan-5820 and web.healthline-5959 (harness),
  web.no-left-bars-3692 (allowlist), web.reply-where (the side chat keeps the quote, the agent page does not; a
  fleet card).
- Browser checks: render-signin-visible-3892, render-dm-chatfirst-718 (open the fold to measure it at its tallest),
  render-agent-pill-3958 (the fold shows for auth_failed and is gone for working), render-busy-anim-3421. The three that
  read the fold (3958, 718, 3892) name d-said, d-said-box and d-said-lab in their surface header, so a change to the
  fold selects them.

## Review 14
- **Not changed:** when the fold hides under the keyboard, focus moves to the state pill, which may draw the browser's
  focus ring there. Kept: it shows a keyboard user where focus went. Would change it: Josh finding the ring ugly.

## Review 16
- **Not changed:** an agent's own question (needs_you, reported by the agent) is folded with the screen line. The pill
  already says it has a question and one tap opens it. Weakest premise: that agents ask the question itself in the
  conversation, so the fold is never the only place it appears. Would change it: an agent whose question shows nowhere
  else on the page.
- **Not changed:** the guide's side chat still quotes a failed sign-in's screen text unfolded. It did before this card,
  and this card is about the agent page; the side chat has no fold to put it in.

## Review 17
- **Not changed:** a trust prompt's (and a block's) screen text is folded too. That is the card's ask exactly ("raw
  screen text only behind details, and only for a stuck prompt"); the page still says it in plain words ("Waiting on a
  trust prompt", with Trust & Restart). Checked: the #1918 "Sign in again" button's visible text names no quote, so
  folding the quote strands nothing.
