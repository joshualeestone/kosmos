# macidentity-5871: the app reads the Mac identity by the tunnel's rule (kosmos#5871)

The connector (kosmos-relay branch identity-5871) now writes `mac_identity`, the Mac's id and signing key in one
file replaced in one step, before the legacy `mac_id` / `mac_key` pair. This branch is the app's half.

- engine/enrolment.js currentMacIdBy: which id names this computer, by the tunnel's rule (MacState::identity_record):
  mac_identity's id, unless the mac_id file names a DIFFERENT non-empty id and is newer (an older connector
  registered since). No mac_identity: mac_id. A mac_identity without both lines is no id; no mac_id file at all is
  no computer yet. Every registration gets a new id from the coordinator, which the rule relies on.
  engine/enrolment-macid-5871.test.js tables the same rows as the tunnel's identity_rule_table.
- engine/remote.js macIdHere and the cleanup paths use that rule, so the app and the tunnel name the same computer.
  engine/remote-macid-5871.test.js proves the files and their times reach the rule.
- engine/backupscan.js denies `mac_identity` (and its temp and copies) by name: it holds the private key.
- engine/remote-report.js classifies the identity record's failures as state-file-unreadable: `reading
  <dir>/mac_identity` or `.../mac_id` (a path with a space, a Windows path, the cause after a colon or on the
  next line), `... does not hold an id and a key`, `<dir>/mac_id holds no id`.

Merge order: this lands no later than any app build that bundles the new connector, so no build ships a connector
that writes the key into a file the backup scan does not know.

Decided, not done here (on the card): an app downgrade after the new connector registers could back up
mac_identity (an older app cannot learn the name); release notes say so.

Review: 12 blind rounds over both repos (opus and sonnet alternating), the last 0/0/0/0. Each app fix was measured
against a mutant that undoes it.
