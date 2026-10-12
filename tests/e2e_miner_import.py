#!/usr/bin/env python3
"""Actual ordinary multi-file import, checked-block recovery and complete official build."""
import argparse,json,tempfile,time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from e2e_official_download import observe_preparation, assert_single_input_checks

def main(a):
 out=Path(a.report).parent;report={'schema':'flypow-miner-import-e2e-v1','checks':[],'input_mode':'actual official local import; window capability probe denial is injected to test the manual fallback; no project proxy or mirror'}
 with tempfile.TemporaryDirectory(prefix='miner-import-',dir=out) as profile:
  o=webdriver.ChromeOptions();o.binary_location='/usr/bin/chromium'
  for flag in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--window-size=1440,1000','--user-data-dir='+profile]:o.add_argument(flag)
  o.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=o);d.set_script_timeout(90);observe_preparation(d);w=WebDriverWait(d,1200)
  def phase():return d.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-preparation')
  def text(id):return d.find_element(By.ID,id).get_attribute('textContent')
  def click(id):w.until(lambda b:b.find_element(By.ID,id).is_enabled());d.execute_script('arguments[0].click()',d.find_element(By.ID,id))
  def js(script):
   r=d.execute_async_script('const done=arguments[0];(async()=>{'+script+'})().then(done,e=>done({error:String(e)}))')
   if isinstance(r,dict) and 'error' in r:raise AssertionError(r['error'])
   return r
  def inputdir(script):return js("const m=await(await fetch('/assets/data/official-inputs.json')).json(),r=await navigator.storage.getDirectory();let dir;try{dir=await r.getDirectoryHandle(`flypow-inputs-${m.builder}-${m.registry_sha256.slice(0,16)}`);}catch{return null;}"+script)
  try:
   d.get(a.url.rstrip('/')+'/mining/');w.until(lambda b:b.find_element(By.ID,'miner-primary').is_enabled());d.execute_script("const realFetch=window.fetch.bind(window);window.fetch=(url,options)=>String(url).startsWith('https://storage.googleapis.com/')?Promise.reject(new TypeError('Injected official-read denial')):realFetch(url,options)");click('miner-primary');w.until(lambda b:phase()=='files')
   d.find_element(By.ID,'miner-files').send_keys('\n'.join(str(p.resolve()) for p in [a.annotation,a.weights,a.annotation]));w.until(lambda b:'Duplicate file' in text('miner-import-status'));assert text('miner-import-status').count('Selected · awaiting final check')==2
   assert not d.execute_script('return flypowPreparationTrace')
   report['checks'].append('same multi-file entrance selects annotations and weights by size without hashing them, catches duplicate and leaves transmitter missing');print('Actual multi-file selection passed',flush=True)
   wrong=Path(profile)/'same-size-damaged-annotation.feather';data=bytearray(a.annotation.read_bytes());data[10]^=1;wrong.write_bytes(data);del data
   # Selenium appends to a multiple-file input; explicitly replace its previous
   # selection so the intentionally wrong file is selected, not a duplicate.
   d.execute_script('document.getElementById("miner-files").value=""')
   d.find_element(By.ID,'miner-files').send_keys('\n'.join(str(p.resolve()) for p in [wrong,a.transmitter]));w.until(lambda b:'Selected · awaiting final check' in text('miner-import-status'));click('miner-primary')
   def checkpoint():return inputdir("try{const f=await dir.getFileHandle('weights-chunks.json');return JSON.parse(await(await f.getFile()).text());}catch{return null;}")
   w.until(lambda b:(checkpoint() or {}).get('chunks'));click('miner-prepare-pause');w.until(lambda b:phase()=='paused');p=checkpoint();assert len(p['chunks'])>0;report['saved_blocks_before_pause']=len(p['chunks']);report['checks'].append('pause during actual official staging retains checked input blocks, not an execution checkpoint')
   assert not any(m['label'].startswith('Checking ') for m in d.execute_script('return flypowPreparationTrace'))
   # Damage one actual checkpointed block, preserving its metadata. Only bad bytes must be reimported.
   inputdir("const h=await dir.getFileHandle('weights.feather'),f=await h.getFile(),v=new Uint8Array(await f.slice(10,11).arrayBuffer())[0],w=await h.createWritable({keepExistingData:true});await w.write({type:'write',position:10,data:new Uint8Array([v^1])});await w.close();return true;")
   click('miner-primary');w.until(lambda b:phase() in ['ready','error','space']);assert phase()=='error' and 'SHA-256 mismatch: annotation' in text('miner-error-detail'),text('miner-error-detail')
   assert not d.find_element(By.ID,'research-run').is_enabled()
   removed=inputdir("try{await dir.getFileHandle('annotation-chunks.json');return false;}catch(e){return e.name==='NotFoundError';}");assert removed
   rejected=d.execute_script('return flypowPreparationTrace');assert sum(m['label']=='Checking annotation' and m['loaded']==0 for m in rejected)==1;assert not any(m['label']=='Checked annotation' for m in rejected)
   report['checks'].append('same-size damaged import is rejected by the single final check, never becomes ready, and its bad checkpoint is removed for retry')
   d.execute_script('window.flypowPreparationTrace=[]')
   d.execute_script('document.getElementById("miner-files").value=""')
   d.find_element(By.ID,'miner-files').send_keys(str(a.annotation.resolve()));w.until(lambda b:phase()=='files')
   started=time.monotonic();click('miner-primary');w.until(lambda b:phase() in ['ready','error','space']);assert phase()=='ready',text('miner-error-detail');report['build_seconds']=round(time.monotonic()-started,3)
   report['checks'].append('correct-file retry replaces the bad input and reuses other staged blocks instead of becoming stuck on their self-consistent hashes')
   p2=checkpoint();assert p2['chunks'][0]['sha256']==p['chunks'][0]['sha256'];assert p2['complete'];memory=d.execute_script('return window.flypowLastMemoryReport');assert memory['wasm_bytes']>200000000;report['checks'].append('damaged staged block is repaired from the selected official source; full official build matches frozen graph/model hashes');report['worker_memory_report']=memory;print('Actual full official model built in the ordinary wizard',flush=True)
   report['input_validation']=assert_single_input_checks(d.execute_script('return flypowPreparationTrace'));report['checks'].append('all sources are staged before exactly one full content check per source; manual selection and downloading do not add another pass')
   click('miner-primary');w.until(lambda b:b.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-execution')=='complete');assert '6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0' in text('research-result-hash');report['checks'].append('wizard-built actual full model executes the unchanged native golden default task')
   d.refresh();w.until(lambda b:b.find_element(By.ID,'miner-primary').is_enabled());assert phase()=='needed';click('miner-primary');w.until(lambda b:phase()=='ready');report['checks'].append('return uses the complete versioned cache without unsolicited recomputation')
  finally:
   try:report['last_phase']=phase();report['last_error']=text('miner-error-detail')
   except Exception:pass
   Path(a.report).write_text(json.dumps(report,indent=2)+'\n');d.quit()
 print(json.dumps(report,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',required=True)
 for k in ['annotation','weights','transmitter']:p.add_argument('--'+k,type=Path,required=True)
 p.add_argument('--report',default='data/prepared/miner-import-report.json');main(p.parse_args())
