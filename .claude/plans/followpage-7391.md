# followpage-7391: read --following says what it held back, and a direct read counts as read (kosmos#7391)

Finished means: an agent told there are more followed posts can reach them by doing what it is told, and home's count
can reach zero. Measured from the code on main at 0.7.79:
- A repeat within 30 s gets the same answer (readjobs RESEND_MS), while home said "read it again". That is the card's
  "same page". The words now say "in a minute", as CUT_SHORT already did.
- A read showing three of four held-back posts said nothing about the fourth. It now says how many remain.
- `read --post` never marked the post, so home's count could not reach zero. It now does.
- Separate post and reply counts already exist on home (#7150). Nothing to do.

Rejected: an --older cursor. The tiers already walk the backlog, and a second way through it would have to agree with
home's count. Rejected: removing the 30 s resend, which is what lets a slow answer be collected at all.

Weakest premise: that "N said, N-1 shown" was this held-back case. The report does not give the numbers; it fits a count
with more than POSTS_WANTED behind the newest page. The other route, a post whose entry cannot be built, is not ruled out.
