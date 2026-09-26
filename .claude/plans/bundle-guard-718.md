# bundle-guard-718: the bundle build checks the connector knows mac-request

Card: #718 follow-up named in docs/phone-push-go-live.md step 6. Go from Liu Kang (m494), with one
ask: while the gate is false the note is ONE calm line, because release agents cut from this script
every day.

## Finished means
`tools/build-kosmos-bundle.sh` refuses to bundle a tunnel that does not know `mac-request` when
`engine/phonenotify.js` has `PHONE_APP_CAN_RECEIVE = true`, and prints exactly one line (and goes on)
while it is `false`, saying truthfully what stays inactive. A gate line it cannot read refuses. Tests cover every arm, run from
`test:shell`, and mutations of each rule go red.

## Decisions
- **Probe the binary, not its commit:** `"$bin" mac-request --help` exits 0 on a tunnel that has the
  verb and 2 with "unrecognized subcommand" on an old one (measured on this Mac's 9984170 build).
  Rejected: comparing `.commit` against e39eeca, which needs the relay checkout's history on the
  build machine.
- **Read the gate by its exact declaration line**, not by loading the module (which pulls in
  engine/remote.js). A reworded line refuses rather than guessing; a test pins that the real file
  still matches.
- Placed after the arch and provenance checks and before the copy, so it vets exactly the input
  being staged.

## Correction after rebase (2026-09-24)
The first version said nothing calls `mac-request` while the gate is closed. That was false once
kosmos #3626 (67b5ca8b) landed: `engine/mac-standing.js` and `engine/updating.js` call it whenever
Plus is on. I proposed refusing always; Liu Kang disagreed, and his reasoning checked out against the
code: the prod coordinator (2226c9d) runs both routes through `verify_mac_request`, and 0.6.91 sends
them unsigned, so both already fail today (Raiden measured the 401 on #3626). An old tunnel breaks
nothing that works; it only leaves #3626's fix inactive. Refusing always would halt every release cut
until someone ships a rebuilt tunnel, which is the Josh-gated tunnel release. So the rule stays
gate-based, and the gate-closed line now says what stays inactive instead of "harmless".

The rule rests on exactly three callers (mac-standing.js, phonenotify.js, updating.js). The test pins
that set, so a new caller turns CI red until someone re-decides whether an old tunnel breaks it.

## Weakest part
The gate is read by text, so a refactor that moves the constant (for example into a config object)
makes every bundle build refuse until this lib is updated. That is loud rather than silent, and the
test that reads the real engine/phonenotify.js fails first, in CI.
