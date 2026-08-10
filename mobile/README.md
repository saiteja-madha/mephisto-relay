# Mephisto Relay for iOS

The `mobile/` project is an Expo SDK 57 iOS client for the Mephisto Relay server. It starts and stops monitoring
sessions, consumes the existing SSE analysis stream, renders the server's annotated SVG board, and maintains a
local ActivityKit Live Activity for the Lock Screen and Dynamic Island.

APNs is deliberately not part of this MVP. Foreground updates arrive over SSE. When the app moves to the
background, an Expo background-location task asks the relay's `latest` endpoint for the newest event and updates
the Live Activity locally.

## Requirements

- Node.js 22.13 or newer;
- Xcode 26.4 or newer with an iOS platform installed;
- CocoaPods 1.16.2 or newer;
- iOS 16.4 or newer;
- a physical Dynamic Island-capable iPhone for final Dynamic Island testing.

This project does not run in Expo Go because Live Activities and background location require native targets. Use
an Expo development build.

## Configure the relay server

The phone cannot reach a server bound to `127.0.0.1`. Start the Flask application on the Mac's LAN interface:

```bash
PLAYWRIGHT_CDP_URL=http://127.0.0.1:9222 \
MEPHISTO_ENGINE_URL=http://127.0.0.1:9090 \
MEPHISTO_HOST=0.0.0.0 \
python -m server.app
```

Find the Mac's Wi-Fi address:

```bash
ipconfig getifaddr en0
```

Enter `http://<mac-ip>:8080` in the mobile app. The phone and Mac must be on the same network, and macOS must
allow incoming connections to Python. Plain HTTP is enabled for this personal LAN MVP in `app.json`; use HTTPS
before exposing the relay outside the trusted network.

## Install and run

```bash
cd mobile
npm install
npx expo prebuild --platform ios
npx expo run:ios --device
```

Before installing on a real device, replace these example identifiers in `app.json` with identifiers unique to
your Apple account:

- `ios.bundleIdentifier`;
- the `expo-widgets` `bundleIdentifier`;
- the `expo-widgets` `groupIdentifier`.

Select your Personal Team or paid Apple Developer team when Xcode asks for signing. A free Personal Team can be
used for personal on-device development, but its provisioning must be renewed periodically and some entitlement
combinations may require paid membership.

To use Xcode directly:

```bash
npx expo prebuild --platform ios
cd ios
pod install
open MephistoRelay.xcworkspace
```

Always open the workspace, not the `.xcodeproj`.

## Runtime behavior

1. Enter the relay address, game ID or URL, player color, and optional **Only show my move** setting.
2. Tap **Start analysis**. The app creates the server session, starts the Live Activity, connects SSE, and asks
   for foreground and background location permission.
3. While foregrounded, each SSE analysis updates the move cards, board SVG, and Live Activity immediately.
4. In the background, Core Location callbacks fetch `GET /api/sessions/<id>/latest` and locally refresh the Live
   Activity.
5. Tap **Stop** to close SSE, stop location use, end the Live Activity, stop the server session, and close its
   Playwright tab.

In player-only mode, the app and Dynamic Island show **Waiting for your opponent** during the opponent's turn.
They do not retain a stale player move or board.

## Background limitations

The location workaround is best-effort:

- iOS controls callback frequency and may throttle it;
- a stationary device may update less often;
- force-quitting the app ends background updates;
- the blue background-location indicator may appear;
- background updates consume more battery than APNs.

APNs remains the future reliability upgrade when updates must arrive independently of the app process.

## Validation

```bash
npm run typecheck
npm test
node node_modules/expo-widgets/scripts/build-bundle.mjs .
```

If Xcode reports that CoreSimulator is out of date or an iOS platform is missing, install the matching platform
from **Xcode → Settings → Components**, update macOS/Xcode if necessary, then restart Xcode.
