#!/usr/bin/env python3
"""Actual full official Feather -> CSR -> WASM build in Chromium, with OPFS recovery."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlsplit
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

EXPECTED = "6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0"

class BrowserMemory:
    """Sample proportional resident memory, summed over the actual browser process tree."""
    def __init__(self, driver_pid):
        self.pid, self.peak, self.samples, self.stop = driver_pid, 0, 0, threading.Event()
        self.thread = threading.Thread(target=self.sample, daemon=True)
        self.thread.start()
    def sample(self):
        while not self.stop.wait(.5):
            parents = {}
            for p in Path('/proc').iterdir():
                if not p.name.isdigit(): continue
                try:
                    status=p.joinpath('status').read_text().splitlines()
                    parents[int(p.name)]=next(int(line.split()[1]) for line in status if line.startswith('PPid:'))
                except (OSError, StopIteration): pass
            descendants = {self.pid}
            while True:
                more = {pid for pid, parent in parents.items() if parent in descendants}
                new = more - descendants
                if not new: break
                descendants |= new
            total = 0
            for pid in descendants - {self.pid}:
                try:
                    lines = Path(f"/proc/{pid}/smaps_rollup").read_text().splitlines()
                    total += next(int(line.split()[1])*1024 for line in lines if line.startswith("Pss:"))
                except (OSError, StopIteration): pass
            self.samples += 1
            self.peak = max(self.peak, total)
    def close(self):
        self.stop.set()
        self.thread.join(timeout=3)

def main(args):
    report = {"schema": "flypow-official-chromium-build-v1", "official_download_bytes_in_browser": 0,
              "input_mode": "official-local-import (source lacks browser CORS)", "checks": []}
    with tempfile.TemporaryDirectory(prefix="flypow-official-browser-", dir=Path(args.report).parent) as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = "/usr/bin/chromium"
        for flag in ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server", "--window-size=1440,1000", "--user-data-dir="+profile]:
            options.add_argument(flag)
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        driver = webdriver.Chrome(options=options)
        driver.set_script_timeout(60)
        memory = BrowserMemory(driver.service.process.pid)
        wait = WebDriverWait(driver, 900)
        page = args.url.rstrip("/")+"/mining/"
        def click(id): driver.execute_script("arguments[0].click()", driver.find_element(By.ID, id))
        def boot():
            driver.get(page)
            wait.until(lambda d: d.find_element(By.ID, "research-capabilities").text or d.find_element(By.ID,"research-state").text == 'Operation failed')
            if driver.find_element(By.ID,'research-state').text == 'Operation failed':raise AssertionError(driver.find_element(By.ID,'research-detail').text)
        def inputs():
            for kind in ["annotation", "weights", "transmitter"]:
                driver.find_element(By.ID, "research-"+kind).send_keys(str(getattr(args, kind).resolve()))
        def final_state():
            wait.until(lambda d: d.find_element(By.ID, "research-state").text in {"Full model ready", "Operation failed"})
            if driver.find_element(By.ID, "research-state").text != "Full model ready":
                raise AssertionError(driver.find_element(By.ID, "research-detail").text)
        def opfs(script):
            return driver.execute_async_script("""
              const done=arguments[0];(async()=>{
                const root=await navigator.storage.getDirectory();
                const m=await(await fetch('/assets/data/official-inputs.json')).json();
                const d=await root.getDirectoryHandle(`flypow-inputs-${m.builder}-${m.registry_sha256.slice(0,16)}`);
            """+script+"""
              })().then(done,e=>done({error:String(e)}));
            """)
        try:
            boot(); inputs()
            origin=urlsplit(args.url);origin=f"{origin.scheme}://{origin.netloc}"
            driver.execute_cdp_cmd("Storage.overrideQuotaForOrigin", {"origin": origin, "quotaSize": 32*1024*1024})
            click("research-build")
            wait.until(lambda d: d.find_element(By.ID, "research-state").text == "Operation failed")
            quota_error=driver.find_element(By.ID, "research-detail").text
            assert any(word in quota_error.lower() for word in ['quota','no space']), quota_error
            assert not driver.find_element(By.ID, "research-run").is_enabled()
            report["checks"].append("insufficient real quota aborts preparation without a ready model or credit")
            driver.execute_cdp_cmd("Storage.overrideQuotaForOrigin", {"origin": origin, "quotaSize": 8*1024*1024*1024})
            click('research-clear-inputs')
            wait.until(lambda d: 'cleared' in d.find_element(By.ID,'research-cache-note').text)
            click("research-build")
            wait.until(lambda d: d.find_element(By.ID, "research-state").text == "Caching weights")
            click("research-cancel")
            wait.until(lambda d: d.find_element(By.ID, "research-state").text == "Paused")
            assert not driver.find_element(By.ID, "research-run").is_enabled()
            checkpoint = opfs("const f=await d.getFileHandle('weights-chunks.json');return JSON.parse(await(await f.getFile()).text());")
            assert checkpoint.get("chunks"), checkpoint
            report["checks"].append("cancellation retains completed, hashed official source blocks")
            report["resume_saved_blocks"] = len(checkpoint["chunks"])
            # Hold the same model lock in another tab and attempt a real build.
            first = driver.current_window_handle
            driver.switch_to.new_window("tab"); boot(); second = driver.current_window_handle
            driver.execute_script("window.testHold=true;window.testLockReady=false;navigator.locks.request('flybrain-research-dev-v0',async()=>{window.testLockReady=true;while(window.testHold)await new Promise(r=>setTimeout(r,50));});")
            wait.until(lambda d: d.execute_script("return window.testLockReady"))
            driver.switch_to.window(first); click("research-build")
            wait.until(lambda d: "Another tab" in d.find_element(By.ID, "research-detail").text)
            driver.switch_to.window(second);driver.execute_script("window.testHold=false");driver.close();driver.switch_to.window(first)
            report["checks"].append("multiple tabs cannot build concurrently")
            driver.refresh();wait.until(lambda d: d.find_element(By.ID, "research-capabilities").text);inputs()
            # Damage a checkpointed cached byte; reimport must restore its exact original hash.
            damage=opfs("""
              const f=await d.getFileHandle('weights.feather'),b=new Uint8Array(await(await f.getFile()).slice(10,11).arrayBuffer());
              const w=await f.createWritable({keepExistingData:true});await w.write({type:'write',position:10,data:new Uint8Array([b[0]^1])});await w.close();return true;
            """)
            assert damage is True, damage
            started=time.monotonic();click("research-build");final_state();report["prepare_seconds"]=round(time.monotonic()-started,3)
            checked=opfs("return JSON.parse(await(await(await d.getFileHandle('weights-chunks.json')).getFile()).text());")
            assert checked["chunks"][0]["sha256"] == checkpoint["chunks"][0]["sha256"]
            report["checks"].append("refresh resumes and damaged checked block is replaced from official local file")
            browser_report=driver.execute_script("return window.flypowLastMemoryReport")
            report["browser_memory_report"]=browser_report
            report["official_input_bytes"]=sum(getattr(args, k).stat().st_size for k in ["annotation","weights","transmitter"])
            report["build_text"]=driver.find_element(By.ID,"research-build-report").text
            assert "165,122" in report["build_text"] and "25,563,197" in report["build_text"]
            started=time.monotonic();click("research-run")
            wait.until(lambda d: d.find_element(By.ID,"research-response").is_displayed())
            assert EXPECTED in driver.find_element(By.ID,"research-result-hash").text
            report["experiment_seconds"]=round(time.monotonic()-started,3)
            report["result_root"]=EXPECTED
            wait.until(lambda d: d.find_elements(By.CSS_SELECTOR,"#research-history article"))
            # A viewer can replay a saved response after reload without loading the 207 MB graph.
            driver.refresh();wait.until(lambda d: d.find_elements(By.CSS_SELECTOR,"#research-history article"))
            assert not driver.find_element(By.ID,"research-run").is_enabled()
            driver.execute_script("arguments[0].click()",driver.find_element(By.CSS_SELECTOR,"#research-history article button"))
            wait.until(lambda d:d.find_element(By.ID,"research-response").is_displayed())
            assert EXPECTED in driver.find_element(By.ID,"research-result-hash").text
            report["checks"].append("saved response card replays without full model preparation")
            driver.execute_script("arguments[0].value='16961';arguments[0].dispatchEvent(new Event('change'))",driver.find_element(By.ID,"research-cell"))
            assert not driver.find_element(By.ID,"research-response").is_displayed()
            assert "16961" in driver.find_element(By.ID,"research-matrix-note").text
            report["checks"].append("switching real cells cancels and releases the previous skeleton")
            click("research-restore");final_state()
            report["checks"].append("browser-built full model restores after refresh with full digest validation")
            # Storage eviction is a missing artifact, never silently a smaller model.
            driver.execute_async_script("const done=arguments[0];(async()=>{const c=await(await fetch('/assets/data/research-config.json')).json();const d=await(await navigator.storage.getDirectory()).getDirectoryHandle(`flypow-research-${c.graph_sha256.slice(0,16)}-${c.model_sha256.slice(0,16)}`);await d.removeEntry('model-v0.bin');done(true);})().catch(e=>done(String(e)));")
            driver.refresh();wait.until(lambda d:d.find_element(By.ID,"research-capabilities").text);click("research-restore")
            wait.until(lambda d:d.find_element(By.ID,"research-state").text == "Operation failed")
            assert not driver.find_element(By.ID,"research-run").is_enabled()
            report["checks"].append("evicted model disables actual computation and grants no credit")
            report["browser_errors"]=[x["message"] for x in driver.get_log("browser") if x["level"]=="SEVERE"]
            if report["browser_errors"]:raise AssertionError(report["browser_errors"])
        finally:
            memory.close();report["sampled_browser_tree_peak_pss_bytes"]=memory.peak;report["pss_sample_count"]=memory.samples
            report["memory_measurement"]="500 ms sampled PSS of Chromium process tree; no claim about unsampled instantaneous peaks or other devices"
            Path(args.report).write_text(json.dumps(report,indent=2)+"\n")
            driver.quit()
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',required=True)
    for k in ['annotation','weights','transmitter']:p.add_argument('--'+k,required=True,type=Path)
    p.add_argument('--report',default='data/prepared/browser-official-report.json')
    main(p.parse_args())
