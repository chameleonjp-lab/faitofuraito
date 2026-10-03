# Kaisen → FightFlight aircraft parity

Latest user feedback supersedes the old full Easy launch correction and thin-device-pixel tracer display; see [AIM_FEEDBACK.md](AIM_FEEDBACK.md). Easy camera/steering assistance remains unchanged. Normal line-width contract is coordinated with Kaisen; other candidate changes are not silently treated as source-adopted.

## Authorized boundary (2026-10-03)

User request: aircraft handling, specifications, SE, display and judgments in Easy/Normal follow Kaisen, including friendly fire/collisions, now and on later changes. This is not whole-game unification. Later requests add four distance bands and weapon-specific damage/DPS/HP balance. Numeric tuning remains provisional until actual play acceptance.

- Target base: `chameleonjp-lab/faitofuraito` `025cad4930b487628675a0e20a88323aae0fac89`
- Published reference: `chameleonjp-lab/kaisen` `c63bff8b328676f2435ee50454143f321eef1ddd`
- Target harness remains `2accbc6f062c6b7932777c61051df56a02302339`. No whole-harness migration.
- Source `src/*` and `index.html` bytes verified against Git blobs at that exact SHA before porting. Manifest: `docs/aircraft-parity-manifest.json`.
- New damage profile is a coordinated, unpublished source work proposal, not falsely attributed to c63. Its exact source work commit is[a4390f4dab320c84e94b00fbc4ab0ef1c9aa4951](https://github.com/chameleonjp-lab/kaisen/commit/a4390f4dab320c84e94b00fbc4ab0ef1c9aa4951); source module Git blobfe0c48ff296a31db70c7f93a0cdab64244ba939b equals FightFlight’s module. This remains separate from published sourcec63.

## Applied behavior

- Exact source flight equations, speed65–141m/s, cruise110, pitch.95/.62, loop5s/cooldown2s and continuous cancel recovery. Existing projection and aircraft mesh already matched source.
- Same offscreen response and Easy steering/predictive straight-shot assistance. Normal never gets auto-fire. Input recovery after pointercancel/lost capture/blur/resize and renewed primary contacts follows source.
- Stable Normal bore sight at500m, white/enemy-red coloring, aircraft diamond/distance/relative-HP labels, thin depth-tested tracers, same half-volume propeller. FightFlight has no allies, so blue friendly coloring is a reusable display adapter but cannot appear in ordinary play.
- Both modes now have288 MG/96 cannon, paired barrels, and6s automatic reload. Replaces Easy infinite magazines and Normal ammo-gameover. Pause freezes reload; the final emitted bullets continue during reload. Player rates12/4 salvos per second; enemy .28/.95s clocks, source spread and unlimited AI rounds.
- Enemy aircraft attack/extension passes follow source's aircraft-only branch. World altitude datum is translated +2050m because the source player starts350m and this game starts2400m. Source50/110/160/210/650m aircraft AI thresholds become2100/2160/2210/2260/2700m. This is a declared world-coordinate adapter, not naval AI import. Removed former ammo-flee, health-speed penalties and loop-induced pursuit suspension.
- Player/enemy collision still destroys both and ends the player's run. Enemy destruction is one ordinary kill; former guaranteed extra1,000 ram bonus is removed. With no shots/damage, one ram yields2,000 under the unchanged ordinary FightFlight kill/efficiency formula; with shots/damage it can differ. No double kill on later frames.
- Friendly-fire applicability: no player allies exist and none are introduced. Enemy AI cannot damage its own side. Kaisen Normal player-only friendly-aircraft HP×10 penalty and extra1,500 destruction penalty have no applicable target in this world; not silently simulated against enemies or fabricated allies.

## Explicit exclusions / preserved game rules

FightFlight retains its sky/world,2400m start, initial encounter, maximum5 enemies,14s spawn/3s last-enemy replacement, Easy300s/Normal unlimited time, low-altitude1200m latch/10s end, ordinary kill/loop/damage scoring, ranking/identity/storage/network implementation and historic records. Score efficiency denominator stays1,120 independently of the smaller reloading magazines. No retroactive database/ranking rewrite. Fractional damage now floors the final nonnegative score to the existing integer ranking contract (accumulated HP×10 penalty rounded upward once, with floating-point epsilon); result breakdown uses the same helper. No per-hit rounding or DB contract change.

No fleet, naval weapons, sea contact, bombs/torpedoes, ship-part damage, mission all-clear/time-attack, ally respawn/announcements, reinforcement wave or reinforcement-healing is imported. Low-altitude world termination differs intentionally from Kaisen's sea collision. Source's fleet-target branches are excluded from otherwise shared aim/AI logic.

## Future source updates

1. Resolve Kaisen main to an exact SHA; do not use an unmerged proposal as a published baseline.
2. Compare manifest-listed source files and aircraft behavior contracts. `node scripts/check-aircraft-source.mjs <source-checkout>` checks source Git-blob fingerprints without any network or repository write.
3. For changed files, distinguish aircraft logic/UI/audio from fleet/objective/world/ranking branches. Port only applicable aircraft changes and update adapters/exclusions explicitly. New source collaborators or ships do not authorize new FightFlight teams/world content.
4. Keep source SHA, damage-profile SHA/hash, target base and changed file manifest together. Update parity regressions for changed behavior; do not accept a hash update alone as parity.
5. Run focused checks during edits; at the final work boundary run full unit/build/browser checks on one identified candidate, record exact CI head and evidence. Any later code/test adjustment invalidates affected previous results.
6. Submit/update a work branch and Draft PR. Main merge, auto-merge and public deployment require target-specific approval. An unpublished candidate is not the live game.

## Physical iPhone acceptance after authorized preview/publication

- Verify release tag20261003-aircraft-parity; do not confuse an older browser cache with this candidate
- Easy/Normal: steer, hold a second control, cancel/release outside canvas, rotate, pause/resume, and steer again
- Normal: fixed sight must not jump when an enemy appears/disappears; Easy circle and enemy marker remain readable
- Hold fire through both magazines, see6s reload ring/countdown, pause/resume mid-reload and confirm refilled288/96
- In portrait and landscape: edit each control size/position/opacity, save, reopen, cancel unsaved changes; no duplicate preview IDs/blocked buttons
- Listen to propeller/shot/hit/pause/reload surroundings at an ordinary volume; synthetic audio/unit output does not prove actual speaker quality
- Confirm ram ordinary scoring and existing time/world/ranking presentation; no production ranking test submission

## Coordinated weapon/HP candidate

Aircraft maxHP80. Relative to c63HP100, all close-range base damage is reduced20% together: player MG4/cannon20; allied2.4/9.6 (source-only applicability); enemy.32/.64. The earlier4/18 and enemy.4/.8 candidate is superseded, not deployed.

| Cumulative muzzle→impact distance | MG multiplier | Cannon multiplier | Player MG / cannon damage | Player combined theoretical DPS | With measured 6s reload cycle |
|---|---:|---:|---:|---:|---:|
| 0≤d<200m |1|1|4 / 20|256|171.460|
| 200≤d<500m |.75|.9|3 / 18|216|144.670|
| 500≤d<800m |.5|.8|2 / 16|176|117.879|
| d≥800m |.25|.7|1 / 14|136|91.088|

Measured repeat interval is1,075 fixed ticks (17.9167s), from first emitted salvo to the next cycle’s first salvo. In the source cadence trace, last MG tick716, last cannon tick706 and refill/new firing tick1076; both magazines contain288/96 rounds. Sustained DPS is magazine damage divided by that repeat interval, not a rounded18s assumption.

DPS is a100%-hit upper bound from actual60Hz cadence (two barrels; player5/15ticks, AI17/57ticks). It is not measured player hit rate or an actual mission-completion promise. Cannon carries stronger per-round and long-range damage; MG retains faster cadence. Actual aim, travel time, recoil-free source spread and target maneuvering reduce realized damage. No added recoil or different ammunition cycle is inferred from this table.

Distance is accumulated3D projectile travel, including only the swept portion of the impact tick. The farther band owns exact200/500/800m. Apply once at impact to original base damage; moving the shooter after firing cannot alter damage. No attenuation compounding per tick. Source naval AA/bombs/torpedoes are outside this module.

Close-range cannon versus80HP remains four hits, preserving c63's close damage/HP ratio. This is a provisional game-balance candidate, not historical ballistics or user-approved feel. Existing game-specific population/scoring can make FightFlight's overall challenge differ despite matching aircraft behavior.

Frozen source/target module SHA-256: `b0a71f4b39aa1adab948ea3f08d99f0ed60e30deb5087992c8f748c9a5fade83` (2026-10-03T06:02:46Z). Unpublished coordinated aircraft proposal; published c63 base does not contain it.

## Target merge / latest evidence

User accountchameleonjp-lab merged[PR#9](https://github.com/chameleonjp-lab/faitofuraito/pull/9) to main9760ea26a7f1ed5f4fb1b3c5343a344df8a01925. Runtime/test tree exactly matches tested head53a953510f770cf6ad997c7fd9c233afa9afe6bd. Final[CI](https://github.com/chameleonjp-lab/faitofuraito/actions/runs/37102301325) passed81unit/build/5browser with no skips/retries. Public deployment is a separate operation; a source merge alone does not refresh the existinggh-pages branch.
