# opclear-2575: operator-clear route for a stale self-reported needs_you

Card: joshualeestone/kosmos#2575

## Problem

The Projects page surfaces a REPORTED needs_you (the agent's own narrative
`because`). A reported needs_you never decays (status.js rule 6). An AUTOMATIC
idle/working heartbeat is refused over a standing needs_you/blocked
(#900/#1949, selfreport.js guard `entry.auto === true && (idle|working)`). The
intended clear is the agent reporting a NON-auto state itself. An agent that
raised needs_you, resumed work, and never self-cleared leaves a sticky red with
no operator-side way to dismiss it.

## The build (engine half only; the dismiss button is Renet's web/index.html work)

1. `engine/selfreport.js` record(): add `operator` as a THIRD written provenance.
   `by: entry.by === 'operator' ? 'operator' : (entry.auto === true ? 'auto' : 'agent')`.
   Docblocks (`by` write-side and read-side) extended to name `operator`. An
   operator clear has `auto` falsey, so the #900 guard does NOT refuse it; it
   lands and supersedes the needs_you. The #900 guard itself is untouched.

2. NEW route `POST /api/agent/<sessionName>/clear-selfreport` in `server.js`:
   - Operator-only: under `/api/`, so the sensitive-route gate requires the
     board token. Kept OUT of REMOTE_AGENT_ROUTES and LOOPBACK_AGENT_ROUTES, so
     a network peer and a no-credential loopback caller are both refused. The
     target is taken from the URL, never the pane (a person reporting AS the
     agent).
   - Unknown agent -> 404 {ok:false, because}.
   - Not WAITING_ON_A_PERSON -> idempotent no-op: 200 {ok:true, cleared:false, state}.
   - Waiting -> selfreport.record(name, {state:'idle', because, by:'operator'});
     recorded:false -> 400 {ok:false, because}; success -> 200 {ok:true,
     cleared:true, state:'idle', by:'operator', at}.
   - Optional body {reason} used as the because; defaults to
     'operator dismissed a stale needs_you'.

## Safety property (stated in code + PR)

The cleared needs_you RE-DERIVES on the next poll: a scraped working outranks a
reported idle (#1995); a genuine on-screen prompt re-raises needs_you; the
agent's own next report re-raises. So an operator clear removes the STICKY
reported red, it does not permanently silence a real current need. That
re-derivation is the safety argument for letting an operator override a
self-report here.

## Tests

- `engine/selfreport.test.js`: an operator clear (by:'operator', non-auto idle)
  LANDS over a standing needs_you; the CONTROL that an AUTOMATIC idle is still
  refused (red-capable both ways); the stored `by` is 'operator'; and `operator`
  is the ONLY value a caller may assert via entry.by (a bogus `by:auto`/`by:agent`
  cannot relabel a write).
- `server.clear-selfreport-2575.test.js`: waiting -> cleared:true + record
  written; the discriminating control (clears the state an auto idle could not);
  non-waiting -> cleared:false no-op; never-reported -> cleared:false state null;
  idempotent second clear; unknown agent -> 404; operator reason stored; AUTH:
  an enforcing board refuses a no-token clear (403) and admits a token clear.

## Contract given to Renet (do not change without telling her)

POST /api/agent/<sessionName>/clear-selfreport ; board-token auth ; body
optional {reason:"operator-dismissed"} ; 200 {ok:true,cleared:<bool>,state:<fresh>,by:<prov>}
; 4xx {ok:false,because} ; idempotent (already-clear -> cleared:false 200).

`by` is the provenance of the RESULTING state, not always 'operator': on a clear
(cleared:true) it is 'operator'; on a no-op (cleared:false -- the agent was not
waiting) it is the current state's own provenance ('agent'/'auto', or null for a
never-reported agent). Key the dismiss button on `cleared`, not on `by`.

## Product note for the PR (not a blocker)

An operator overriding an agent's self-reported RED is a mild product call. It
is safe because it re-derives (above) and the operator is exercising judgment on
a state they can see. Flagged for Josh in the PR body; not blocked on.

## Weakest premise

That the frontend addresses this route by the same `sessionName` the board keys
selfreport under (status.js reads `selfreport.read(pane.name)`, and /api/report
records under `card.sessionName`, which resolve to the same bare board name for
a real agent). If a display name and session name ever diverged for an agent,
the operator clear could key a different file than the board shows. Mitigated by
the fact that /api/report (which created the report being cleared) keys the same
way, so the clear route is consistent with the writer of what it clears.
