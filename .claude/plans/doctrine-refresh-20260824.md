# The consented working-rules refresh (#539)

Three PRs: the seam (#629, merged), the engine and routes (#637), the two
surfaces (stacked, opens after #637). Owners per the card: engine
constraints Angel (her nine, on the card thread, each named in the test
that pins it), copy and surfaces Mona Lisa (ruled verbatim, in the PR
bodies), the seam whoever landed it first (Pete).

The design in one paragraph: every agent records at birth which revision
of the working rules it was born with (defaults.DOCTRINE_VERSION beside
the #170 id, guarded by a fingerprint-vs-version pairing test). A
born-before agent's page shows a quiet banner; a click opens a dialog
that SHOWS the exact span a consent would append (missing sections only,
whole-file heading presence, composed once and proven by hash at the
click); "Not now" is remembered server-side per agent until the version
bumps. A fleet button in Advanced does the same for named agents, listed
before the click, never past a per-agent Not now. The span lives inside
the app's fifth constant marker pair with Mona Lisa's dated sentences as
its first and last inner lines; the only writer is projects.spliceBlock;
a no-op is decided on section content before any dated composition, so a
byte never moves for a date.

Rules that can fail, from the card, all pinned: nothing writes without a
person's click; the person's words survive byte-for-byte outside the
span; an old agent carrying the doctrine as plain text appends nothing;
up-to-date is checkable (versions), not believed.
