#!/usr/bin/env python3
"""Real-browser E2E smoke test for the FLOP miner demo.
Serves the project dir over HTTP, opens it in system Chrome via Playwright,
clicks Start, waits for real blocks to be mined (SHA-256 workers), checks the
DID panel derives a correct did:key from a test seed, and verifies broadcast
URL construction + live Technocore read.  NOT a crypto test (that's crosscheck).
"""
import http.server, threading, socketserver, functools, sys, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8931

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

TEST_SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = browser.new_page(viewport={"width": 1500, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
    page.wait_for_timeout(400)

    print("title:", page.title())
    assert "挖矿" in page.title() or "Mining" in page.title()

    # 1) difficulty + workers default UI
    diff = page.input_value("#diffSlider"); workers = page.input_value("#workersSlider")
    print("defaults: diff =", diff, " workers =", workers)
    assert diff == "5" and workers == "2"

    # 2) DID connect with test seed → did:key should match python reference
    page.fill("#seedInput", TEST_SEED)
    page.click("#btnConnect")
    page.wait_for_timeout(300)
    did_shown = page.inner_text("#didShow")
    print("did shown:", did_shown[:44], "…")
    assert did_shown.startswith("did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd"), "did derivation mismatch"
    state = page.inner_text("#didState")
    print("did state:", state)
    assert "已连接" in state

    # 3) default room lobby + default interval → start mining, wait for a real block
    #    (start & stop events broadcast; block broadcasts every 10 blocks by default)
    page.click("#btnMine")
    page.wait_for_timeout(2000)
    mining_led = page.inner_text("#minerLed")
    print("led:", mining_led)
    assert "挖矿中" in mining_led

    # wait up to ~60 s for the first block (diff5, 2 workers, real SHA-256)
    ok = False
    for _ in range(60):
        page.wait_for_timeout(1000)
        try:
            blocks = page.inner_text("#statBlocks").strip()
            if blocks and int(blocks) >= 1:
                ok = True
                print("blocks mined:", blocks, " balance:", page.inner_text("#balance"))
                break
        except Exception:
            pass
    assert ok, "no block mined within 60s — worker broken?"
    assert int(page.inner_text("#balance").replace(",", "")) >= 96

    # stop mining (start & stop events broadcast to lobby — real network write)
    page.click("#btnMine")
    page.wait_for_timeout(4000)
    log_text = page.inner_text("#didLog")
    print("log tail:", log_text.replace("\n", " | ")[-300:])
    assert "广播成功" in log_text, "no successful broadcast in log — check network path"

    js_errors = [e for e in errors if "favicon" not in e.lower()]
    print("\nJS errors:", js_errors if js_errors else "none")
    assert not js_errors
    browser.close()

print("\nE2E OK — real block mined in browser, DID derived, broadcast fired")
