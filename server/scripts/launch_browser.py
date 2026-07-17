#!/usr/bin/env python3
"""Launch the persistent local Chromium CDP browser used by Mephisto."""

import argparse
import os
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.browser_launcher import (
    cdp_is_reachable,
    local_cdp_address,
    start_local_chromium,
)

DEFAULT_PROFILE_PATH = ROOT / "server" / ".auth" / "chromium-profile"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Start one persistent local Chromium browser with a CDP debugging endpoint."
    )
    parser.add_argument(
        "--cdp-url",
        default=os.environ.get("PLAYWRIGHT_CDP_URL", "http://127.0.0.1:9222"),
        help="Local HTTP CDP discovery URL (default: PLAYWRIGHT_CDP_URL or localhost:9222)",
    )
    parser.add_argument(
        "--profile",
        type=Path,
        default=Path(os.environ.get("MEPHISTO_BROWSER_PROFILE", DEFAULT_PROFILE_PATH)),
        help="Persistent Chromium profile directory",
    )
    return parser.parse_args()


def run(args):
    address = local_cdp_address(args.cdp_url)
    if not address:
        raise RuntimeError(
            "launch_browser.py supports only local http://127.0.0.1 or http://localhost CDP URLs. "
            "Remote ws:// and wss:// browsers must be started by their provider."
        )

    host, port = address
    if cdp_is_reachable(host, port):
        print(f"Chromium is already available at {args.cdp_url}; no new browser was started.")
        return

    with sync_playwright() as playwright:
        start_local_chromium(
            playwright.chromium.executable_path,
            host,
            port,
            args.profile.expanduser().resolve(),
        )
    print("Chromium will remain running for first_login.py and server.app.")


def main():
    try:
        run(parse_args())
    except (RuntimeError, OSError) as exc:
        print(f"Browser launch failed: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Browser launch cancelled.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
