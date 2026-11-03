# whatsnew-0786: What's New for the 0.7.86 staging cut

Gap alarm 08:16 11-03 (kosmos#1050, main 52 past staging 0.7.85): cut 0.7.86 to staging (release owner: Baron Draxum).
`node tools/whats-new-pool.js build 0.7.86`: prod still serves 0.7.83 and the pool records it, so the eligible list is
unchanged from 0.7.85 (same five highlights); only the version moves. web/whats-new.json is the tool's output; the pool
is unchanged. Nothing to retire: neither 0.7.84 nor 0.7.85 has reached prod.
