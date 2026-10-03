# Aircraft parity verification ledger

Target baseline025cad4930b487628675a0e20a88323aae0fac89; published sourcec63bff8b328676f2435ee50454143f321eef1ddd. This candidate is unpublished. Older VERIFICATION.md evidence remains historical and is not a pass for these changes.

## Interim / focused verification

- Source Git-blob verification: all inspected Kaisen src files and index.html exactly match c63
- Source manifest checker: pass against verified checkout
- Input recovery/ownership, settings ID/landscape, aircraft display and audio checks:18 focused tests pass
- Simulation/flight-assist/collision tests migrated only where the latest explicit aircraft-parity instruction supersedes old finite-ammo/ram-bonus/tactics contracts
- Weapon-specific falloff tests: exact/adjacent boundaries, invalid distance, actual swept-hit fraction, accumulated flight, no per-tick attenuation, paired shot cadence
- Independent code review found fractional-score ranking rejection and stale enemy finite-ammo text. Both fixed and independently rechecked. Mock ranking now accepts integer1968 from the fractional-damage reproduction
- Browser test inventory:5 listed, not executed locally. --list can produce skipped result records; those are not counted as successful tests
- Local browser launch is already known blocked (EPERM); cloud browser WebGL unavailable. Neither limit was bypassed. Authorized CI browser runner provides the applicable route

## Final work boundary

Frozen shared damage module SHA256 b0a71f4b39aa1adab948ea3f08d99f0ed60e30deb5087992c8f748c9a5fade83. Final local boundary:81/81 unit tests pass, TypeScript/Vite build pass with existing-type >500kB bundle warning. See evidence/aircraft-parity/{unit.txt,build.txt,candidate.json} for logs and content hashes. Browser run is pending submitted-head CI; no local browser pass is claimed. CI artifacts will identify exact head SHA. A subsequent change invalidates affected prior results; old passes are not reused as final.

## Browser safety and coverage

New Playwright suite uses ordinary UI and read-only existing dev snapshots, without production state setters. All nonlocal HTTP is intercepted with synthetic responses before navigation, so no test leaderboard writes. It covers Easy/Normal HUD, pointer release/restart, pause/settings/resume, preview duplicate IDs, saved control size, portrait320×568 and landscape852×393, real paired firing/reload and pause freeze. CI uses read-only contents permission and does not retain checkout credentials.

No iPhone hardware, real speaker listening, OS share UI or production ranking writes are claimed. The physical iPhone checklist lives in AIRCRAFT_PARITY.md.
