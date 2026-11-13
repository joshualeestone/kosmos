# win-accountkeep-8478: a Windows agent comes back on the account and model it was set to (kosmos#8478)

**Posture:** production

## Problem
On Windows a Claude or Codex agent's account folder and chosen model were recorded only in its Scheduled Task, so
removing the task (#8475's task-only leftover delete) lost them, and Start at login brought it back on the main account
and the last model it ran.

## Change (Windows only)
- create.js records profile.win32Task = { runner, configDir, model } whenever the task is written (sync rewrite, async
  put-back, installJob's Windows arm, creation); win32RecordedTask reads it and says whether the folder and model are
  still usable (statSync: a dead junction is unusable).
- register.js repair uses the recorded folder and model where usable, falling back per item.
- delete-leftover.js startsAgainWords and remove.js's Restore say which comes back, with the same reader as repair.
- Agents written before this change: the task-only delete (delete-leftover.del) reads the account folder and model from
  the task itself and records them (create.recordWin32TaskFromTask) just before removing it, when the profile has no
  record. Never a gate: a read or write that fails leaves the delete as it was. (Since round 5 such a record carries
  no identity, so only the model comes back; see below.)
- Round 1: removing or disconnecting a Claude or OpenAI account (accounts.js / openaiaccounts.js forgetAccount and
  removeAccount, wrapped at the export through create.afterAccountGone) clears that folder from every record naming it
  (model kept, marked accountRemoved), because the removal check finds agents through their tasks only and the next
  sign-in reuses the folder name. Never refuses the removal. A recorded folder Kosmos cannot reach is said as "cannot
  reach right now" (a disk or share may be unplugged), and repair keeps it in the record (the task runs on main
  meanwhile) so the agent comes back on it at the next Start at login, if no change to the agent rewrites its task
  first (a rewrite records what it wrote, the main account). The agent never moves back on its own.
- Round 2: Gemini and Grok removals clear records too (geminiaccounts.js / grokaccounts.js, wrapped the same way).
  The task-only delete records the task's account folder only if it is a folder right now (statSync); otherwise the
  main account, marked accountRemoved (why 'missing'), and the words say the folder was not there when the startup
  job was removed. A task can outlive its account (disconnect-and-stop leaves it), and a record made after the account
  went cannot be cleared by the removal.
- Round 3: a folder NAME is not an account. Every record now keeps whose account the folder held when the task was
  written (create.win32AccountIdentity, from the account modules' own identityOf: Claude sign-in email and organization,
  or a Claude API key's last four; OpenAI, Gemini and Grok sign-in email or key ending). Repair, the plan's words and
  Restore's words put the folder back only while it holds that same account now; a folder whose account signed out or
  changed, or a record with no identity (written before this, or a folder that held no readable account then), means
  the main account, with words that say which. Repair keeps only an unreachable folder in the record, with its identity.
- Round 4: the task is the truth at the delete. recordWin32TaskFromTask always refreshes the record from a readable
  task (a record can be stale: its write is best effort, and an older Kosmos can rewrite the task after a downgrade).
  It keeps the old record only where repair deliberately kept a folder it could not reach (marked kept) while the task
  runs on the main account; for the same folder it keeps the identity recorded when the task was written and the
  folder even if out of reach (the identity check decides at Start at login). The plan's words read the same refresh.
  A Codex ChatGPT sign-in's identity carries its workspace id where codex wrote one (tokens.account_id, else the id
  token's chatgpt_account_id). Clearing records on an account removal runs on Windows only.
- Round 5: an identity is read ONLY when a task is written, never at the task-only delete (whoever is signed in to a
  folder then may be someone else: a disconnected account's folder name reused by the next sign-in). At the delete:
  (a) a record on the main account, or one whose account was disconnected or removed (forgetWin32TaskAccount now also
  keeps removedDir), stays on the main account with the task's model; (b) the same folder keeps the identity recorded
  at write time; (c) a different folder, and (d) no record, take the task's folder with no identity, which Start at
  login never trusts (main account, words that say so). So an agent whose task was written before this change keeps
  its chosen model but comes back on the main account. The account wrappers run the removal first and the record step
  after it inside a try, Windows only, so the step can never fail a removal.
- Tests: engine/delete-leftover.win32-accountkeep-8478.test.js (18).

## Decided, not missed
- Windows only: on macOS and Linux the plist or unit is the source of truth and nothing in Kosmos removes it alone.
- The weakest part: the Start at login report itself does not say when an account folder was gone (the delete and
  Restore words warn first). And the task-only PLAN's words for an agent with no record are read from the task (what
  the delete is about to record), so if that record's read or write then fails, the plan promised the account and model
  and the outcome, read after, says the main account and the model it last ran (true, but different from the plan).
  A task removed some other way (by hand in Task Scheduler) still loses an unrecorded agent's account and model.
  Round 2: a legacy agent whose account folder is on a disk not connected at the moment of the task-only delete is
  recorded on the main account (safe, as main did; its folder is not kept).
  Round 3 closes the wrong-account paths named before (a folder signed out of and refused removal, a folder deleted by
  hand while kept as "cannot reach", another world's records, a removal whose delete failed partway): each still has
  its record, but the folder's current account no longer matches it, so the agent comes back on the main account.
  What is left: an API key account is matched by its key's last four characters (as the accounts list shows it), so
  a different key ending in the same four in the same folder would match; a Grok subscription sign-in is matched by
  its email alone (two accounts under one email would match), and so is a Codex ChatGPT sign-in where codex wrote no
  workspace id; and the same person signing in again in that folder counts as the same account (by design).
