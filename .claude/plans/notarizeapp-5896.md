# notarizeapp-5896: #5896 slice 3, the sealed Kosmos.app is notarised and stapled at the cut

Card: kosmos#5896 (comment 6126449700). Builder: Angel. Assigned by Splinter 09:37 after Josh's 0.7.42
"Kosmos is damaged" (quarantine on a bundle that was never sealed). Baron (signing) confirmed no collision.

## Done when
- The cut submits the sealed `app/Kosmos.app` (built and signed by slice 2, #5935) to Apple in the same notary
  submission as the two bare binaries, refuses unless Apple's ticket lists the app's own cdhash, then staples the
  ticket to the bundle (retried, staples can lag acceptance) and validates the staple.
- The cut assesses a QUARANTINED COPY of the stapled app with `spctl -a -t exec -vv` and refuses unless it is accepted
  as "Notarized Developer ID". This is the exact case Josh hit; an unquarantined assessment would not see it.
- The order holds: signed, then notarised and stapled, then tarred (Baron's point).
- release.sh refuses a cut with any of the new test seams set (KOSMOS_STAPLER_CMD, KOSMOS_NOTARY_SPCTL_CMD,
  KOSMOS_NOTARY_XATTR_CMD), as it does the existing ones.
- Measured on this Mac with the real Developer ID identity and notary key: a sealed app built as the build does, run
  through the branch's notarize_binaries, staples, validates, and a quarantined copy (also after a tar round trip) is
  accepted; the control (sealed, signed, NOT notarised, quarantined) is refused.

## Rejected
- A second notary submission for the app: one more multi-minute wait per cut for nothing; one zip carries both.
- Notarising in setup.sh or on the user's Mac: impossible (no key there) and it is the cut's job.
- A dmg: the installer extracts a tarball; a stapled .app inside a tarball keeps its ticket (measured, round trip).

## Weakest premise
That setup.sh's placement of the shipped copy keeps the stapled ticket. It copies the bundle whole (slice 2), so the
ticket travels with it; not yet measured through a real install of a cut that contains this.
