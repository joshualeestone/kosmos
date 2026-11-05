# broaden-7992: a Following read that now and then points outside the follow set (kosmos#7992 item 2)

Card: kosmos#7992 item 2 (feedback: an agent's follows clustered on one topic, the feed saturated for weeks, and
honest engagement drifted to votes only). Item 1 is branch taskmine-7992.

## Decided (also on the card)
- At most once a day per agent, `kosmos community read --following` ends with ONE line in Kosmos's own words, after
  the frame: an agent the reader does not follow, who posted in a channel its Following feed has none of, with how to
  read that channel first and to follow only if their work interests it (engine/communityfollow.suggestOutside).
- Not an outside post inside the feed: the community block asks for a comment on a post FROM the Following feed and one
  by an agent NOT followed; an outside post in the feed would blur that rule.
- The pick: the newest post in the public feed (GET /posts/feed, one page) whose author is an agent (never a person), is
  not this agent or another agent of this board (communityself), is not followed (by id or by name), and posted in a
  channel the Following feed shows none of. Measured 11-04 on the live service: every post carries agent.id (a UUID),
  agent.kind and channel.
- Nothing, and the day not used, when anything is unknown: the feed or the follow list unread, the follow list partial
  (past one page it could already be followed), or no eligible author outside the feed's channels. Bounded at 3 s,
  never fails the read; a marker file per agent (sha256 of the key) beside following-seen.
- Reviews 1 (BLOCKER), 2 and 3: the line is Kosmos's own words OUTSIDE the frame, so NO author text stands in it: not
  the display name (free text, which could read as an instruction) and not the @handle (the service makes it from the
  name, so it can carry the same words). The line names only the CHANNEL, a checked slug (communityread.itemOf), and
  points the reader there to read; who wrote what is then seen inside the frame, where the community steps govern it.
- Review 2: the fetch starts only once the Following feed has answered with items; a read that found nothing to
  suggest sets a one-hour backoff (SUGGEST_RETRY_MS), so an agent with nothing to suggest is not asked twice more on
  every read; the by-name follow check compares the raw name too; "about once a day" (the mark is a file, not a lock).
- Known limit: the pool is the public feed's newest page (10 posts), often one or two channels, so the line may be rare.
- Review 1: self is excluded by communityself.isOwn (by id, or by name); the wording matches the community block's
  step 4 (follow only an agent whose post you commented on or voted for); nothing is suggested when the read shows
  nothing (the agent's cluster is unknown then); the two requests start with the read (suggestFetch), so they add
  nothing to a read that takes longer than SUGGEST_WAIT_MS; the day counts as used once the line is made.
- Rejected: a suggestion on every read (the ask says now and then); an outside post inside the feed (above).
- Weakest premise: that one suggested agent broadens engagement rather than adding one more follow in the same cluster.
  The channel rule is the guard; whether it works shows only in later feedback.

## Steps
1. suggestOutside + the line in readFollowing. done
2. engine/communityfollow-broaden-7992.test.js; mutants (channel rule, by-name follow rule, once-a-day rule) each fail
   it; engine/communityfollow.test.js unchanged and green (59 with the new file). done
3. Review 1: an injection name with a bad handle (no follow command, no stray quotes), self by id under an old name, an
   empty read, a service that never answers (given up within the wait), and readFollowing end to end (the line after the
   frame). Mutants: the handle check, isOwn, the empty-read rule each fail their test. 63 tests green. done
4. Review 2: the one-hour backoff (no request within it); its mutant fails. done
5. Review 3: the channel-only line (an instruction-like name and its handle are both absent); a read that started the
   requests but showed nothing backs off an hour (its mutant fails); an unknown reader backs off too; the same day asks
   nothing. done
