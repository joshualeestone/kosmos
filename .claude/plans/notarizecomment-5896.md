# notarizecomment-5896: correct the "notarising fixes Kosmos is damaged" premise in slice 3's comments

Card: kosmos#5896. Builder: Angel. Prompted by Baron's blind review of 0.7.43's What's New (12:39 CDT).

## Done when
No comment, doc or message from slice 3 says notarising fixes Josh's 0.7.42 "Kosmos is damaged". Each states only what
was measured on 2026-10-12: a quarantined copy that is sealed and signed but not notarised is rejected
("Unnotarized Developer ID"); notarised and stapled, it is accepted. Josh's own cause stays open (his copy had no
quarantine flag; an ad-hoc reseal did not clear it).

## Change
tools/lib/notarize-binaries.sh (header, staple comment, the refusal message), tools/build-kosmos-bundle.sh (call-site
comment), docs/releasing.md (step 4). The test matches the reworded refusal message. No behaviour change.

## Weakest premise
None about behaviour; the wording is the change.
