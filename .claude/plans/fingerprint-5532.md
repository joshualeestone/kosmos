# fingerprint-5532: a per-computer fingerprint for the work Kosmos (#5532, Enterprise E0.3, contract v1.5)

Agreed 2026-10-07 with PigeonPete (coordinator owner). Found in #5531 review 13: the Kosmos+ signing key lives in the
world's data folder (<root>/remote), so a full copy of that folder on another computer is the same signer to the
company, and `thisComputer` cannot tell them apart.

## What this branch builds
- `engine/computerprint.js`:
  - `hardwareId()`: macOS IOPlatformUUID from `ioreg -rd1 -c IOPlatformExpertDevice` (measured: no prompt, no
    entitlement), read once per run. Windows: null until the Windows owner builds MachineGuid (spec on #5532, per the
    fleet's Windows rule). Anything else: null.
  - `fingerprint(salt)`: sha256(salt + ':' + hardware id), or null when the salt (hex from the coordinator's status)
    or the hardware id is missing. The raw id never leaves the computer; a per-account salt keeps prints from matching
    across accounts.
- Nothing calls it yet: enroll, leave and the rollup send it once the coordinator accepts the field (v1.5).

## Decided
- Null means "cannot say": a caller sends no print (as an older board would), never a made-up one.
- Weakest premise: a cloned disk image or VM clone copies MachineGuid, and a logic-board repair changes
  IOPlatformUUID. Both end at the consent prompt to make this computer the enrolled one, not at lost data.

## Tests
- `engine/computerprint-5532.test.js`: the ioreg parse on fixtures (serial number and malformed values refused); the
  print's formula, salt separation, null on a bad salt, a missing id, a failing ioreg, Windows and Linux; this Mac's
  real id checked for shape only (never printed). Mutations of the salt, the salt check and the parse each redden.
