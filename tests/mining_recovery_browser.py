"""Main-page recovery with real OPFS and injected quota failure.

The archive is a labelled silent synthetic fixture, never scientific work.
Uses the retained profile without loading a model, clearing data, or submitting.
"""
import argparse, hashlib, json, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile, close_test_browser
from e2e_official_download import BrowserNetwork

p=argparse.ArgumentParser();p.add_argument('--site',required=True);p.add_argument('--report',required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True)
downloads=(out.parent/'downloads').resolve();downloads.mkdir(exist_ok=True)
report={'schema':'mining-main-page-output-recovery-v1','site':a.site,'retainedProfile':True,'fixture':'Labelled silent synthetic archive; real OPFS, injected quota error; no scientific work or submission','physicalAndroid':False,'checks':[],'screenshots':[]}
def check(label):report['checks'].append(label);out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'passed':len(report['checks']),'check':label}),flush=True)
with retained_profile() as profile:
 o=webdriver.ChromeOptions();o.binary_location='/usr/bin/chromium'
 for arg in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--user-data-dir='+profile,'--window-size=1440,1050']:o.add_argument(arg)
 o.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=o);d.set_script_timeout(120);js=d.execute_script;wait=WebDriverWait(d,90,poll_frequency=.25);net=BrowserNetwork(d)
 def snap():return js('return window.flypowWorkspace?.snapshot()')
 def click():js("document.getElementById('miner-primary').click()")
 def shot(name):path=out.parent/(name+'.png');d.save_screenshot(str(path));report['screenshots'].append(str(path))
 try:
  d.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads)})
  d.get(a.site.rstrip('/')+'/mining/');wait.until(lambda _:snap() and snap()['preparation']!='checking');assert not snap()['running'] and not snap()['ready']
  js("FlyI18n.setLanguage('zh')")
  result=d.execute_async_script("""
  const v=arguments[0],done=arguments[arguments.length-1];(async()=>{
    const [{CandidateStoreV2},{retainOutput},{buildRecord},{targetRecord},{trialTask,inputs,candidateId,hash}]=await Promise.all([
      import('/assets/candidate-store-v2.mjs'),import('/assets/pending-output.mjs'),import('/assets/response-record.mjs'),import('/assets/target-response-record.mjs'),import('/assets/target-protocol-v2.mjs')]);
    const network=await(await fetch('/assets/data/target-network-v2.json',{cache:'no-store'})).json();
    const config=await(await fetch('/assets/data/research-profiles/duration256-v1-dev/config.json',{cache:'no-store'})).json();
    const round=structuredClone(v.round);round.pre.networkId=network.networkId;round.pre.authorityId=network.authorityId;
    round.roundId=await hash(new TextEncoder().encode('silent-ui-recovery-fixture:'+crypto.randomUUID()));round.goal.description='Silent synthetic recovery UI fixture; no scientific evidence';
    const input=inputs(v.goal)[0],task=await trialTask(round,input,0),store=new CandidateStoreV2(network);store.config=config;
    const meta=await store.begin(round,input,await candidateId(round.roundId,input));meta.testFixture='silent-ui-recovery-v1';await store.update(meta);
    const bytes=new Uint8Array(480),head=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode('FBRP1\\0\\0\\0'));for(const [at,n]of [[8,config.neuron_count],[12,task.targetIndex],[16,256]])head.setUint32(at,n,true);
    const bundle=await targetRecord(await buildRecord(bytes,config,task,b=>v.goal.stimulusSet.find(x=>x.bodyId===b.toString()).modelIndex),task,round);
    const r={...bundle,task,config,archive:new Blob([bytes]),responseBytes:bytes.length,resultHash:bundle.resultRoot,goalMetrics:{passed:false},temporary:crypto.randomUUID()+'.bin'};
    const staging=await(await navigator.storage.getDirectory()).getDirectoryHandle('flypow-result-staging-v1',{create:true}),f=await staging.getFileHandle(r.temporary,{create:true}),w=await f.createWritable();await w.write(bytes);await w.close();await retainOutput(r,{round,executionId:crypto.randomUUID()});
    return {candidateId:meta.candidateId,trialId:task.trialId,resultHash:r.resultHash,temporary:r.temporary,apiBase:network.apiBase};
  })().then(done,e=>done({error:e.message}));
  """,json.loads((root/'tests/vectors/target-v2.json').read_text()))
  assert 'error' not in result,result;report['fixtureId']=result['candidateId']
  # Only API traffic is blocked. Static assets, dictionaries and OPFS stay live.
  d.execute_cdp_cmd('Network.setBlockedURLs',{'urls':[result['apiBase']+'/*']});d.refresh()
  wait.until(lambda _:snap() and snap()['goalUi']['pendingOutputs']>=1);wait.until(lambda _:not snap()['actionBusy'])
  assert not snap()['running'] and not snap()['ready'];assert snap()['goalUi']['action']=='retry-save';assert d.find_element(By.ID,'miner-primary').is_enabled();assert js("return !document.getElementById('miner-stage-mining').hidden && !document.getElementById('miner-pending-outputs').hidden")
  assert js("return document.getElementById('miner-step-download').innerText.includes('下载大脑数据') && document.getElementById('miner-step-build').innerText.includes('构建大脑模型')")
  check('Refresh finds retained output at stage three; translated retry works without a model or authority')
  d.execute_async_script("""
    const id=arguments[0],done=arguments[arguments.length-1];import('/assets/candidate-store-v2.mjs').then(({CandidateStoreV2})=>{const save=CandidateStoreV2.prototype.saveTrial;CandidateStoreV2.prototype.saveTrial=async function(m,r){if(m.candidateId===id)throw new DOMException('Injected quota fault for this fixture only','QuotaExceededError');return save.call(this,m,r);};done(true);});
  """,result['candidateId'])
  click();wait.until(lambda _:js("return [...document.querySelectorAll('#miner-pending-list [data-save-error]')].some(e=>e.textContent.includes('QuotaExceededError'))"));wait.until(lambda _:not snap()['actionBusy']);assert d.find_element(By.ID,'miner-primary').is_enabled();assert not snap()['running'];shot('pending-quota-zh')
  check('Main button retries a real OPFS save path; injected failure retains output, shows exact error and remains clickable')
  js("document.querySelector('#miner-pending-list [data-export-pending=\"'+arguments[0]+'\"]').click()",result['trialId'])
  file=downloads/(result['trialId']+'.bin');wait.until(lambda _:file.is_file());assert file.stat().st_size==480;assert hashlib.sha256(file.read_bytes()).hexdigest()==result['resultHash'];check('Download remains usable after failure and matches the original archive digest')
  d.refresh();wait.until(lambda _:snap() and snap()['goalUi']['action']=='retry-save');assert js("return [...document.querySelectorAll('#miner-pending-list [data-save-error]')].some(e=>e.textContent.includes('QuotaExceededError'))")
  for language in ['zh','en']:
   js('FlyI18n.setLanguage(arguments[0])',language);d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':390,'height':1050,'deviceScaleFactor':1,'mobile':False});time.sleep(.25);assert js('return document.documentElement.scrollWidth<=innerWidth+1');assert d.find_element(By.ID,'miner-primary').is_enabled();shot('pending-refresh-'+language+'-390')
  check('Error and original output survive refresh; recovery controls fit 390px in both languages')
  click();wait.until(lambda _:snap()['goalUi']['pendingOutputs']==0 and not snap()['actionBusy']);assert not snap()['running'] and not snap()['ready'];assert js("return document.getElementById('miner-pending-outputs').hidden")
  saved=d.execute_async_script("""
    const id=arguments[0],done=arguments[arguments.length-1];(async()=>{const {CandidateStoreV2}=await import('/assets/candidate-store-v2.mjs');const network=await(await fetch('/assets/data/target-network-v2.json')).json(),store=new CandidateStoreV2(network);store.config=await(await fetch('/assets/data/research-profiles/duration256-v1-dev/config.json')).json();const meta=await store.metadata(id),bundle=await store.bundle(meta,0);return {trials:meta.trials.length,phase:meta.phase,sciencePassed:meta.sciencePassed,resultHash:bundle.resultHash,bytes:bundle.archive.size};})().then(done,e=>done({error:e.message}));
  """,result['candidateId'])
  assert saved=={'trials':1,'phase':'candidate-failed-science','sciencePassed':False,'resultHash':result['resultHash'],'bytes':480},saved;report['savedFixture']=saved;check('Successful recovery reads the same committed bytes, unlocks preparation and starts no CPU or submission')
  assert len(net.requests)==0;report['officialDownload']={'officialRequests':len(net.requests),'officialReceivedBytes':net.data_received_bytes};report['passed']=True
 finally:
  report['browserErrors']=[r['message'][:300] for r in d.get_log('browser') if r['level']=='SEVERE' and 'ERR_BLOCKED_BY_CLIENT' not in r['message']];out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');close_test_browser(d)
