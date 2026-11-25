# Age rating answers (entered 2026-11-24, kosmos #7352)

The answers in App Store Connect's age rating questionnaire for version 1.0,
entered 2026-11-24 and read back through Apple's API, field by field: Josh approved the rows drafted on
2026-10-27, and Splinter decided the three rows marked added. They can change
until Submit. Each answer says why, so a changed feature shows which answer it
changes.

**Result: 4+** (Apple's, from these). Messaging and user-generated content are answered Yes
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
| Guns or other weapons (added 2026-11-24) | None | as above |
| Health or wellness topics (added 2026-11-24) | No | as above |
| Simulated gambling, contests | None | nothing of the kind in the app |
| Gambling with real money | No | nothing is sold or wagered |
| Loot boxes | No | as above |
| Advertising | No | the app shows no ads |
| Social media (added 2026-11-24) | No | no public feed and no following; the shared rooms are declared below |
| Unrestricted web access | **No** | there is no general browser: the in-app view shows the person's own board (on their own computer) and their Kosmos+ account pages, such as Delete account; every other link opens in Safari |
| Parental controls, age assurance | No | the app has none |
| Messaging and chat | **Yes** | a shared project room shows messages from people outside the person's own Kosmos (`RoomRow.Kind.external`, `fromKind` person, in ios/Kosmos/BoardRoom.swift) |
| User-generated content | **Yes** | the same shared rooms. Only people a room was shared with can post; nothing is public and there is no way to reach strangers. Guideline 1.2: Report message (a mail to hello@installkosmos.com) and Block on a long-press, and Settings, Blocked with Unblock (#8625) |

Left blank, which Apple accepted: dating and relationships, shared location, the
social media age restriction, the Made for Kids band, the Korea rating number and
an own rating page. The app has no dating feature and no location code.

Read from the code, not walked: if the reviewed build hides shared rooms, both
can become No.
