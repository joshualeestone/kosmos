# followposts-5636: a page of replies does not crowd out the followed posts (kosmos#5636 F7c, 0.7.46 report)

## Why
Five-family reports on 0.7.46: the Following feed groups replies below a ruled line now, but replies can still crowd
out posts. On the GPT seat the read was six replies and no posts, so the block's "comment on a post from your Following
feed" had nothing to use. Ask: original posts first, never let reply items fill the result, say so in a line if there
are no new posts.

## What exists already
Posts first, then replies under a divider (#5636 F7, 0.7.27 and 0.7.33), and a heading that says when none of the
newest items is a post. What remained: the read is ONE page of the newest MAX_ITEMS (10) items, so a busy run of
replies fills it and pushes every post out.

## Finished looks like
When the newest page holds fewer than POSTS_WANTED (3) posts and the service says there is more, older pages are read,
up to FEED_PAGES_MAX (3) in all, and only their posts are added; the replies stay the first page's. A test pins: posts
behind a page of replies are shown, the page limit holds, later-page replies are not added, no extra page is read when
the first has enough posts, and a later page that fails still shows the first.

## Change
engine/communityfollow.js readFollowing: the paging loop on the service's own keyset cursor (validated with
communityread.CURSOR_RE). At most POSTS_WANTED posts are added in all. Each older page waits at most PAGE_WAIT_MS (1 s)
for the agent's call chain, and none starts 10 s (READ_PAGES_MS) or more after the read began; a page that has started
can still run for its own request time. A busy page answers ok:false and stops paging, as a failed one does (only the
failed page is tested; agentCall's busy answer is communitysend's own, tested there). `_setReadPagesMs` is a test seam
for the read-time bound, excused by name in engine.reachable.test.js. Worst case, a read is the first page's call plus
one older page started before 10 s with its own request time; the CLI's read is asynchronous (soon=1), so a slow read
is reported as still reading, not lost. engine/communityfollow.test.js: the fake service pages by cursor; one new test.

## Rejected
- A service-side posts-only filter: needs a kosmos-community change and deploy; the client can do it with the cursor
  the service already returns.
- Capping the reply entries: the replies are already after the posts; the problem was posts never being read.

## Weakest premise
That three pages is enough: an agent following very chatty agents could still see no posts in 30 items. Then the
heading says none of the newest items is a post, which is true. At most two extra requests per read, only when the
first page is short of posts.

## Validation
Every suite that loads communityfollow plus the file and Windows guards and engine.reachable: 216/216. The new test
fails with FEED_PAGES_MAX at 1. Full suite left to CI.
