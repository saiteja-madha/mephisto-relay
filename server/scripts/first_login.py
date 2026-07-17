#!/usr/bin/env python3
"""One-time interactive Chess.com login for the Mephisto monitor."""

import argparse
import os
from pathlib import Path
import stat
import sys

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_STATE_PATH = ROOT / "server" / ".auth" / "chesscom-storage-state.json"


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Connect to the configured CDP browser, open Chess.com login, and save cookies/local storage "
            "for later monitoring sessions."
        )
    )
    parser.add_argument(
        "--cdp-url",
        default=os.environ.get("PLAYWRIGHT_CDP_URL", "http://127.0.0.1:9222"),
        help="CDP discovery URL or ws:// / wss:// endpoint (default: PLAYWRIGHT_CDP_URL or localhost:9222)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(os.environ.get("MEPHISTO_STORAGE_STATE", DEFAULT_STATE_PATH)),
        help="Storage-state JSON destination (default: server/.auth/chesscom-storage-state.json)",
    )
    return parser.parse_args()


def connect_browser(playwright, args):
    print(f"Connecting to Chromium at {args.cdp_url}", flush=True)
    try:
        return playwright.chromium.connect_over_cdp(args.cdp_url)
    except PlaywrightError as first_error:
        raise RuntimeError(
            f"Could not connect to the CDP endpoint {args.cdp_url}. For a local browser, run "
            "`python server/scripts/launch_browser.py` first."
        ) from first_error


def run_login(args):
    state_path = args.output.expanduser().resolve()
    state_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = connect_browser(playwright, args)
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        page = context.new_page()
        page.goto("https://www.chess.com/login", wait_until="domcontentloaded", timeout=60_000)

        print("\nChess.com login is open in the browser.")
        print("Complete login, including any verification challenge, in that browser tab.")
        input("When your Chess.com home page is visible, press Enter here to save the session: ")

        if "/login" in page.url:
            raise RuntimeError(
                "The browser is still on the Chess.com login page, so no state was saved. "
                "Finish login and run this script again."
            )

        context.storage_state(path=str(state_path))
        state_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        print(f"\nSaved login state to {state_path}")
        print("The monitoring server will load this file automatically on its next start.")
        page.close()


def main():
    try:
        run_login(parse_args())
    except (PlaywrightError, RuntimeError) as exc:
        print(f"\nLogin setup failed: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nLogin setup cancelled.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
