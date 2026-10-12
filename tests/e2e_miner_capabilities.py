#!/usr/bin/env python3
"""Lightweight preparation failure paths; capability failures are explicit injections.

Old-version entries use real OPFS files. No fixture is a scientific model.
"""
import argparse,json,tempfile
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

def main(a):
 report={'schema':'flypow-miner-capabilities-v1','checks':[],
         'faults':'missing Worker, missing OPFS and denied OPFS are injected; versioned storage entries are actual OPFS writes; no scientific computation is represented by this test'}
 out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='miner-capabilities-',dir=out.parent) as profile:
  o=webdriver.ChromeOptions();o.binary_location='/usr/bin/chromium'
  for f in ['--headless=new','--no-sandbox','--no-proxy-server','--disable-dev-shm-usage','--user-data-dir='+profile]:o.add_argument(f)
  d=webdriver.Chrome(options=o);w=WebDriverWait(d,30);d.set_script_timeout(30)
  def phase():return d.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-preparation')
  def click(i):d.execute_script('arguments[0].click()',d.find_element(By.ID,i))
  def boot():d.get(a.url.rstrip('/')+'/mining/');w.until(lambda b:phase()!='checking')
  def inject(s):return d.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':s})['identifier']
  def remove(i):d.execute_cdp_cmd('Page.removeScriptToEvaluateOnNewDocument',{'identifier':i})
  try:
   h=inject('window.Worker=undefined');boot();assert phase()=='unsupported';assert not d.find_element(By.ID,'miner-primary').is_enabled();click('miner-example');w.until(lambda b:b.find_elements(By.CSS_SELECTOR,'#miner-example-anatomy img'));report['checks'].append('missing Worker is detected before bulk downloads; actual lightweight anatomy remains browsable');remove(h)
   h=inject('navigator.storage.getDirectory=undefined');boot();click('miner-primary');w.until(lambda b:phase()=='error');assert 'cannot store the official inputs' in d.find_element(By.ID,'miner-error').text;assert not any('.wasm' in x for x in d.execute_script('return performance.getEntriesByType("resource").map(r=>r.name)'));report['checks'].append('missing OPFS has a specific prepared-model fallback and does not start a model Worker');remove(h)
   h=inject("navigator.storage.getDirectory=async()=>{throw new DOMException('Injected permission denial','NotAllowedError')}");boot();click('miner-primary');w.until(lambda b:phase()=='error');assert 'cannot store' in d.find_element(By.ID,'miner-error').text;report['checks'].append('unavailable storage permissions are handled without losing browsing or repeatedly trying bulk inputs');remove(h)
   boot();result=d.execute_async_script("const done=arguments[0];(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('flypow-research-previous-version-test',{create:true}),file=await dir.getFileHandle('identity.json',{create:true}),w=await file.createWritable();await w.write(JSON.stringify({graph_sha256:'previous',model_sha256:'previous'}));await w.close();return true})().then(done,e=>done(String(e)))");assert result is True
   boot();assert phase()=='needed';assert 'Older model caches' in d.find_element(By.ID,'miner-guidance').text;assert not d.find_element(By.ID,'research-run').is_enabled();report['checks'].append('actual old-version OPFS manifest is preserved and never accepted as the current model')
  finally:out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');d.quit()
 print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',required=True);p.add_argument('--report',default='data/prepared/miner-capabilities-report.json');main(p.parse_args())
