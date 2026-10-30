# auditwords-5537: the board recognises audit_unavailable (kosmos#5537 slice G, board side)

## Why
Relay slice G (branch auditg-5537) makes the coordinator refuse a member's codeless move or re-acceptance with 503
`audit_unavailable` when the audit row cannot be written, and change nothing. engine/orgenroll.js recognises only
the codes in its SAY table (`CODES = Object.keys(SAY)` plus org_not_accepted), so that code read as no code: a
person's move took the unknown-outcome path ("It is not known yet whether joining went through", then polling), and
the automatic re-accept said "It is not known whether accepting reached your company".

## Change
- SAY: `audit_unavailable: 'Your company could not record this just now, so nothing changed. Try again in a minute.'`
- FAMILY_SAY: the same with "Your family account".
- The automatic re-accept needs no change: a recognised code takes its certain-refusal line.

## Tests (engine/orgenroll-5531.test.js)
- A refused move, company and family: the exact line, no join word, no unknown join kept.
- The review-refusal table gains the code (certain refusal, "Nothing changed").
- Control: both entries removed, both tests red.

## Not changed
- web/index.html's ticket rule (`r.code !== 'org_bad_world'` spends the ticket): a first join cannot get
  audit_unavailable (its binding transaction writes no rows), and a move has no ticket.
