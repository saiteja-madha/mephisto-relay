"""Utilities for starting a local Chromium CDP endpoint."""

from pathlib import Path
import subprocess
import time
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import urlopen


def local_cdp_address(cdp_url: str):
    parsed = urlparse(cdp_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        return None
    return parsed.hostname, parsed.port or 9222


def wait_for_cdp(host: str, port: int, timeout: float = 15):
    version_url = f"http://{host}:{port}/json/version"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urlopen(version_url, timeout=1) as response:
                if response.status == 200:
                    return
        except (URLError, TimeoutError):
            time.sleep(0.25)
    raise RuntimeError(
        f"Chromium started, but its CDP endpoint did not become ready at {version_url}"
    )


def cdp_is_reachable(host: str, port: int, timeout: float = 1) -> bool:
    try:
        with urlopen(f"http://{host}:{port}/json/version", timeout=timeout) as response:
            return response.status == 200
    except (URLError, TimeoutError):
        return False


def start_local_chromium(
    executable_path: str,
    host: str,
    port: int,
    profile_path: Path,
    report=print,
):
    executable = Path(executable_path)
    if not executable.is_file():
        raise RuntimeError(
            "Playwright Chromium is not installed. Run `playwright install chromium` in the server virtual "
            "environment, then retry."
        )

    profile_path.mkdir(parents=True, exist_ok=True)
    command = [
        str(executable),
        f"--remote-debugging-address={'127.0.0.1' if host == 'localhost' else host}",
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_path.resolve()}",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
    ]
    report(f"No browser is listening on {host}:{port}; starting local Chromium")
    subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    wait_for_cdp(host, port)
    report(f"Chromium CDP endpoint is ready at http://{host}:{port}")
