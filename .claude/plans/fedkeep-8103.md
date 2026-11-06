# fedkeep-8103: the board never forgets a live federation invite (#8103)

PigeonPete measured it on the #6746 test board: one project made 100 invites (the coordinator's cap per account,
FED_INVITES_OUTSTANDING_MAX), the board's record kept the newest 64, and 36 live invites could be neither listed nor
withdrawn while they counted against the cap for 7 days.

Call (Mona Lisa): trimming never drops a live invite (not used by anyone this board knows of, not withdrawn, not yet
expired); the 64 bound applies only to finished rows (used, withdrawn or expired), newest kept, as before.
Rejected: drop only expired rows (a used invite's row carries the member's label after its code expires, and losing
it unnames them); raise the bound to 100 (a mixed history would still push out a live row).
Weakest premise: that the coordinator's cap bounds the live rows. If the coordinator raised its cap, this board would
keep more rows; each is small.

Finished when: merged, tested (100 live kept and the oldest withdrawable; finished rows still held to 64; the test
fails on main), and the board serving it.
