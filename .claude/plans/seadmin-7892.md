# seadmin-7892: the admin key screen's groundwork (kosmos#7892)

Built on `sekey-7116` (PR #7902, waiting on the 0.7.87 merge hold); rebase onto main once #7902 merges.
#7892 lists what #7116's round 8 left for the admin screen slice. This branch takes them in order of what can be
measured without a person at the screen.

## Done here so far

1. **WARNING 1, decoded text shown raw.** `prepare()` now returns `shown` (every decoded string, escaped) and
   `unusual`. Escaped as `\u{XXXX}` and marked: control, format (bidi, zero-width, BOM, soft hyphen), line/paragraph
   separators, private-use and unassigned code points, and every space but U+0020. A backslash is doubled so plain
   letters cannot imitate an escape. Mixed scripts (Latin with Cyrillic, say) are kept but marked; Japanese's Han,
   Hiragana and Katakana together count as one. `decoded` stays raw: what is signed is the bytes.

2. **Signing off the event loop.** `runHelper` is async (execFile, stdin written then closed); `createKey`,
   `publicKey` and `sign` return promises. Measured with a stand-in that sleeps 400 ms: the event loop keeps ticking.
3. **Helper errors as fixed sentences.** `HELPER_SAYS` lists every refusal `kosmos-se` writes (a test holds it to
   `native-se/main.swift` both ways); anything else is "the admin key helper failed", a missing helper is "not
   installed". No path, argv or stderr reaches a caller.

5. **The prompt names the action.** `kosmos-se sign` sets an LAContext `localizedReason` chosen from the signed
   message's own tag (`SIGN_REASONS`), never from an argument; a test holds the table to `SIGNED`. The prompt itself
   is not seen: that needs a presence key and a person (gate 6).

## Next, in order

4. WARNING 2: the screen's wording around the prompt must not promise approving means signed. Needs the screen.
6. Gate needing a person: a presence key made from inside the app. Park needs-operator when it is the only one left.

## Weakest premise

That the script list in `scriptOf` covers the look-alike cases that matter. A letter from a script not on the list
counts as "other", so Latin plus an unlisted script still marks; two unlisted scripts together do not.
