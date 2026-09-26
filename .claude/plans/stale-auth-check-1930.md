# #1930: a browser check for the "haunted" board (stale 401 in a fixed agent's pane)

## Finished looks like
- docs/browser-checks/render-stale-auth-1930.js boots a real board with an agent whose pane holds a
  real Claude 401 envelope in its history and whose launch job is on file (the engine only asks the
  account for an agent with a readable job). Account check connected: the board status does not
  report auth_failed and the card does not say "Sign-in isn't working". Control, account signed
  out: it does report auth_failed and the card says so.
- Passes on the SERVED prod 0.6.95 bytes (built from 9dec76140) and on main. Measured red with the
  engine's suppression switched off.
- Wired: README row, runner list; EXPECTED_SITES unchanged (measured by the reason-grep test).
- #1930 closes with the served-build evidence and shots: this is the live board check the card was
  parked on (needs-browser).

## Calls
- The check asserts only that the stale failure is gone. What the card shows instead is the
  engine's re-read with the sign-in signal set aside; in this sandbox that is "Can't tell". A third
  arm (an agent reporting work) was tried and dropped: it still read unknown here and I could not
  establish why without more digging, so the check claims nothing about it.
- Sub-case 2 (a live loop under a cached healthy check) stays with its unit test; a browser check
  would need the pane to grow between ticks.
- Weakest premise: the fixture's plist is what makes the engine consult the account; a real agent
  always has one, but a board whose job read fails would leave auth_failed standing by design.
