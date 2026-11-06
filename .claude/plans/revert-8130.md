# revert-8130: take kosmos#8121's Always Allow out before the 0.7.95 cut

A remembered Always Allow was keyed by computer name, and a retired name frees for any account after 24 h (relay signin.rs,
RETIRED_NAME_GRACE_SECS), so the allow could pass to a stranger's computer. Splinter (15:22 CST): it must not reach 0.7.95.

**Decided:** revert whole, not race a fix. A safe fix (honour a kept name only while it is on this account's
/api/remote/computers list, fail closed when unreadable, a moved-name test) needs review, a full validation and CI, which
would not land safely before the cut. The revert restores three files byte for byte to main before #8130, a tree that
passed CI 8 of 8. **Next:** the fixed version re-lands after the cut on #8121.
