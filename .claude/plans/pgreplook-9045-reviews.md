# pgreplook-9045: review record (kosmos#9045)

Round 1 (opus, blind, 4abaff69bf): 0 B, 0 MAJOR, 2 MINOR, 2 NIT. Both minors fixed: a look whose own recording fails no longer reads
as nothing running, and only a pgrep that failed is looked at again, never a 2 of the helper's own. The sleep after the last look is
gone. Kept: the stand-in pid 4242 (as `shape` already uses).
