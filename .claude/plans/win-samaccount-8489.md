# win-samaccount-8489: the same person no longer reads as a changed account at Start at login (kosmos#8489)

**Posture:** production

## Problem
kosmos#8478 records, with a Windows agent's account folder, whose account the folder held (create.win32AccountIdentity),
and Start at login (register.repair, through create.win32RecordedTask) puts the folder back only while it still holds
that account. Otherwise the agent starts on the main account, the person is told "the account in the folder it used has
signed out or changed", and the record moves to the main account for good. The same person could read as changed:
1. The recorded `org` fell back to the organization NAME when Claude Code had written no uuid; once it writes the uuid,
   or the organization is renamed, the comparison failed for the same email (reproduced on the card).
2. A config read while Claude Code (or codex, or grok) is writing it does not parse, the identity read as null, and
   null is "changed".
Both failed safe (main account), but the words were false and the record was dropped.
Card comment: an API key was matched by its last four characters only, so two keys sharing them read as one account.

## Decisions
- (a) Organizations are compared by id. Both sides have one: they decide. Neither: the email alone decides. Review 1
  (decided by the coordinator): a RECORDED id with none in the folder now is "could not read" (kept, main account this
  time), never "same"; no id recorded and one now is the email alone. accountMatch answers same/changed/unreadable.
  For Claude the id is the organization uuid (a uuid-shaped value; a recorded name never counts as one), and new
  records keep only the uuid (null when Claude Code wrote none). For codex the id is the ChatGPT workspace id, which
  is never a name, so its rule is the same. Old records holding a name keep working: the name is
  ignored and the email decides. Rejected: keeping a name and comparing it when both sides have names (a rename is
  exactly that case). Rejected: a separate `orgUuid` field (changes the record shape the 8478 tests pin, for no gain).
- (b) create.win32AccountIdentityRead answers { identity, unreadable }. Unreadable = a credential file that is there
  but cannot be read or parsed right now, or (Claude) no config at all and no key beside it. win32RecordedTask then
  answers accountWhy 'unreadable' (new), register.repair keeps it like 'unreachable' (folder and recorded identity,
  task on the main account this time), and delete-leftover.startsAgainWords says: "Kosmos could not read which account
  is signed in to the folder it used just now, so it starts on your main account unless it can read that by then and
  it is still the same account. If it still cannot, Kosmos keeps that folder and tries it again at the next Start at
  login." A config read whole with no sign-in (signed out), and a codex auth.json that is gone (codex logout deletes
  it), stay 'changed'. Review 1: a Grok auth.json read whole with no x.ai sign-in is signed out ('changed'; nothing in
  grokaccounts or its tests shows the CLI writing that state mid sign-in, it writes the whole file with its entry);
  two x.ai sign-ins is "could not read".
- Review 1, "could not read" ends: a kept record counts the Start at logins in a row that could not read it
  (`unreadable`); the one that would make WIN32_UNREADABLE_LIMIT (3) answers 'unreadableGaveUp', which the repair does
  not keep (main account for good), and the words say "on your main account from now on, because Kosmos could not read
  which account is signed in to the folder it used now, nor at the two Start at logins before". A readable match
  rewrites the record without the count; an unreachable start keeps the folder without it.
- Review 1, no catch-all in the reader: every file read already answers absent or unreadable, so the outer catch went.
  Review 2: a throw is a bug and is "changed" everywhere: win32RecordedTask logs it (console.error, the folder path and
  message, never a key) and answers 'changed' (never kept); the record path logs it and records no identity.
- Review 1, the record write: register.repair passes the identity it just read and matched (identityNow) to installJob
  as verifiedIdentity, recorded as is, never read again (the agent just started may be writing its config).
  Review 2 (decided by the coordinator): every other write that reads an identity is a NEW choice (creation, account
  move, provider switch, put-back, adoption), and there an unreadable read records null, never the identity an old
  record held for that folder name: the name may now be someone else's (Alice's record, Bob signed in since). Writes
  that rewrite the same folder without a new choice (setModel, refresh) read nothing and carry the recorded identity
  over (refreshedRecord). A new choice also starts the unreadable count afresh, on purpose.
- Review 2: win32AccountIdentity (dead in production, exported only for tests) is gone; the unit tests build the
  expected identity by hand, and what create records is pinned end to end through setAccount.
- Review 1 (nit): the "could not read" and "cannot reach" words now say the folder is tried again until the agent's
  startup job is written again (changing its account or model does that), which forgets it.
  The account modules' identityOf are NOT changed: their lists rightly treat both cases as "no account here". The
  reader lives in create.js, reading the same files; openaiaccounts now exports identityFromData so codex is read from
  one read of auth.json (a second read could land mid-write).
- (c) Every API key (Claude, OpenAI/codex, Gemini, Grok) is recorded with keyHash = the first 16 hex characters of the
  sha256 of the whole key (WIN32_KEY_FINGERPRINT_HEX), plus the last four as before. A record with keyHash is matched
  by keyHash only; a record without one (written before this) is matched by the last four exactly as before, so no
  match is wider than it was. A repair that puts the folder back records the fingerprint from then on. The key itself
  is never in the record or a log.

## Modules checked
- Claude (accounts.identityOf + the key file): both problems; fixed (a), (b), (c).
- OpenAI/codex: no org-name problem (workspace id); mid-write auth.json was "changed": fixed (b); key tail: fixed (c).
- Gemini: keys only; an unreadable key file (not ENOENT) was "changed": fixed (b); key tail: fixed (c).
- Grok: key file unreadable and mid-write auth.json were "changed": fixed (b); key tail: fixed (c).

## Weakest part
The limit of 3 counts Start at logins, not time: two task-only deletes and repairs minutes apart while a config is
torn use up the tries quickly, and a busy file read three times in a row (very unlikely) drops a good folder; the person
is told and chooses the account again. A missing Claude config with no key now ends the same way after 3. What would
change my mind: evidence that Claude Code leaves its config unparseable for long stretches (then count days, not
starts). The "unreadableGaveUp" words at the task-only delete predict the coming Start at login from a read made now.
Second: the uuid shape test means a Claude organization uuid that is not uuid-shaped would never be compared (email
alone decides), a looser match for one person's two organizations; real organizationUuid values are uuids.

## Tests
- engine/create.win32-samaccount-8489.test.js: org name then uuid, rename, other uuid, other email, signed out; a
  half-written and a missing Claude config (unreadable, true words); a Claude key with the same last four (changed),
  an old last-four record (same key matches, other last four does not); Gemini, Grok and codex keys by fingerprint,
  Grok and codex sign-in files mid-write (unreadable), codex sign-out (changed).
- engine/delete-leftover.win32-accountkeep-8478.test.js: end to end on the stand-in Task Scheduler, a half-written
  config at the task-only delete: true words, Start at login on the main account, the record kept with its identity,
  and back on its account once the config is whole.
- Review 1: a recorded uuid or codex workspace with none now (unreadable); a kept record at 0, 1, 2 unreadable (third
  gives up, words); a Grok file with no sign-in (changed) and two (unreadable); a thrown reader bug (changed, logged);
  end to end: the repair records the identity it checked though the config is torn right after; an adoption install
  that cannot read keeps the recorded identity; three torn Start at logins drop the folder and one readable resets.
  Each fails against da38e03b52 (the round 1 base).
- Review 2: a newly chosen folder (Alice's record, Bob signed in since) read mid-write records null and Start at login
  keeps the agent on the main account; a thrown read on the record path records null and is logged (both fail against
  6223e6edc3); what a record keeps through setAccount (uuid not name, key fingerprint not key) moved end to end.
- Negative control: each new test fails against origin/main's create/register/delete-leftover/openaiaccounts (with
  only an export of win32AccountIdentity appended so the unit tests can reach it).
