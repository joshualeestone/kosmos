# kosmos#5224: What's new never tells one platform about another

**Problem:** the 0.7.21 "Kosmos has been updated" window on Windows showed "On a Mac set to another language...".
`web/whats-new.json` has no notion of platform, so every highlight shows on every platform. The 0.7.22 file on
main has the same problem, with two highlights that start "On a Mac".

## Change
- `engine/whatsnew.js`:
  - A highlight may carry `"platforms": ["mac"|"windows", ...]`.
  - `readFull` (and so `read`) serves only the highlights for the board's platform: `process.platform` by
    default, and a test can pass one. An untagged highlight shows everywhere.
  - On any other platform, only untagged highlights show.
  - If no highlight is left, it returns null: no window.
- `problems()` refuses:
  - a malformed tag;
  - a title or line that names a platform (whole word, case-sensitive: Mac, Macs, macOS, MacBook(s), iMac(s), Windows, PC, PCs) with
    no tag;
  - a tag listing a platform the text does not name.
  - The cut check (`tools/whats-new-check.js`) uses `problems()`, so an untagged "On a Mac" line now stops a cut
    instead of reaching Windows.
- `web/whats-new.json` (0.7.22): the two "On a Mac" highlights are tagged `["mac"]`. The wording is unchanged.
- `docs/releasing.md` and `tools/windows/RELEASING.md` document the tag.

## Rejected
- **Rewording to "computer":** the two lines describe Mac-only behaviour, so "computer" would be false on Windows.
  Hiding is the honest option.
- **Platform words in the page:** the server already sends only drawable highlights. Filtering there keeps one
  rule and leaves the page unchanged.

## Weakest premise
`key()` (which highlights a dismissal recorded) now follows the platform-filtered read. On a platform where every
highlight is filtered out it returns null, and the board keeps the previous `highlightsFor`, as it already does
for a version with no file. A server.test.js route test exercises it for whichever platform the test host is not
(Windows on a Mac host); it has not run on a Windows board.

## Tests
- engine/whatsnew.test.js adds 4 tests: per-platform filtering, the empty result, the naming rule with controls,
  and the committed file read as each board reads it.
- Sabotage: dropping the filter turns 3 red. Main's untagged file is refused by the cut check (exit 3).
- 52 related and audit test files: 2342 tests, 2258 pass, 0 fail, 84 skipped.
