# swarmsettings-4433: the Swarm Settings box and view (#3946 item 14)

Card: #4433 (priority, claimed pigeonpete). Josh, 2026-09-28 17:11: "When are we putting our stuff for the swarm agents into the agent settings? So we can get it out of the left-hand column."
Design: Mona Lisa's on #3946 (2026-09-26 12:46).

## Built (web only; the engine already has all three states and the limit override)
- **The Swarm Settings box**, below the four-pack, the same size and shape as Direct Message. Swarm agents only (swarmPagePaint shows it).
  - A state pill with a dot and a word: Active, Paused, Paused (limit), Stopped.
  - The whole box has a soft 14% tint of the state colour. No left bar; the gold edge marks it open.
- **The view** (`#d-sec-swarm`): the heading and Mona's sub-line, then three state cards, then Maximum helpers, Daily usage limit and Today.
  - The cards are a custom `role="radiogroup"` with roving focus: arrows move, Space or Enter picks, a click picks.
  - Active: PUT {active:true}. The engine gives today's override when the swarm was limit-paused, so Active stays available over the limit.
  - Paused: PUT {active:false}.
  - Stopped asks first, inline ("Stop now? Unfinished work is dropped.", Stop now / Keep it running; Escape keeps). Stop now POSTs swarm/stop.
  - Limit-paused: the Paused card carries "It reached today's limit and resumes tomorrow.", with a "Change today's limit" link that focuses the limit slider.
- **The old header panel is gone.** The controls keep their ids, so swarmPagePaint, swarmSend, the busy guards and the metered-false honesty are unchanged.
  - The phone chat-first header rules for it (the 190px floor and the compact controls) are removed, because they no longer match anything.

## Decided
- **A custom radio group, not native radios.** A native radio picks on an arrow key, and a pick applies at once, so arrowing past Paused would pause a live swarm. Mona's spec also says arrows move and Space or Enter picks.
- **Picking Stopped again when it is already chosen** re-offers the stop only while a stop could still do something. That is the old Stop now's disabled rule, kept as `SWARM_STOP_SPENT`.
  - When it could, a line says "It is still finishing what it was doing. Pick Stopped again to stop it now."
- **From Paused (by the person or the limit), Stopped always asks.** It is a real change: a limit pause resumes by itself, a stop does not.
- **The poll never moves the reader** (web.agent-nav.test.js). A view left open when the swarm field goes stays, and says "Swarm settings are not available for this agent right now." My first version called detailGo from the paint; that test caught it.
- **On the phone**, the Swarm Settings box joins the section strip as a pill with its dot. The word stays for a screen reader.

## Rejected
- Keeping Stop now in the phone header "for speed": Josh asked for the controls out of the left column, and the phone reaches the view in one tap from the strip.
- A modal for the stop question: Mona specified inline.

## Weakest premise
That removing Stop now from the phone chat header costs nothing important. A person on a phone now needs two taps plus a confirm to stop a swarm, where it used to be one. That is Mona's design and Josh's ask, and it is reversible.

## Checks
- render-swarm-ui-3564: 104 pass. New arms S42 (the box), S30 (the cards), S43 (the keys), S44 (Stopped asks first). The stop arms are rewritten for the cards.
  - Mutants, each red: Stopped skips the question (S44), an arrow picks (S43), the box never shows (S42).
- render-dm-chatfirst-718, render-signin-visible-3892 (134, pin updated with its derivation) and render-dm-sideways-3969: the header arms now assert that no swarm control is in the header and that the Swarm Settings pill is on screen.
- web.agent-nav: 10 sections.

## Review round 1 (opus, blind): 1 BLOCKER, 4 WARNINGs, 3 NITs, all but one answered in code
- **BLOCKER** The stop question focused Stop now, so a held or doubled Enter on the Stopped card confirmed an irreversible stop.
  - Measured with a mutant: a held Enter sent POST swarm/stop twice.
  - Fixed: the question focuses Keep it running, and a repeated key on a card picks once.
  - S44 now holds Enter and asserts nothing is sent; the Stop-now-focused mutant goes red with the two POSTs.
- **WARNING** The phone strip hid the pill's word, leaving colour alone (WCAG 1.4.1, Mona's reason for the word). Fixed: the word stays.
- **WARNING** The flag's paused arms were dead, and S8/S17/S21/S24 tested the flag, not the page. Fixed: they now pick Stopped and assert that it asks (the new "from Paused, Stopped always asks" rule). The flag is only asserted in S12, where it is read.
- **WARNING** The pill overlapped the label in the 220px desktop column (seen in the screenshot). Fixed: it sits under the label.
  - This deviates from Mona's "at the right"; the column cannot hold it there.
- **WARNING** Two quick picks flickered the cards. Fixed: one change at a time (a pick while one is in flight is ignored).
- **NIT** The card's line was read twice. Fixed: aria-labelledby names it by its name only.
- **NIT** A poll reset the tab stop under the person's focus. Fixed: a focused card keeps the tab stop.
- **NIT** A stop reply could move focus into another swarm, and the question stayed open across sections. Fixed: focus only for the same agent, and leaving the view closes the question.

## Validation (first run): 1 red, mine
- server.test.js pinned the nav pill order and the section order at nine. Updated to ten, with Swarm Settings last and its label pinned, plus an assertion that it sits below the four-pack.
- Negative control: the same markup with the box moved above the pack fails that assertion.

## Review round 2 (sonnet, blind): 0 BLOCKERs, 1 WARNING, 1 NIT
- WARNING Stop now did not check SWARM_BUSY, unlike swarmPick. It was not reachable twice in practice (the first click hides the question), but it is now guarded the same way.
- NIT A click on a card during a change moves focus but picks nothing, with no signal. KEPT: the change in flight answers within a second, and its message line then speaks.

## Review round 3 (opus, blind): 0 BLOCKERs, 2 WARNINGs, 4 NITs, all fixed
- **WARNING** "It is still finishing" was printed from the cautious rule, so it showed on no evidence (a partial read, an unknown lead). Fixed: the line needs a counted helper or a lead reported working.
  - New arm S45 (stopped, partial read, lead idle: no line; re-picking Stopped still asks).
  - A mutant restoring the old rule goes red with the false sentence.
  - Known and accepted: right after a stop, the row says working until the next poll, so the line can show for one poll beside the done message. It is true of the last reading.
- **WARNING** One global SWARM_BUSY let one swarm's hung request freeze every other swarm's controls. Fixed: busy blocks only the swarm it is for (both handlers).
- **NIT** The pill lagged the optimistic cards. Fixed: swarmPillPaint is painted with the cards.
- **NIT** The stop question survived the field going. Fixed: it closes when the field goes, and on any section that is not the view.
- **NIT** Stale comments. Rewritten.
- **NIT** Dead `.swstop:disabled` CSS was removed. Re-picking a used-up Stopped now says "It is already stopped, with nothing left running."

## Review round 4 (sonnet, blind): 0 BLOCKERs, 1 WARNING, 1 NIT
- WARNING Nothing tested round 3's per-swarm busy fix. Added to S16: with crew's stop in flight, a pick on crew2's view sends crew2's PUT. The mutant restoring the global `if (SWARM_BUSY) return` goes red (crew2 sent nothing).
- NIT The "already stopped" line has no null guard on #d-swarm-msg. KEPT: unreachable without the view (swarmPick returns first without SWARM_ROW), and it matches swarmSend's convention.

## Review round 5 (opus, blind): 0 BLOCKERs, 1 WARNING, 2 NITs, all fixed
- **WARNING** A screen reader never heard the box's state. An older `.snav button:not([data-dot]) .vh { display: none }` rule hid my `.vh` state copy, and the visible pill was aria-hidden. My round-1 note ("the word stays for a screen reader") was false.
  - Fixed: the pill's word is the spoken state, so the button's name is "Swarm Settings Active".
  - S42 and S8 now assert the accessible NAME via getByRole, not a span's text.
  - A mutant re-hiding the pill turns both red.
- **NIT** The chat's paused refusal said "switch it back on", but the switch is no longer above the conversation. It now says "set it to Active in Swarm Settings" (engine/swarm.js pausedSentence; engine tests 171/171).
- **NIT** Two nested landmarks shared one name. The inner panel's name is removed.

## Review round 6 (sonnet, blind): 0 BLOCKERs, 1 WARNING
- WARNING Nothing pinned the new refusal wording. Added engine/swarm.test.js "#4433": every reason names "Set it to Active in Swarm Settings" and never "switch it back on". Control: the old copy restored for 'person' (applied 1) turns it red.

## Review round 7 (opus, blind): 0 BLOCKERs, 1 WARNING, 1 NIT
- **WARNING** The Paused card's aria-describedby always named the limit line, and a hidden element named that way is still read. A person-paused swarm was described as having reached today's limit.
  - Measured in Chromium: the accessibility tree's description carried the false sentence.
  - Fixed: the limit line joins the description only while it is true.
  - S8 and S21 read the description from Chromium's own accessibility tree (CDP getFullAXTree). The mutant with the static description turns S21 red with the false sentence.
- **NIT** In Firefox, Space on Stopped may open the question and close it on keyup, because focus moved to Keep it running. KEPT: it only ever lands on the safe answer, and Kosmos runs on Chromium and WebKit (the gate runs Chromium).
