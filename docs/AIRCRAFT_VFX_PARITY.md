# Aircraft damage/destruction display follow-up

PR#9 aligned controls, weapons, aiming, HUD, sound and aircraft meshes but retained FightFlight's old damage smoke/wreck cosmetics. This follow-up closes that aircraft-display gap; it does not relabel#9 as having already matched these effects.

Reference: Kaisen published commitc63bff8b328676f2435ee50454143f321eef1ddd, src/scene.ts aircraft branches. FightFlight base9760ea26a7f1ed5f4fb1b3c5343a344df8a01925. No sea/ship implementation is imported, and the exact aircraft damage module remains unchanged from the shared a4390f4d proposal.

## Observable contract

- Hit:3 deterministic particles, lifetime.7s, initial point size8
- Destruction:18 deterministic particles, lifetime2.4s, initial point size28; alternating dark smoke/orange/gold source colors
- Seed event.id×31+particleIndex×17, angle seed×2.399963; horizontal speed5(hit)/18(kill), vertical6+seed%13
- Frame position=origin+velocity×age, then y−=4×age²; opacity1−age/lifetime; size=initial×(1+.4×age)
- Same depth-tested point shader, radial alpha falloff and240-particle cap
- No source live-aircraft low-HP smoke threshold: old below30% smoke is removed. Source shows HP in HUD/target bars and emits hit particles instead
- No persistent five-second wreck flames, airborne muzzle flashes, loop rings or generic end/damage rings, because those effects are not in source aircraft rendering
- Wreck velocity is original forward×speed×.5 with no extra−4m/s offset. Position=origin+velocity×age−(0,4.9×age²,0). Rotation is original quaternion followed by localZ(.65×age), then localX(.16×age). Lifetime5s
- Existing aircraft visual is transferred to the wreck so detail, control surfaces and propeller phase are retained; player wreck remains hero detail. Source propeller speed is used during active game time and freezes on the result screen
- Enemy identification band matches source: open cylinder(.34,.39,.6,14), rotationXπ/2, position(0,.04,2.45), z-scale1.12 andcolor0xe29b55. No friendly aircraft are invented
- Pause freezes effects/wrecks. Result-only visual time never changes match elapsed/score. New game object clears presentation even when seed/elapsed match

The sky, cloud shader, world altitude, camera, input, weapon/DPS/HP rules, collisions, score, population, time limits, ranking and network code are not changed. Source sea-level hiding of wrecks has no practical effect in the existing2400m five-second sky fall; no sea surface is added.

## Verification

Pure source-frame fixtures independently calculate event counts/colors, trajectories, opacity/size at0/.25/.5s, wreck position and local rotation at0/.5/1/2.4/4.99/5s, lifetime boundaries, capacity/deduplication and same-seed replay cleanup. Integration tests use real simulation destruction and preserve scoring, pause and result-time rules.

An added Playwright case uses ordinary Easy firing to destroy an aircraft, observes one wreck per simulation wreck, checks pause/resume/expiry and replay cleanup, and saves frames. Existing5 UI cases remain. No test state setters or production ranking writes are added; all nonlocal HTTP remains intercepted.

The old scripts/vfx-check.cjs persistent-smoke expectations were superseded by the requested source parity. That entry now runs the new pure aircraft-VFX regressions and actual-play destruction browser case. Old smoke screenshots remain historical evidence only.

UI release tag:20261003-aircraft-vfx. iPhone real-device appearance, sound and performance remain unverified. Automated frame equations and Chromium screenshots are distinct from real-device acceptance.

The follow-up also closes an event-routing gap: incoming bullet hit events now identify their actual target, so the source hit/damage SE relation and player-explosion choice are preserved. Kaisen has no full-screen red damage flash, so that old FightFlight effect is suppressed. Reload-start2s/reload-complete1.5s and enemy-kill1.5s announcements match the source. FightFlight's enemy-spawn and+150 loop-point notices remain explicitly game-specific score/population messages.

Aircraft models no longer have the old independent1.5km hard-hide; source near/far camera clipping(.5/22,000m) is used. The shared1.5km aim/marker/radar gates are unchanged. FightFlight's sky atmosphere/fog/lighting remain world presentation, so identical aircraft viewed in these different worlds need not have identical final background/illumination pixels.

One frozen-wreck screenshot temporarily hides only the pause modal during capture so the aircraft can be inspected; its filename explicitly saysoverlay-hidden. Game state is not altered by that screenshot style. Ordinary HUD/settings images remain unmasked.

## Aircraft fly-by audio follow-through

The newer coordinated Kaisen audio candidate has SHA2563396f7b46c42d331ccf2270c77bee5ad2037167064dca4c7710fc444bf0514e8. It is a later, unmerged source proposal, not part of publishedc63. This target ports only updatePasses and its shared spatial voice/lifecycle support; naval-shot, metal-hit, splash, ship-explosion, ordnance-impact APIs/categories and mount tracking are excluded.

Actual relative aircraft motion drives listener-local pan, distance gain/filtering and approach/recession pitch. Start requires distance≤180m, closing speed≥25m/s and relative speed≥45m/s; stop at>360m or1.4s. Limit2 pass voices,4s per-aircraft cooldown,300ms global interval,32 tracked aircraft. A>.5s observation gap, time rewind, dead/removed plane or same-ID age reset discards stale motion. The existing single AudioContext, ten-source budget, three-source player-damage reserve, master.6, propeller.0475 and original player shot/hit/damage envelopes remain.

Mock boundary tests cover approach/recession/pan/pitch, finite voice/state bounds, stale motion, pause/mute/reset/finish, priority reservation and graph-creation failure. These are deterministic Web Audio graph tests, not a claim of speaker listening or iPhone audio acceptance.

## Independent review and final fixes

A separate reviewer checked the submitted154385c1 aircraft VFX/SE changes against the frozen source, confirmed matching formulas/routing and independently passed the12 new focused tests. No substantive aircraft runtime blocker was found. Two follow-ups were implemented: replay checks now wait for elapsed>.2 before reading render diagnostics, and the original independent cloud clock is preserved so home clouds keep animating and do not reset on departure. A regression explicitly separates atmospheric time from the source-style aircraft particle clock. Final successor-head CI is the acceptance record;154385c1's prior93unit/build/6browser pass is historical, not substituted for it.
