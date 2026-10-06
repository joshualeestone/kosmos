# 0.7.25 fix-forward: render-dm-sideways-3969 (Splinter 05:56)

Re-cut 3 aborted: a sideways phone DM showed 38px of conversation, 50 needed. git bisect run with that one check,
49587aa6a (0.7.24, good) .. 950af8771 (pin, bad): first bad 304b74b45 (#5333 round 9), an always-present empty .fmsg
#d-linklost-msg taking 12px. Fix: #d-linklost-msg:empty { display: none; }. The 50px check unchanged; 73/73, shown=62.
Branch off the pin, merged with a merge commit; 0.7.25 re-cut pinned at its head.
Weakest premise: other always-present empty .fmsg lines may cost height elsewhere; only this one was measured.
