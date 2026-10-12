#!/usr/bin/env python3
"""Real official downloads in Chromium, with explicit fault injection and OPFS.

--smoke tests the real annotation transfer/cache/repair in a local-only worker
fixture. The default tests the production miner wizard downloading all three
official files, building/running the complete frozen model and offline reuse.
"""
import argparse
import base64
import json
from pathlib import Path
import tempfile
import threading
import time
from urllib.request import build_opener, ProxyHandler

import trio
from trio_websocket import open_websocket_url

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

GOLDEN='6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0'
OFFICIAL='https://storage.googleapis.com/'

def observe_preparation(driver):
    """Observe actual production Worker messages without changing its work."""
    driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':r"""
      window.flypowPreparationTrace=[];
      const OriginalWorker=window.Worker;
      window.Worker=class extends OriginalWorker {
        constructor(url,options){
          super(url,options);
          if(String(url).includes('/assets/research-worker.mjs'))this.addEventListener('message',({data:m})=>{
            if(m.type==='progress'&&/^(Checking|Checked|Staged) /.test(m.label))
              flypowPreparationTrace.push({label:m.label,loaded:m.loaded,total:m.total,sourceId:m.sourceId,sourceStage:m.sourceStage});
          });
        }
      };
    """})

def assert_single_input_checks(trace,sources=('annotation','weights','transmitter')):
    """Each actual whole-file pass starts/ends once, after ALL inputs are staged."""
    checks={}
    first=next(i for i,m in enumerate(trace) if m['label'].startswith('Checking '))
    assert {m['label'].removeprefix('Staged ') for m in trace[:first] if m['label'].startswith('Staged ')}==set(sources),trace
    for source in sources:
        reads=[m for m in trace if m['label']=='Checking '+source]
        starts=sum(m['loaded']==0 for m in reads);ends=sum(m['loaded']==m['total'] for m in reads)
        accepted=sum(m['label']=='Checked '+source for m in trace)
        assert (starts,ends,accepted)==(1,1,1),(source,starts,ends,accepted)
        assert all(m.get('sourceId')==source and m.get('sourceStage')=='checking' for m in reads)
        checks[source]={'full_scan_starts':starts,'full_scan_completions':ends,'accepted':accepted,'bytes':reads[-1]['total']}
    return checks

class BrowserNetwork:
    """Observe page AND dedicated Worker traffic; page performance logs omit it."""
    def __init__(self,driver,staged_network=None,staged_origin=None):
        self.requests=[];self.responses=[];self.writes=[];self.errors=[];self.ready=threading.Event();self.stop=threading.Event();self.block_official=False;self.official_ids=set();self.data_received_bytes=0;self.encoded_received_bytes=0
        self.staged_network=staged_network;self.staged_origin=staged_origin;self.staged_requests=[];self.target_types={}
        if staged_network is not None:
            if not staged_origin or staged_network.get('developmentOnly') is not True or staged_network.get('enabled') is not True or any(staged_network.get(k) is not False for k in ['payment','rewards','requiredWallet']):raise ValueError('Only pinned development configuration may be staged')
        address=driver.capabilities['goog:chromeOptions']['debuggerAddress']
        with build_opener(ProxyHandler({})).open('http://'+address+'/json/version',timeout=5) as r:self.url=json.load(r)['webSocketDebuggerUrl']
        self.thread=threading.Thread(target=lambda:trio.run(self.run),daemon=True);self.thread.start()
        if not self.ready.wait(10):raise RuntimeError('Worker network observer did not start: '+str(self.errors))
    async def run(self):
        try:
            async with open_websocket_url(self.url) as socket:
                ident=0
                async def send(method,params=None,session=None):
                    nonlocal ident
                    ident+=1;m={'id':ident,'method':method,'params':params or {}}
                    if session:m['sessionId']=session
                    await socket.send_message(json.dumps(m))
                attach={'autoAttach':True,'waitForDebuggerOnStart':True,'flatten':True}
                await send('Target.setAutoAttach',attach)
                while not self.stop.is_set():
                    m=None
                    with trio.move_on_after(.3):
                        m=json.loads(await socket.get_message())
                    # Only the receive can time out. Cancelling an in-flight CDP
                    # send can close the observer after a busy Worker session,
                    # leaving the next navigation without staged configuration.
                    if m is not None:
                        p=m.get('params',{})
                        if m.get('method')=='Target.attachedToTarget':
                            # Observations only need method/URL/counters. Omitting
                            # multi-MiB archive request bodies keeps the CDP socket
                            # below its message limit during actual uploads.
                            session=p['sessionId'];await send('Network.enable',{'maxPostDataSize':1},session=session)
                            self.target_types[session]=p['targetInfo']['type']
                            if self.staged_network is not None:await send('Fetch.enable',{'patterns':[{'urlPattern':self.staged_origin.rstrip('/')+'/assets/data/target-network-v2.json*','requestStage':'Request'}]},session)
                            if self.block_official:await send('Network.setBlockedURLs',{'urls':[OFFICIAL+'*']},session)
                            await send('Target.setAutoAttach',attach,session);await send('Runtime.runIfWaitingForDebugger',session=session)
                            if p['targetInfo']['type']=='page':self.ready.set()
                        elif m.get('method')=='Fetch.requestPaused':
                            session=m.get('sessionId');request=p['request']
                            if self.staged_network is not None and request['method']=='GET' and request['url'].split('?',1)[0]==self.staged_origin.rstrip('/')+'/assets/data/target-network-v2.json':
                                self.staged_requests.append({'targetType':self.target_types.get(session),'url':request['url']})
                                await send('Fetch.fulfillRequest',{'requestId':p['requestId'],'responseCode':200,'responseHeaders':[{'name':'Content-Type','value':'application/json'},{'name':'Cache-Control','value':'no-store'}],'body':base64.b64encode(json.dumps(self.staged_network).encode()).decode()},session)
                            else:await send('Fetch.continueRequest',{'requestId':p['requestId']},session)
                        elif m.get('method')=='Network.requestWillBeSent':
                            r=p['request']
                            if r['url'].startswith(OFFICIAL):self.official_ids.add((m.get('sessionId'),p['requestId']));self.requests.append({'url':r['url'],'range':r['headers'].get('Range',r['headers'].get('range')),'method':r['method']})
                            if r['method'] in ['POST','PUT','PATCH','DELETE']:self.writes.append(r['method'])
                        elif m.get('method')=='Network.dataReceived' and (m.get('sessionId'),p['requestId']) in self.official_ids:
                            self.data_received_bytes+=p.get('dataLength',0)
                        elif m.get('method')=='Network.loadingFinished' and (m.get('sessionId'),p['requestId']) in self.official_ids:
                            self.encoded_received_bytes+=p.get('encodedDataLength',0)
                        elif m.get('method')=='Network.responseReceived' and p['response']['url'].startswith(OFFICIAL):
                            r=p['response'];h={k.lower():v for k,v in r['headers'].items()};self.responses.append({'url':r['url'],'status':r['status'],'content_range':h.get('content-range'),'cors':h.get('access-control-allow-origin')})
        except Exception as e:
            if not self.stop.is_set():self.errors.append(type(e).__name__+': '+repr(e))
    def close(self):self.stop.set();self.thread.join(timeout=3)

def main(a):
    out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'flypow-official-download-e2e-v1','url':a.url,'checks':[],
            'faults':'window read denial and cached byte corruption are injected; transfers, OPFS, complete model and execution are real',
            'mode':'annotation transfer smoke' if a.smoke else 'all official files and full model'}
    requests=[];responses=[];last_poll=0
    with tempfile.TemporaryDirectory(prefix='official-browser-',dir=out.parent) as profile:
        options=webdriver.ChromeOptions();options.binary_location='/usr/bin/chromium'
        for f in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--renderer-process-limit=2','--window-size=1440,1000','--user-data-dir='+profile]:options.add_argument(f)
        options.set_capability('goog:loggingPrefs',{'browser':'ALL','performance':'ALL'})
        d=webdriver.Chrome(options=options);d.set_script_timeout(90);observe_preparation(d);network=BrowserNetwork(d)
        wait=WebDriverWait(d,1800,poll_frequency=1)
        def phase():return d.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-preparation')
        def text(i):return d.find_element(By.ID,i).get_attribute('textContent')
        def js(s):
            r=d.execute_async_script('const done=arguments[0];(async()=>{'+s+'})().then(done,e=>done({error:String(e)}))')
            if isinstance(r,dict) and 'error' in r:raise AssertionError(r['error'])
            return r
        def click(i):
            wait.until(lambda b:b.find_element(By.ID,i).is_enabled())
            d.execute_script('arguments[0].click()',d.find_element(By.ID,i))
        def capture(name):d.save_screenshot(str(out.parent/(name+'.png')))
        def drain():
            requests[:]=network.requests;responses[:]=network.responses
            assert not network.writes,network.writes
            assert not network.errors,network.errors
        def boot():
            d.get(a.url.rstrip('/')+'/mining/');wait.until(lambda b:b.find_element(By.ID,'miner-primary').is_enabled())
        def inputjs(s):
            return js("const m=await(await fetch('/assets/data/official-inputs.json')).json(),root=await navigator.storage.getDirectory();let dir;try{dir=await root.getDirectoryHandle(`flypow-inputs-${m.builder}-${m.registry_sha256.slice(0,16)}`);}catch{return null;}"+s)
        def checkpoint():
            return inputjs("try{return JSON.parse(await(await(await dir.getFileHandle('weights-chunks.json')).getFile()).text())}catch{return null}")
        def prepare_done(b):
            nonlocal last_poll
            drain();p=phase()
            if time.monotonic()-last_poll>25:
                print(json.dumps({'preparation':p,'detail':text('research-detail'),'source_requests':len(requests)}),flush=True);last_poll=time.monotonic()
            return p in ['ready','error','space','files']
        try:
            boot();assert phase()=='needed';drain();assert not requests
            assert not any('.wasm' in r for r in d.execute_script('return performance.getEntriesByType("resource").map(r=>r.name)'))
            report['checks'].append('cold entry performs no official download or heavy computation before a click')
            for lang in ['en','zh']:
                d.execute_script('FlyI18n.setLanguage(arguments[0])',lang)
                for width in [320,390,768,1440]:
                    d.set_window_size(width,900);d.execute_script('window.scrollTo(0,0)')
                    assert d.execute_script('return document.documentElement.scrollWidth<=innerWidth+1')
                    assert d.execute_script('return document.getElementById("miner-primary").getBoundingClientRect().bottom<=innerHeight')
                if lang=='zh':capture('official-download-cold-mobile-zh')
            d.execute_script('FlyI18n.setLanguage("en")');d.set_window_size(1440,1000)
            report['checks'].append('explicit one-click action and EN/ZH first-fold layouts at 320/390/768/1440')
            d.execute_script("window.savedFetch=window.fetch.bind(window);window.fetch=(url,opt)=>String(url).startsWith('https://storage.googleapis.com/')?Promise.reject(new TypeError('Injected read denial')):savedFetch(url,opt)")
            click('miner-primary');wait.until(lambda b:phase()=='files')
            assert d.find_element(By.ID,'miner-import-fallback').get_attribute('open') is not None
            assert d.find_element(By.ID,'miner-files').is_displayed();drain();assert not requests
            report['checks'].append('injected official read denial offers manual fallback; no opaque/no-cors or proxy success is claimed')
            d.execute_script('window.fetch=window.savedFetch')
            d.execute_script("window.fetch=(url,opt)=>String(url).startsWith('https://storage.googleapis.com/')?new Promise((resolve,reject)=>opt.signal.addEventListener('abort',()=>reject(new DOMException('Paused during readability check','AbortError')),{once:true})):savedFetch(url,opt)")
            click('miner-primary');wait.until(lambda b:phase()=='fetching');click('miner-prepare-pause')
            wait.until(lambda b:phase()=='paused' and b.find_element(By.ID,'miner-primary').is_enabled())
            assert phase()=='paused';d.execute_script('window.fetch=window.savedFetch')
            report['checks'].append('pause during an outstanding readability check remains paused after asynchronous cancellation; a later explicit attempt can retry')
            if a.smoke:
                # Test fixture exists ONLY in the local --no-atlas test export.
                assert a.url.startswith('http://127.0.0.1:')
                def stage(mode):
                    result=js("const m=await(await fetch('/assets/data/official-inputs.json')).json();return new Promise((resolve,reject)=>{const w=new Worker('/assets/test-download-worker.mjs',{type:'module'});w.onmessage=({data})=>{w.terminate();resolve(data)};w.onerror=e=>{w.terminate();reject(new Error(e.message))};w.postMessage({source:m.sources[0],manifest:m,mode:"+json.dumps(mode)+"})})")
                    time.sleep(.2);drain();return result
                r=stage('download');assert r['ok'] and r['bytes']==14483314 and r['complete'] and r['fullScans']==1;assert r['stages'].count('Downloading annotation')
                before=len(requests);r=stage('reuse');assert r['ok'] and len(requests)==before and r['fullScans']==1
                report['checks'].append('real 14,483,314-byte official annotation download and full SHA verification; a second read uses OPFS with zero requests')
                before=len(requests);r=stage('damage');assert r['ok'] and r['fullScans']==1 and len(requests)==before+1 and requests[-1]['range']=='bytes=0-4194303'
                report['checks'].append('a deliberately damaged checked block is repaired by exactly one official 4 MiB Range request')
                r=stage('wrong-range');assert not r['ok'] and 'identity mismatch' in r['detail']
                report['checks'].append('injected incorrect Content-Range is rejected before accepting bytes')
                report['source_bytes']=14483314
            else:
                started=time.monotonic();click('miner-primary')
                wait.until(lambda b:len((checkpoint() or {}).get('chunks',[]))>=3)
                assert phase() in ['fetching','checking-files'];assert len(d.find_elements(By.CSS_SELECTOR,'#miner-download-list progress'))==3
                capture('official-downloading-desktop');d.set_window_size(390,900);d.execute_script('FlyI18n.setLanguage("zh")')
                assert d.execute_script('return document.documentElement.scrollWidth<=innerWidth+1');capture('official-downloading-mobile-zh')
                d.execute_script('FlyI18n.setLanguage("en")');d.set_window_size(1440,1000)
                click('miner-prepare-pause');wait.until(lambda b:phase()=='paused');saved=checkpoint();assert saved['chunks'];drain()
                trace=d.execute_script('return flypowPreparationTrace');assert not any(m['label'].startswith('Checking ') for m in trace),trace
                report['checks'].append('no full-file validation occurs between individual downloads or during an incomplete preparation')
                report['checked_blocks_before_pause']=len(saved['chunks'])
                # Corrupt one checkpoint; other persisted blocks must not be fetched again.
                inputjs("const h=await dir.getFileHandle('weights.feather'),f=await h.getFile(),byte=new Uint8Array(await f.slice(10,11).arrayBuffer())[0],w=await h.createWritable({keepExistingData:true});await w.write({type:'write',position:10,data:new Uint8Array([byte^1])});await w.close();return true")
                report['checks'].append('actual streaming download shows per-file progress; pause preserves checked blocks without pretending the in-flight block is saved')
                boot();assert phase()=='needed';assert 'Continue preparation' in text('miner-primary');drain();resume_request=len(requests)
                click('miner-primary');wait.until(prepare_done);assert phase()=='ready',text('miner-error-detail')
                report['preparation_workflow_seconds']=round(time.monotonic()-started,3)
                repaired=checkpoint();assert repaired['complete'] and repaired['chunks'][0]['sha256']==saved['chunks'][0]['sha256']
                weight_requests=[r for r in requests[resume_request:] if 'connectome-weights' in r['url']]
                assert any(r['range']=='bytes=0-4194303' for r in weight_requests)
                assert not any(r['range']=='bytes=4194304-8388607' for r in weight_requests)
                report['checks'].append('refresh resumes official loading; refetches the damaged first block and skips the intact second block')
                cached=inputjs("return await Promise.all(m.sources.map(async s=>{const meta=JSON.parse(await(await(await dir.getFileHandle(s.id+'-chunks.json')).getFile()).text()),f=await(await dir.getFileHandle(s.id+'.feather')).getFile();return {id:s.id,bytes:f.size,sha256:meta.sha256,complete:meta.complete}}))")
                assert all(s['complete'] for s in cached);report['inputs']=cached;report['official_input_bytes']=sum(s['bytes'] for s in cached)
                assert report['official_input_bytes']==1109008094
                report['input_validation']=assert_single_input_checks(d.execute_script('return flypowPreparationTrace'))
                report['checks'].append('all inputs are staged first; actual production Worker performs exactly one complete SHA pass per file before model construction')
                assert 'Saved on this device' in text('research-cache-note');capture('official-model-cached-desktop')
                report['checks'].append('all three official objects and exact full-model hashes are checked and automatically saved; no file picker is used')
                run=time.monotonic();click('miner-primary');wait.until(lambda b:b.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-execution') in ['complete','error'])
                assert GOLDEN in text('research-result-hash'),text('miner-error-detail')
                report['experiment_to_result_seconds']=round(time.monotonic()-run,3);report['result_root']=GOLDEN
                memory=d.execute_script('return window.flypowLastMemoryReport');report['worker_memory_report']=memory
                report['checks'].append('officially downloaded full model executes unchanged default task 124 with native golden response root')
                drain();before=len(requests);network.block_official=True;d.execute_cdp_cmd('Network.setBlockedURLs',{'urls':[OFFICIAL+'*']})
                boot();assert text('miner-primary')=='Use saved model';assert phase()=='needed'
                restore=time.monotonic();click('miner-primary');wait.until(prepare_done);assert phase()=='ready',text('miner-error-detail');drain();assert len(requests)==before
                assert d.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-execution')!='running'
                assert not any(m['label'].startswith('Checking ') for m in d.execute_script('return flypowPreparationTrace'))
                report['cache_restore_seconds']=round(time.monotonic()-restore,3);capture('official-return-cached-desktop')
                report['checks'].append('return verifies and uses the full model with official network blocked, zero official requests and no automatic recomputation')
            drain()
            assert all(r['url'].startswith(OFFICIAL+'download/storage/v1/b/flyem-male-cns/o/') for r in requests)
            report['official_requests']=requests;report['official_responses']=responses
            errors=[x['message'] for x in d.get_log('browser') if x['level']=='SEVERE'];assert not errors,errors
            report['severe_browser_errors']=errors;report['network_writes']=0
            report['checks'].append('only the same official GCS download API is used; zero upload/write requests and severe browser errors')
            report['success']=True
        finally:
            try:report['last_phase']=phase();report['last_detail']=text('miner-error-detail');drain()
            except Exception:pass
            report['official_requests']=list(requests);report['official_responses']=list(responses)
            out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');network.close();d.quit()
    print(json.dumps({k:v for k,v in report.items() if k not in ['official_requests','official_responses']},ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',required=True);p.add_argument('--report',required=True);p.add_argument('--smoke',action='store_true');main(p.parse_args())
