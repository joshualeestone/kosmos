# musebackup-8530: a Muse Code agent's conversation is backed up (kosmos#8530)

## Why
PigeonPete found (#8530) that a company backup reads every provider's sessions except Muse Code's: no backup file
mentions Muse, so a Muse agent's conversation is never backed up.

## Measured (on the card)
- Meta's docs: sessions are kept on the Mac ("keep sessions forever" unless session_retention_days), unless
  `--no-session-log`, which Kosmos's runner does not pass.
- The Mortals Mac, Muse Code 1.4.20 in a throwaway HOME, two offline turns with marker words: the conversation is
  `<data home>/muse/sessions/<yyyy>/<mm>/<dd>/<session id>/session.jsonl`; beside it a per-session view cache under
  `sessions/.msp-view-g12/<id>/` and ONE `session-index.db` for every session.

## What
- `engine/backupsessions.js` `museRoot`: the agent's session id from `<agent>/.kosmos/muse-session` (engine/musefront.js);
  the root is `<data home>/muse/sessions` with an `only` list of every file under `<yyyy>/<mm>/<dd>/<that id>/`, so
  every day the session was resumed is taken. A linked sessions folder is refused (said), a linked session folder is
  not followed. Never the index, the view cache or the sign-in (Keychain).
- `engine/backuptick.js`: `museData` = `$XDG_DATA_HOME` when absolute, else `$HOME/.local/share`, as the runner gives
  Muse the board's own environment.

## Decided
- Not the view cache: it is a view of the same session, and the session log is what the docs call retained.
- Root named `sessions/<id>/muse`.

## Weakest premise
- That the session log alone restores the conversation; restore (#7404's path) was not exercised for Muse.
- That Muse on a Mac honours XDG_DATA_HOME: the measurement set BOTH HOME and XDG_DATA_HOME to the throwaway folder,
  so it does not say which one Muse follows. A board normally sets neither, so ~/.local/share is the common case.
- Only the agent's CURRENT session id is read: musefront writes a new id over an unreadable file, and the older
  conversation is then not backed up. Other readers take every session of the agent; here there is no record that
  ties an older session to the folder.
- Every file in the session folder is taken, unfiltered: the folder is one session's own, and the measurement found
  only session.jsonl there. A file Muse adds later there is taken too (it belongs to that session).
- Windows is not covered: the data home is $XDG_DATA_HOME or ~/.local/share; where Muse keeps data on Windows is
  unmeasured, so a Windows board gets no Muse root (as before this change).
- Ownership rests on the agent's own .kosmos/muse-session (no provider record ties a session to a folder, unlike the
  other readers' recorded cwd). Mitigated: only agents whose job runs Muse are asked, and the id is read through real
  folders only. Residual: two Muse agents holding one id (a copied folder) both name the same files, and the snapshot
  then leaves both out.
