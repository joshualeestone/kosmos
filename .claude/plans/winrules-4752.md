# winrules-4752: the setup guide's absolute Read rules, in the path form Claude Code matches on Windows

Follow-up to #4752 (closed), from a peer's note. Claude Code's permissions docs: "On Windows, paths are normalized to
POSIX form before matching. C:\Users\alice becomes /c/Users/alice, so use //c/**/.env". The guide's absolute rules
came from `ruleAbs`, which wrote the native spelling (`//C:\Users\...`). That is not a form the docs say is matched,
so on Windows those rules were at best unverified. The `~/` rules are unaffected.

## Change
- `engine/setup-assistant.js` `ruleAbs(p, platform = process.platform)`: on win32, backslashes become `/` and a
  leading drive `C:` becomes `c/`, then the usual `//` prefix: `C:\Users\x` -> `//c/Users/x`. macOS and Linux are
  unchanged (a backslash there is part of a file name). Exported, so the form is pinned from any host.
- Every writer of an absolute rule goes through `ruleAbs`, and `wasEntryRule` builds its prefix with it. The other
  reader, `guardGuideFolder`'s own-folder check, parsed rules back by hand for the old native form, so with the new
  form it would have resolved `c/Users/...` against the current drive and never matched (review 1, BLOCKER). It now
  uses `rulePath`, the exact inverse of `ruleAbs` (it also reads an older native-form rule as it is).
- Which earlier rules stay is now one pure function, `migrateKept(had, fresh, platform)` (review 3: the migration was
  reachable only on a Windows host; the platform now comes from `deps.platform`, and `wasEntryRule`/`rulePath` take
  it too). A rule written before this change in the native form (or as `C:/...`) is dropped on Windows ONLY when its
  exact new-form equivalent was just made, or that equivalent is a per-entry rule for the store just listed in full
  (the same evidence the new-form per-entry pruning already uses: the entry is gone) (`legacyWinEquivalent`).
  Review 2: dropping on location alone would leave a path with NO rule if making the new one failed (a listing
  error, a store mid-move); duplicates are harmless, a gap is not. A person's own rule elsewhere has no equivalent
  here and stays. `RULE_SYNTAX` is checked on the native path with its separator taken out first, as before.
- Not handled, recorded: a UNC store path (rulePath reads its rule back drive-less, so the own-folder check does not
  apply to a store on a network share); a path with a bracket or parenthesis in a home or data-root rule (as before).

## Tests
`engine/setup-assistant.winrules-4752.test.js` (in `tools/windows-tests.js` ALSO): drive paths to `//c/...` (fails on
main: ruleAbs not exported and native); macOS and Linux unchanged (control); `rulePath` reads every written rule back
to its exact path, both forms; an older native-form rule maps to its exact new-form equivalent, suffixes included; `migrateKept` keeps exactly a person's own rules and drops the old and gone ones on Windows (with a no-listing arm that keeps an old rule with no equivalent, and an off-Windows control)
(controls: a new-form rule and a home rule map to nothing); and, on the host it runs on, no Read
rule the guide writes keeps a backslash or a drive colon, which the Windows job measures for real.
Not done: running `engine/guide-deny-4752.test.js` (the own-folder arms) on Windows. Its expected rules are built by a
hand-written POSIX helper, so it would fail there for the wrong reason; making it host-neutral is its own change.
The own-folder check's Windows half is pinned instead by the rulePath round trip above.

## Weakest premise
That Claude Code's documented normalisation is what the version a person runs does (the drive letter is written
lower case, as the docs' example is; whether matching is case-blind is not documented). Not measured on a Windows
machine here; the docs are the source. The old native form was not documented as matched at all, so this cannot
make a rule that worked stop working unless Claude Code also matches the native form, which nothing says.
