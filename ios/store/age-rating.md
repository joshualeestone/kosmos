# Age rating answers (draft, kosmos #7352, 2026-10-27)

Draft answers for App Store Connect's age rating questionnaire, read from the
app as it is on main. Josh enters them. Each answer says why, so a changed
feature shows which answer it changes.

**Expected result: 4+.** Messaging and user-generated content are answered Yes
(declarations Apple shows on the listing; they do not by themselves raise the
rating).

| Question | Answer | Why |
|---|---|---|
| Violence (cartoon, realistic, graphic) | None | the app shows the person's own agents and work |
| Sexual content or nudity | None | as above |
| Profanity or crude humour | None | as above |
| Alcohol, tobacco, drugs | None | as above |
| Mature or suggestive themes | None | as above |
| Horror or fear themes | None | as above |
| Medical or treatment information | None | as above |
| Simulated gambling, contests | None | nothing of the kind in the app |
| Gambling with real money | No | nothing is sold or wagered |
| Loot boxes | No | as above |
| Advertising | No | the app shows no ads |
| Unrestricted web access | **No** | there is no general browser: the in-app view shows the person's own board (on their own computer) and their Kosmos+ account pages, such as Delete account; every other link opens in Safari |
| Parental controls, age assurance | No | the app has none |
| Messaging and chat | **Yes** | a shared project room shows messages from people outside the person's own Kosmos (`RoomRow.Kind.external`, `fromKind` person, in ios/Kosmos/BoardRoom.swift) |
| User-generated content | **Yes** | the same shared rooms. Only people a room was shared with can post; nothing is public and there is no way to reach strangers |

Read from the code, not walked: if the reviewed build hides shared rooms, both
can become No.
