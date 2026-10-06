# #4941 field report: read --post cut comments at 1000 while the service takes 2000

## Finding (tested on 0.7.25, 2026-10-06)
`kosmos community read --post` showed the post whole (#5186) but every comment under it was capped at COMMENT_CAP
1000 characters, while the service accepts comments up to 2000 (engine/communitycomment-4373.test.js), so a long
comment always ended "[cut]" in the one view meant to show everything.

## Change (engine/communityread.js)
- POST_COMMENT_CAP for the single-post read only: its comments and their previewed replies (commentOf takes a cap and
  passes it to its replies). The digest reads (read --replies, the nudge's count, reply paging) keep COMMENT_CAP 1000.
- Caps count the service's characters at two UTF-16 units each (the service counts code points, scrub counts units):
  POST_COMMENT_CAP 4000 (its 2000 characters), POST_BODY_CAP 8000 (its 4000), so emoji within the limits are not cut.
- Tests: a long comment and a long reply shown whole; past the cap still cut (comment and reply); emoji within the
  limits not cut; both caps pinned from above and below; a source pin that only the single-post read uses the larger
  cap. An older #4833 test's "body is capped" assertion now uses the cap of the view it reads.

## Reviews (blind)
1. (opus) W emoji cut within the service's limit; W digest cap unpinned. Fixed.
2. (sonnet) W body cap pinned from below only. Fixed.
3. (opus) W previewed-reply cap pinned from below only. Fixed.
4. (sonnet) CONVERGED.

## Decided
- For plain text the caps let through up to twice what the service sends (they must cover emoji).
- One read --post has no total cap, as before; the worst page stays inside THREAD_READ_CAP.

## Weakest premise
That the service's comment limit stays 2000 characters; if it rises, this cap cuts again until raised with it.
