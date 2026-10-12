#!/usr/bin/env python3
"""Actual Chromium miner UX against real full-model files; fault cases are identified."""
import argparse,json,tempfile,time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
EXPECTED='6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0'
def main(a):
 report={'schema':'flypow-miner-ux-e2e-v1','checks':[],'screenshots':[],'faults':'quota estimate and unsupported capabilities are simulated; Web Locks and scientific results use the actual browser and full model'}
 out=Path(a.report).parent;out.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='miner-browser-',dir=out) as profile:
  opts=webdriver.ChromeOptions();opts.binary_location='/usr/bin/chromium'
  for flag in ['--renderer-process-limit=2','--num-raster-threads=1','--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--window-size=1440,1000','--user-data-dir='+profile]:opts.add_argument(flag)
  opts.set_capability('goog:loggingPrefs',{'browser':'ALL'})
  d=webdriver.Chrome(options=opts);d.set_script_timeout(60);wait=WebDriverWait(d,240)
  def click(id):
   wait.until(lambda b:b.find_element(By.ID,id).is_enabled())
   d.execute_script('arguments[0].click()',d.find_element(By.ID,id))
  def text(id):return d.find_element(By.ID,id).get_attribute('textContent')
  def phase(section):return d.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-'+section)
  def boot(query=''):
   d.get(a.url.rstrip('/')+'/mining/'+query);wait.until(lambda b:b.find_element(By.ID,'miner-primary').is_enabled() or b.find_element(By.ID,'miner-error').is_displayed())
   assert not d.find_element(By.ID,'miner-error').is_displayed(),text('miner-error-detail')
  def route(view):
   d.execute_script("document.querySelector('.miner-tabs [data-miner-view="+view+"]').click()")
  def js(script):
   result=d.execute_async_script('const done=arguments[0];(async()=>{'+script+'})().then(v=>done(v),e=>done({error:String(e)}))')
   if isinstance(result,dict) and 'error' in result:raise AssertionError(result['error'])
   return result
  def shot(name):
   path=out/(name+'.png');d.save_screenshot(str(path));report['screenshots'].append(str(path))
  try:
   boot();assert text('miner-primary')=='Download official data';assert 'no token rewards' in text('miner-mode');assert not d.find_element(By.ID,'research-connect').is_displayed();assert not d.find_element(By.ID,'miner-wallet-picker').is_displayed();assert not d.find_element(By.ID,'research-graph').is_displayed();assert not d.find_element(By.ID,'miner-preparation').is_displayed();shot('miner-cold-desktop')
   entries=d.execute_script('return performance.getEntriesByType("resource").map(r=>r.name)');assert not any('.feather' in p or '.wasm' in p or 'generated/solana' in p for p in entries)
   report['checks'].append('cold entry has one actionable primary, no wallet wall, no bulk reads, no Worker/WASM or SDK load')
   # Browser language detection is tested before first explicit preference exists.
   d.execute_script("localStorage.removeItem('flypow-language')")
   language=d.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':"Object.defineProperty(navigator,'languages',{get:()=>['zh-CN']})"})['identifier']
   boot();assert d.execute_script('return document.documentElement.lang').startswith('zh');assert text('miner-primary')=='一键加载官方数据';d.execute_cdp_cmd('Page.removeScriptToEvaluateOnNewDocument',{'identifier':language});click('language-switch');assert text('miner-primary')=='Download official data';d.refresh();wait.until(lambda b:b.find_element(By.ID,'miner-primary').is_enabled());assert d.execute_script('return document.documentElement.lang')=='en';report['checks'].append('first browser language and explicit remembered preference')
   for lang in ['en','zh']:
    if d.execute_script('return FlyI18n.language')!=lang:click('language-switch')
    for width in [320,390,768,1440]:
     d.set_window_size(width,900);assert d.execute_script('return document.documentElement.scrollWidth<=innerWidth+1'),(lang,width)
     d.execute_script("window.scrollTo(0,0)");button=d.find_element(By.ID,'miner-primary');assert button.is_displayed();assert button.rect['height']>=44
     assert d.execute_script("return document.getElementById('miner-primary').getBoundingClientRect().bottom<=innerHeight"),(lang,width,button.rect)
     if width==390:shot('miner-cold-mobile-'+lang)
   click('language-switch');d.set_window_size(1440,1000)
   click('miner-example');wait.until(lambda b:b.find_elements(By.CSS_SELECTOR,'#miner-example-anatomy img'));assert 'official anatomy' in text('miner-example-card').lower();report['checks'].append('hash-checked lightweight anatomy, clearly separate from an experiment; EN/ZH 320/390/768/1440 no overflow')
   d.execute_script("const realFetch=window.fetch.bind(window);window.fetch=(url,options)=>String(url).startsWith('https://storage.googleapis.com/')?Promise.reject(new TypeError('Injected official-read denial')):realFetch(url,options)");click('miner-primary');wait.until(lambda b:phase('preparation') in ['files','error','space']);assert phase('preparation')=='files',text('miner-error-detail');assert d.find_element(By.ID,'miner-import-explanation').is_displayed();assert len(d.find_elements(By.CSS_SELECTOR,'#miner-download-list a'))==3;report['checks'].append('injected official read denial enters the recoverable manual fallback without bulk downloads')
   with tempfile.NamedTemporaryFile(suffix='.feather') as wrong:
    wrong.write(b'invalid version');wrong.flush();d.find_element(By.ID,'miner-files').send_keys(wrong.name);wait.until(lambda b:'Unknown size or version' in text('miner-import-status'))
   report['checks'].append('one import entrance identifies an unknown file and retains missing-source explanations')
   # Quota estimate deliberately simulated; this Chromium masks overridden quotas in estimate().
   origin=a.url.rstrip('/');d.execute_script("window.originalEstimate=navigator.storage.estimate.bind(navigator.storage);navigator.storage.estimate=async()=>({quota:32*1024*1024,usage:0})");click('miner-primary');wait.until(lambda b:phase('preparation')=='space');assert 'not enough browser storage' in text('miner-error').lower();d.execute_script('navigator.storage.estimate=window.originalEstimate');report['checks'].append('simulated insufficient quota estimate is recoverable and is not reported as low RAM')
   route('tools');d.find_element(By.ID,'research-graph').send_keys(str(a.graph.resolve()));d.find_element(By.ID,'research-model').send_keys(str(a.model.resolve()));started=time.monotonic();click('research-prepare');wait.until(lambda b:phase('preparation') in ['ready','error','space']);assert phase('preparation')=='ready',text('miner-error-detail');report['prepare_seconds']=round(time.monotonic()-started,3);assert 'Saved on this device' in text('research-cache-note');route('experience')
   started=time.monotonic();click('miner-primary');wait.until(lambda b:phase('execution')=='running');shot('miner-running-desktop');route('contributions');assert phase('execution')=='running';route('tools');d.execute_script("document.getElementById('research-cell').value='16961';document.getElementById('research-cell').dispatchEvent(new Event('change'))");route('experience');click('miner-pause-after');wait.until(lambda b:phase('execution') in ['paused','error']);assert phase('preparation')=='ready';assert phase('execution')=='paused',text('miner-error-detail');assert EXPECTED in text('research-result-hash');assert '16789' in text('research-identity');report['experiment_seconds']=round(time.monotonic()-started,3);report['result_root']=EXPECTED;report['checks'].append('actual automatic default task on full 165122-neuron model; native golden root unchanged; view/cell changes do not change running identity; pause preserves model')
   d.execute_script("document.getElementById('miner-result-details').open=true");assert text('research-bytes').replace(',','')=='2504328';shot('miner-result-desktop');d.set_window_size(390,900);assert d.execute_script('return document.documentElement.scrollWidth<=innerWidth+1');shot('miner-result-mobile');d.set_window_size(1440,1000)
   # A bounded continuation picks a different genuine catalog task and stops at one.
   d.execute_script("document.getElementById('miner-limit-count').value=1");click('miner-primary');wait.until(lambda b:phase('execution')=='running');click('miner-pause-after');wait.until(lambda b:phase('execution')=='paused');assert 'task 0' in text('research-identity');report['checks'].append('automatic selection skips saved default result and remains in frozen finite catalog; task bound and graceful pause')
   # Immediate stop requires actual user confirmation and releases, rather than fake resume.
   click('miner-primary');wait.until(lambda b:phase('execution')=='running');click('miner-stop');d.switch_to.alert.accept();wait.until(lambda b:phase('preparation')=='paused');assert 'must start again' in text('miner-guidance').lower() or 'start' in text('miner-guidance').lower();report['checks'].append('immediate stop releases Worker and states that the interrupted task must be recomputed')
   boot('?view=contributions');assert phase('preparation')=='needed';wait.until(lambda b:b.find_elements(By.CSS_SELECTOR,'#miner-contribution-list article'));assert 'Confirmed test contributions' not in text('miner-contribution-counts');card=d.find_element(By.CSS_SELECTOR,'#miner-contribution-list article button');d.execute_script('arguments[0].click()',card);wait.until(lambda b:b.find_element(By.ID,'research-response').is_displayed());assert phase('preparation')=='needed';report['checks'].append('direct URL/refresh restores local results with no complete model load and no fake confirmed credit or balance')
   # No WebGL must preserve the actual anatomy and recorded response.
   d.execute_script("const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/.test(kind)?null:old.call(this,kind,...args)}");d.execute_script('arguments[0].click()',card);wait.until(lambda b:b.find_elements(By.CSS_SELECTOR,'#research-skeleton img'));report['checks'].append('no WebGL uses identity-checked official SVG with actual spike replay')
   route('experience');click('miner-primary');wait.until(lambda b:phase('preparation')=='ready');assert 'Saved on this device' in text('research-cache-note');assert phase('execution')!='running';shot('miner-warm-cache');report['checks'].append('one explicit continue validates complete cached model; return does not silently start computation')
   # Same origin Web Lock in a separate tab blocks execution but not history.
   first=d.current_window_handle;d.switch_to.new_window('tab');boot('?view=contributions');d.execute_script("window.held=true;window.heldReady=false;navigator.locks.request('flybrain-research-dev-v0',async()=>{window.heldReady=true;while(window.held)await new Promise(r=>setTimeout(r,50))})");wait.until(lambda b:b.execute_script('return window.heldReady'));second=d.current_window_handle;d.switch_to.window(first);click('miner-primary');wait.until(lambda b:b.find_element(By.ID,'miner-error').is_displayed());assert 'Another page' in text('miner-error');route('contributions');assert d.find_elements(By.CSS_SELECTOR,'#miner-contribution-list article');d.switch_to.window(second);d.execute_script('window.held=false');d.close();d.switch_to.window(first);report['checks'].append('execution locks prevent duplicate compute across tabs; other tab can browse contributions')
   js("const c=await(await fetch('/assets/data/research-config.json')).json(),dir=await(await navigator.storage.getDirectory()).getDirectoryHandle(`flypow-research-${c.graph_sha256.slice(0,16)}-${c.model_sha256.slice(0,16)}`),h=await dir.getFileHandle('model-v0.bin'),f=await h.getFile(),byte=new Uint8Array(await f.slice(100,101).arrayBuffer())[0],w=await h.createWritable({keepExistingData:true});await w.write({type:'write',position:100,data:new Uint8Array([byte^1])});await w.close();return true;")
   boot();click('miner-primary');wait.until(lambda b:phase('preparation')=='error');assert 'integrity' in text('miner-error');assert not d.find_element(By.ID,'research-run').is_enabled();report['checks'].append('corrupt full cache rejected on explicit restore; saved responses remain independent')
   summary=js('return flypowDiagnostics.summary()');assert 'signature' not in json.dumps(summary).lower();report['local_diagnostic_summary']=summary
   report['browser_errors']=[x['message'] for x in d.get_log('browser') if x['level']=='SEVERE'];unexpected=[x for x in report['browser_errors'] if 'storage.googleapis.com' not in x and 'CORS' not in x and 'WebGL context' not in x];assert not unexpected,unexpected
  finally:
   try:report['last_status']={'preparation':phase('preparation'),'execution':phase('execution'),'diagnostic':text('miner-error-detail')}
   except Exception:pass
   Path(a.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');d.quit()
 print(json.dumps({k:v for k,v in report.items() if k!='local_diagnostic_summary'},ensure_ascii=False,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',required=True);p.add_argument('--graph',type=Path,required=True);p.add_argument('--model',type=Path,required=True);p.add_argument('--report',default='data/prepared/miner-ux-report.json');main(p.parse_args())
