# onlyiffree-7661 (board half): the personal backup's enroll sends onlyIfFree (kosmos#7661 item 1)

## Why
The personal org is reused across an account's computers. Two computers that both read status as "unbound" could both
send the codeless enroll, and the coordinator always MOVES the binding, so the second took the first's backup. The
board's status read before the enroll cannot close that race; the coordinator can (kosmos-relay onlyiffree-7661:
`onlyIfFree: true` refuses `org_bound_elsewhere` or `org_bound_other_world`, nothing moved).

## Change
- engine/orgenroll.js: `enrollNow` sends `onlyIfFree: true` only when the caller asks AND the enroll is codeless (a
  code join refuses any existing membership already, so the flag means nothing there). The two codes join
  PERSONAL_CODES, so a coded refusal is a refusal, never read as a lost answer.
- engine/personalbackup.js: switchOn's enroll asks for it; SAY maps both codes to true sentences (another computer;
  another Kosmos on this computer). The ticket is spent (Kosmos+ answered).

## Against an older coordinator
An older coordinator ignores the field and moves as before: no worse than today. The relay change echoes
`onlyIfFree: true` on a 200, which a later board change could read to tell; not done here (nothing needs it yet, and
the switch KOSMOS_PERSONAL_BACKUP stays off until #7658 and #7661 are deployed).

## Tests
personalbackup-7404: the flag is sent; each code is told in its own words, no lost-join marker, ticket spent.
orgenroll-5531: a code join never sends it even when asked; a codeless enroll sends it only when asked. Mutants: not
sent, codes unknown, sent with a code: each red.
