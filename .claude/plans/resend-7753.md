# resend-7753: the Mac re-sends a registered key's signed record until Kosmos+ keeps it (kosmos#7753)

Stacked on keyrecord-7753 (PR #7764).

Finished means: a member key registered before Kosmos+ stored `member_key_sig` gets its signed record to Kosmos+ once the coordinator does store it, without any change to what ensureMemberKey answers, and without a POST on every backup run meanwhile.

Agreed with Renet Tilley (coordinator and escrowd, Fleet Builders 21:04 to 21:05 CST): the coordinator stores the signature as sent, unchecked, and echoes it as `member_key_sig` in the member-key answer when it keeps it ("kept", never "valid"; escrowd checks it against devkeyhist). A re-send for an already-registered epoch fills the signature only if none is stored; it never replaces one.

Changed by the coordinator's owner at 21:16: the coordinator now checks the signature against the registering computer's own key before keeping it; one that does not check is not kept and not echoed (the registration still succeeds), so a garbage first signature cannot pin an epoch. The Mac compares the echoed member_key_sig with what it sent as bytes, since the kept one could be another of the member's computers': an echo of another signature means that computer's is kept and never replaced, so this computer's can never be: the re-sending stops either way, and the key file records which (`sigOther`). Rejected: re-sending until this computer's own echo (a POST a day per extra computer for the epoch's life, for nothing), and checking the echo against the member's device-key history (more code for the same stop).

Decided:
- The key file records per epoch `sigKept` (an answer echoed the record) and `sigAskedAt` (when it was last sent).
- A registered key answered from disk, not sigKept, and last sent a day or more ago (or at a time after now, a clock that was ahead) is sent again as the repeat registration the live route answers without change (kosmos-relay coordinator/src/memberkey.rs, "the same key is a repeat"). Only when this computer can sign. Whatever happens, the caller's answer is the same.
- Rejected: re-sending once only. Today's coordinator never echoes, so a single re-send now would be spent before the coordinator stores anything. Rejected: re-sending on every call, which would add a POST to every backup run on the live route.
Measured: sent again after 25 h and not after 23 h; the same key, with a signature that verifies; once the coordinator echoes, never again; an echoed first registration is never re-sent; a failed re-send keeps the answer and waits a day; no device key, no re-send. Each red without its part (no interval, no echo recorded, no re-send).
Premise of stopping on any echo (Renet Tilley, 21:19): it holds for an honest coordinator. A breached one could echo garbage to stop this computer's re-sends; that is covered by escrowd checking the kept signature against every device key of the member, a "must" in her escrowd slice, not by anything here.
Weakest premise: that the repeat registration stays side-effect free on the live route. It is today (it returns the stored key); a coordinator change to it would need to keep that.
