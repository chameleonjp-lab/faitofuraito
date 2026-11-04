# Browser-check CSS and HMR follow-up

## Observed failure

[Game checks run 41754118365](https://github.com/chameleonjp-lab/faitofuraito/actions/runs/41754118365), at main `e226385b3697b38320d17bc681702846091b550a`, finished with 46 browser cases passed, 8 failed, and 1 skipped. All eight sharing cases reached their final network assertion and reported two blocked WebSocket attempts. These are failures, not accepted browser checks.

The run's trace responses show that the local HTML no longer contained Vite's injected client script, but the JavaScript response for `src/style.css` still imported `/@vite/client`. The development client then tried its normal connection and its fallback. The network fence blocked both. The observed path agrees with [Vite 8.3.1's CSS transform](https://github.com/vitejs/vite/blob/v8.3.1/packages/vite/src/node/plugins/css.ts) and [client connection code](https://github.com/vitejs/vite/blob/v8.3.1/packages/vite/src/client/client.ts). Setting `hmr: false` did not remove this CSS-driven import in the recorded run.

## Bounded change

Only the existing test-server plugin is extended:

- Before Vite analyzes the exact `src/main.ts` entry, remove its two existing CSS side-effect imports. Require exactly one of each and their existing order, otherwise fail. Preserve every other entry byte. Normalize Windows path separators and ignore a Vite query suffix; unrelated modules are untouched.
- Add `style.css?direct` then `control-settings.css?direct` as stylesheet links in the document head. These are the original CSS files in the original cascade order. Direct CSS avoids the JavaScript style-module path that imports the HMR client. A missing head fails. Partial, duplicate, or reversed links in the exact generated format also fail rather than silently omit styles; this check is not a general HTML parser. Repeating the exact transform does not duplicate links.
- Keep the existing post-transform removal of the injected client script.

The production Vite configuration, game source, CSS files, game rules, scoring, snapshots, and browser sharing fixture are unchanged. The HTTP, redirect, RPC, popup, service-worker, and WebSocket fences are also unchanged. In particular, WebSocket attempts still fail the check; no diagnostic is filtered out and no external request is permitted by this change.

## Verification and limits

The focused `tests/browser-check-policy.test.ts` suite is run directly with Node's built-in test runner and TypeScript stripping, using injected server/browser/route fakes. It does not start Vite or a browser and does not send a request. The original candidate produced the expected two failing regressions, then the bounded fix passed the focused suite. A reversed-import regression was added separately before its guard.

The focused checks cover the actual entry and HTML as text, import preservation and order, query and Windows IDs, direct stylesheet order, repeat transforms, malformed link layouts, URL restrictions, no-forward RPC mocks, blocked redirects and sockets, and setup ordering. These are not evidence of a successful browser run.

Full npm tests, type-check/build, Vite execution, browser acceptance, CI, and deployment have not been run for this candidate. The previous CI success for npm tests/build belongs to the old main commit and is not reused as this candidate's result. Styles now load as head stylesheets instead of runtime-injected style elements in the local test server. Actual stylesheet responses, load completion before initial layout, rendering, and all eight sharing cases still require an authorized browser/CI check. Production loading is unchanged.

This is a Draft-stage test-harness fix, not a merge or publication completion claim. The existing workflow can run after an owner-controlled merge; no workflow or deployment setting is changed here.
