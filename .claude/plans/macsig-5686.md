# macsig-5686: the Mac checks escrowd's signature on the company backup key and pins the first one (kosmos#5686 b1-mac)

The Mac half of kosmos#5686 b1-mac. kosmos-relay escrowd signs the org key it made and recorded (relay #405, #411); the
backup-key answer carries `signature`. This computer wraps its member backup key to that company key only when:

- the signature verifies against a verification key SHIPPED with the app (engine/orgkeysig.js, pinned to the relay's
  known vector); a missing or bad signature refuses;
- the key is the one pinned first (engine/orgkeypin.js): a person's Join writes "expect <org>", the first verified key
  must be that org's (a Mac that joined before this code anchors on its enrollment record), and later answers naming
  another org or key are refused;
- the pin clears only after a person's act: a final end of the enrollment (orgenroll.js retireWorldId) or a person's
  Join or move to another company; never the automatic re-accept.

Dormant until a verification key ships (VERIFYING_KEY null): check() answers ok; a Join writes only its expectation.
A refusal is said to the person once by the backup tick and leaves no state for the refused pair.

## Weakest premise
Which company a computer belongs to is the coordinator's word at first contact (a person's code at their Join; the
enrollment record for a computer that joined before this code). The signature proves the coordinator cannot OPEN the
key; filing it under an org a breached coordinator controls matters only through escrow's release, which escrowd
refuses today. Stated in orgkeypin.js's header.

## Not here
- Shipping the verification key (it comes from the production escrowd once escrowd is deployed with its record).
- Epoch rotation (none exists; the pin is per current epoch).
