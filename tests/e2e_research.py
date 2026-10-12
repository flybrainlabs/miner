#!/usr/bin/env python3
"""Optional real browser run against an exported research-app and local official-derived files."""
from __future__ import annotations

import argparse
from pathlib import Path
import tempfile
import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

EXPECTED_RESULT = "6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0"


def main(url: str, graph: Path, model: Path, cache_roundtrip: bool = False):
    profile = tempfile.TemporaryDirectory(prefix="flypow-chrome-", dir=graph.parent) if cache_roundtrip else None
    options = webdriver.ChromeOptions()
    options.binary_location = "/usr/bin/chromium"
    for arg in ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server", "--window-size=1440,1000"]:
        options.add_argument(arg)
    if profile:
        options.add_argument("--user-data-dir=" + profile.name)
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    driver = webdriver.Chrome(options=options)
    try:
        driver.get(url.rstrip("/") + "/mining/?view=tools")
        wait = WebDriverWait(driver, 120)
        wait.until(lambda browser: browser.find_element(By.ID, "research-capabilities").text)
        driver.find_element(By.ID, "research-graph").send_keys(str(graph.resolve()))
        driver.find_element(By.ID, "research-model").send_keys(str(model.resolve()))
        started = time.monotonic()
        prepare = driver.find_element(By.ID, "research-prepare")
        driver.execute_script("arguments[0].scrollIntoView({block:'center'})", prepare)
        prepare.click()
        wait.until(lambda browser: browser.find_element(By.ID, "research-tools-state").text in {"Full model ready", "Preparation needs attention"})
        state = driver.find_element(By.ID, "research-tools-state").text
        if state != "Full model ready":
            raise AssertionError(driver.find_element(By.ID, "miner-error-detail").text)
        prepare_seconds = round(time.monotonic() - started, 2)
        cache_seconds = None
        if cache_roundtrip:
            started = time.monotonic()
            cache = driver.find_element(By.ID, "research-cache")
            if not cache.is_enabled():
                raise AssertionError("OPFS cache unavailable in this Chromium session")
            driver.execute_script("arguments[0].click()", cache)
            WebDriverWait(driver, 180).until(lambda browser: browser.find_element(By.ID, "research-tools-state").text=="Full model ready" and browser.find_element(By.ID, "miner-primary").is_enabled())
            WebDriverWait(driver, 180).until(
                lambda browser: browser.find_element(By.ID, "research-tools-cache-note").text
                != "Saving checked full graph and model to OPFS…")
            note = driver.find_element(By.ID, "research-tools-cache-note").text
            if "Saved on this device" not in note:
                raise AssertionError("OPFS save failed: " + note)
            cache_seconds = round(time.monotonic() - started, 2)
            driver.get(url.rstrip("/")+"/mining/?view=tools")
            wait.until(lambda browser: browser.find_element(By.ID, "research-capabilities").text)
            restore = driver.find_element(By.ID, "research-restore")
            driver.execute_script("arguments[0].click()", restore)
            wait.until(lambda browser: browser.find_element(By.ID, "research-tools-state").text in {"Full model ready", "Preparation needs attention"})
            if driver.find_element(By.ID, "research-tools-state").text != "Full model ready":
                raise AssertionError(driver.find_element(By.ID, "miner-error-detail").text)
        started = time.monotonic()
        run = driver.find_element(By.ID, "research-run")
        driver.execute_script("arguments[0].scrollIntoView({block:'center'})", run)
        driver.execute_script("arguments[0].click()", run)
        wait.until(lambda browser: browser.execute_script("return document.querySelector('.research-app').dataset.execution==='complete'"))
        driver.execute_script("document.getElementById('miner-show-result').click()")
        wait.until(lambda browser: browser.find_element(By.ID, "research-response").is_displayed()
                   or browser.find_element(By.ID, "research-tools-state").text == "Preparation needs attention")
        if not driver.find_element(By.ID, "research-response").is_displayed():
            raise AssertionError(driver.find_element(By.ID, "research-run-state").text)
        driver.execute_script("document.getElementById('miner-result-details').open=true")
        result_hash = driver.find_element(By.ID, "research-result-hash").text
        if EXPECTED_RESULT not in result_hash:
            raise AssertionError(f"unexpected result: {result_hash}")
        run_seconds = round(time.monotonic() - started, 2)
        a_spikes = driver.find_element(By.ID, "research-a").text
        b_spikes = driver.find_element(By.ID, "research-b").text
        top_rows = len(driver.find_elements(By.CSS_SELECTOR, "#research-top tr"))
        if cache_roundtrip:
            corruption = driver.execute_async_script("""
                const done = arguments[0];
                (async () => {
                  const config = await (await fetch('/assets/data/research-config.json')).json();
                  const name = `flypow-research-${config.graph_sha256.slice(0, 16)}-${config.model_sha256.slice(0, 16)}`;
                  const root = await navigator.storage.getDirectory();
                  const directory = await root.getDirectoryHandle(name);
                  const handle = await directory.getFileHandle('model-v0.bin');
                  const original = new Uint8Array(await (await handle.getFile()).slice(100, 101).arrayBuffer())[0];
                  const writer = await handle.createWritable({ keepExistingData: true });
                  await writer.write({ type: 'write', position: 100, data: new Uint8Array([original ^ 1]) });
                  await writer.close();
                  done('corrupted');
                })().catch(error => done(String(error)));
            """)
            if corruption != "corrupted":
                raise AssertionError("Could not prepare cache corruption test: " + corruption)
            driver.get(url.rstrip("/")+"/mining/?view=tools")
            wait.until(lambda browser: browser.find_element(By.ID, "research-capabilities").text)
            driver.execute_script("arguments[0].click()", driver.find_element(By.ID, "research-restore"))
            wait.until(lambda browser: browser.find_element(By.ID, "research-tools-state").text == "Preparation needs attention")
            detail = driver.find_element(By.ID, "miner-error-detail").get_attribute('textContent')
            if "SHA-256 mismatch" not in detail or driver.find_element(By.ID, "research-run").is_enabled():
                raise AssertionError("Corrupt cache was not rejected: " + detail)
            driver.execute_script("arguments[0].click()", driver.find_element(By.ID, "research-clear-cache"))
            driver.switch_to.alert.accept()
            wait.until(lambda browser: "Saved on this device" not in browser.find_element(By.ID, "research-tools-cache-note").text)
        print({"prepare_seconds": prepare_seconds, "cache_seconds": cache_seconds,
               "run_seconds": run_seconds,
               "a_spikes": a_spikes,
               "b_spikes": b_spikes,
               "response_hash": result_hash,
               "top_rows": top_rows, "corrupt_cache_rejected": cache_roundtrip})
    finally:
        for entry in driver.get_log("browser"):
            if entry["level"] in {"SEVERE", "WARNING"}:
                print("browser console:", entry["message"])
        driver.quit()
        if profile:
            profile.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--graph", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--cache-roundtrip", action="store_true")
    args = parser.parse_args()
    main(args.url, args.graph, args.model, args.cache_roundtrip)
