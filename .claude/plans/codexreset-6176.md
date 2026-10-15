# codexreset-6176: a Codex window's meter goes at its reset on a list left open (#6176)

## Done when
- On Settings > AI Models left open, a ChatGPT sign-in's window meter (from #6203) goes away just after its reset, as
  Claude's five-hour line does (#6189); the other windows stay.
- render-account-codex-6176 has an arm for it that fails without the change; render-account-fivehour-6176 still passes.

## Built
- web/index.html: each Codex meter carries data-resets; ACCT_RESET_SEL names both kinds of meter; acctFiveHourRepaint
  arms the shared timer from every Claude five-hour reset and every Codex window reset in the list. The timer, retries,
  section-switch and window-return looks are #6189's, unchanged.

## Calls
- One timer for both providers, not a second one: the reset paths (failed read, busy list, section switch, sleep, a
  read in flight) are already handled once; a second timer would need all of that again.
- A weekly window resets days out; the timer's six-hour cap means a list left open that long is read again every six
  hours until then, as for any reset more than six hours away.

## Weakest premise
That the Codex meter's windows reach the page with the same resetsAt (epoch ms) the server sends today (#6203).
