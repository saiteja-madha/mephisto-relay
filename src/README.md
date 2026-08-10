# Browser extension

The original Mephisto application is a Manifest V3 browser extension. It remains in this repository for
standalone browser analysis and as the source of the Chess.com DOM adapter reused by the relay server.

The extension and relay are separate runtimes: the extension performs analysis inside its toolbar popup, while
the relay moves monitoring into a persistent server process so web and mobile clients can remain independent of
the active browser tab.

## Components

- `manifest.json` registers the popup, options page, background worker, and site content scripts.
- `src/scripts/content-script.js` reads board state, SAN history, orientation, promotions, and variants.
- `src/popup/popup.js` owns polling, FEN reconstruction, engine orchestration, rendering, and toolbar actions.
- `lib/chess.js` validates moves and rebuilds positions.
- `lib/engine/` contains bundled JavaScript/WebAssembly engines and weights when present.
- `src/scripts/remote-engine.py` exposes a local UCI engine over HTTP; the relay also uses this service.
- `src/options/` stores engine, timing, autoplay, and appearance preferences in extension storage.

## Analysis loop

The popup asks the content script for an encoded position at the configured refresh interval. The content script
returns move history or a direct piece list plus board orientation. The popup then:

1. reuses a cached FEN when possible;
2. applies only the newest SAN move for incremental updates;
3. otherwise replays the complete move history; or
4. reconstructs the board directly for puzzle and non-standard pages.

Only a changed FEN restarts engine analysis. Bundled engines receive normal UCI `position` and `go movetime`
commands. When the remote engine is selected, the same FEN is sent to `POST /analyse` and equivalent JSON is
returned.

The popup displays the first principal-variation move in blue and its expected response in red. Depending on
settings, it can also show evaluation, depth, MultiPV candidates, coordinates, and alternate themes.

## Lifecycle and optional automation

Content scripts load on matching pages, but the popup owns the engine and timer. Closing the popup therefore
stops the original extension analysis loop. This limitation motivated the persistent relay architecture.

Optional autoplay sends a recommended UCI move back to the content script, which translates squares into board
coordinates and dispatches configured source, destination, and promotion interactions. The legacy Python clicker
is a separate OS-level backend. Use automation only where explicitly permitted.

## Loading locally

For Chromium, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked** with the
repository root. Review extension permissions and configure engine options before use.

The relay does not require the extension to be installed; it injects the shared Chess.com adapter directly into
its Playwright page.
