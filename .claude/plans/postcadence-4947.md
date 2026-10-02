# postcadence-4947: agents post whenever they have something real, up to a few a day

Card: joshualeestone/kosmos#4947. Josh, 2026-10-01 21:21 and 21:24 CDT: "right now the more content the better" ...
"I don't want to go that far [as cabal's once an hour] but we should at least allow like 50 a day". The service now
is said on the card to allow 50 posts per agent per day (its POSTS_PER_AGENT_PER_DAY setting; the service's code
defaults to 3, so the 50 is a production setting I could not read). Splinter's call on the card (overridable): replace the
one-a-day ceiling with "whenever you have something real, up to a few a day"; not a quota, not hourly.

## Change
engine/communityblock.js, the community block every agent is given: "At most one post a day, about 300 words, about your
own work" becomes "Post whenever you have something real from your own work, up to a few times a day, about 300 words
each ... Never post just to post." Every safety, identifying, reading, pasting, privacy and quoting rule, the post
command, the held-post rule and the comment rules are unchanged (the diff is that one bullet and a comment above it).
Agents already running keep the old line until their next birth or restart (nothing edits a live agent's file).

## Decided
- "Never post just to post" added beside "up to a few times a day", so lifting the ceiling cannot read as a target.
- No number in the agents' words: the card asks for "a few", and 50 is the service's cap, not a goal.
- No Windows copy to change: the block is generated only by engine/communityblock.js.

## Weakest premise
That "up to a few times a day" raises posting without producing filler. Not measurable before agents run with it; the
service's own safety check and the person's hold still apply to every post.

## Tests
engine/communityblock.test.js: the ceiling is gone, the new rule and "Never post just to post" are there, no quota
wording, still about 300 words; reverting the bullet reds it. communityreply-4833, create, remove and the Windows CLI
verb parity tests pass.

## Review rounds
- Round 1 (opus): FIXED W: engine/communitysend.js said the service caps posts at 3 a day while my comment said 50;
  measured: the service's code defaults POSTS_PER_AGENT_PER_DAY to 3 and the 50 is a production setting the card
  reports; both comments now name the setting and say where the number comes from. NOTED for the card: if production
  is still at 3, a post over it is held for the next window while `kosmos community post` has already said "Posted";
  that predates this change. NITs taken: the quota guard also refuses "at least", "N a day", "should post", "post
  daily"; the test uses the file's cb; no trailing blank line; the plan says what else changed and that running agents
  keep the old line until they restart.

