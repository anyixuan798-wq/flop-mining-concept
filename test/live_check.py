#!/usr/bin/env python3
"""Final live-site verification: open the GitHub Pages URL in real Chrome,
mine a real block, connect DID, broadcast start/stop to lobby."""
import os
from playwright.sync_api import sync_playwright

URL = "https://anyixuan798-wq.github.io/flop-mining-concept/"
SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"  # dedicated test identity

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = browser.new_page(viewport={"width": 1500, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "favicon" not in m.text else None)
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(800)
    print("LIVE title:", page.title())

    # DID connect
    page.fill("#seedInput", SEED)
    page.click("#btnConnect")
    page.wait_for_timeout(400)
    print("did state:", page.inner_text("#didState"))
    assert "已连接" in page.inner_text("#didState")

    # mine a real block
    page.click("#btnMine")
    ok = False
    for _ in range(75):
        page.wait_for_timeout(1000)
        try:
            if int(page.inner_text("#statBlocks").strip()) >= 1:
                ok = True
                break
        except Exception:
            pass
    print("blocks:", page.inner_text("#statBlocks").strip(), "balance:", page.inner_text("#balance").strip())
    assert ok, "no block on live site"
    # stop → broadcasts stop event to lobby
    page.click("#btnMine")
    page.wait_for_timeout(4500)
    log = page.inner_text("#didLog")
    print("log:", log.replace("\n", " | ")[-260:])
    assert "广播成功" in log
    print("JS errors:", errors if errors else "none")
    assert not errors
    browser.close()
print("\nLIVE SITE OK — real mining + signed broadcast verified on GitHub Pages")
