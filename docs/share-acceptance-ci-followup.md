# Share acceptance fixture follow-up

## Observed failure

The [main run 41629289672](https://github.com/chameleonjp-lab/faitofuraito/actions/runs/41629289672), at commit `051030346f41737a30387889756dea5efcdd07da`, passed its unit and build steps. The browser step reported 46 passed, 2 failed and 1 skipped. Both failures were in the combined home/result share acceptance test. Deployment was skipped.

The saved trace establishes two fixture problems:

- WebKit spent approximately 60 seconds on the home matrix before starting flight. A slow-frame pause then cleared game input. The fixture resumed by sending the same three key-down events without releasing them. Playwright treats repeated `keyboard.down()` calls as `repeat=true`; the game's existing stale-repeat guard correctly rejects them after a pause. The trace shows no intermediate key-up events. The flight remained level until the overall test deadline.
- Chromium naturally reached the result screen after approximately 22 seconds of flight, but the remaining language/orientation sweep exhausted the combined test's 90-second budget. This does not establish a result layout defect.

Reference: [Playwright keyboard.down semantics](https://playwright.dev/docs/api/class-keyboard#keyboard-down).

## Bounded change

- Release the three held keys before clicking Resume, then send fresh key-down events. Keep the existing final key release and the 45-second natural-end wait.
- Register four independent tests: home/result × portrait/landscape. Each retains a 90-second maximum and all 15 languages. All 60 distinct combinations retain language, tap-target, share-intent and overflow assertions. Result cases still begin through anonymous normal play, end naturally through input, compare the result snapshot, and return home. The landscape result case rotates after a portrait flight.
- Keep the same local-only request fence and mocked RPC allowlist. Home-only cases additionally reject guest-start calls.
- Leave all runtime files, gameplay, scoring, pause/input safety, dependencies, workflow and Playwright project configuration unchanged.

The split does not preserve every cumulative execution history: the same result no longer undergoes a complete portrait locale sweep before its landscape sweep. The basic portrait-to-landscape result transition and snapshot comparison remain. The maximum aggregate budget becomes four × 90 seconds per browser project, rather than one × 90 seconds. This is not a claim that real execution fits the existing 25-minute workflow job deadline.

## Verification and limits

The built-in Node probe can be run from the repository with:

`node scripts/check-share-acceptance-fixture.cjs`

It reads this fixture and selected actual input methods, strips TypeScript with Node's built-in API, and runs them in a restricted VM with inert page/keyboard/network doubles. It imports no Playwright or game module and launches no browser, audio, server or network operation. Node may emit an experimental warning for its TypeScript-strip API.

The unchanged baseline produced 4/7 passing cases and three expected failures: fresh input after one pause, fresh input after two pauses, and isolated test budgets. The revised fixture passes all 7 offline cases, including final key release after failures and preservation of the 60 matrix combinations. An independent review and run reproduced both results. A separate byte comparison confirms unchanged share-weight, tap-target and intent helper bodies; the natural-end helper changes only by releasing keys before resume. All 34 runtime source files match the observed main tree and are outside this delta.

These are fixture-orchestration and input-boundary checks, not browser rendering or real-time measurements. The revised browser suite, npm tests, TypeScript build, full workflow, later visual-comparison steps and deployment have not been run for this candidate. The original failed run remains the latest browser evidence described here. Browser timing and any later failures still require a permitted execution before claiming CI success or release readiness.
