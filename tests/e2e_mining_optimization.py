#!/usr/bin/env python3
"""Real Chromium full-model workbench acceptance; faults are identified explicitly.

Preparation modes: prepared full binaries, real official download, or real
Feather import with interrupted staging. No fake simulation results are used.
"""
import argparse
import json
from pathlib import Path
import tempfile
import time
from urllib.parse import urlsplit
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import Select
from selenium.webdriver.support.ui import WebDriverWait
from e2e_official_download import BrowserNetwork, observe_preparation, assert_single_input_checks

class Checkpoints(list):
    def append(self,check):
        super().append(check);print(json.dumps({'passed':len(self),'check':check}),flush=True)

def main(a):
    out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'flypow-mining-optimization-browser-v1','url':a.url,'preparation':a.preparation,'checks':Checkpoints(),'screenshots':[],
            'faults':'explicitly injected quota denial, stale Worker message, corrupt trace/model/block and official-read denial where tested; computation and storage are real'}
    with tempfile.TemporaryDirectory(prefix='optimization-browser-',dir=out.parent) as profile:
        options=webdriver.ChromeOptions();options.binary_location='/usr/bin/chromium'
        for flag in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-webgl','--no-proxy-server','--renderer-process-limit=2','--num-raster-threads=1','--window-size=1440,1000','--user-data-dir='+profile]:options.add_argument(flag)
        options.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=options);d.set_script_timeout(180);observe_preparation(d)
        report['browser_version']=d.capabilities['browserVersion'];report['webgl_disabled']=True
        d.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':"""
          window.observedSteps=[];window.observedTraceBatches=0;window.observedResults=[];
          const WorkerBase=window.Worker;window.Worker=class extends WorkerBase{constructor(...args){super(...args);if(String(args[0]).includes('research-worker')){window.observedWorker=this;this.addEventListener('message',({data:m})=>{if(m.type==='compute-progress')observedSteps.push({step:m.completedSteps,task:m.taskId,stage:m.stage});if(m.type==='trace-batch')observedTraceBatches++;if(m.type==='result')observedResults.push({task:m.taskId,hash:m.resultHash,memory:m.memoryReport,traceCells:m.trace.cells.length,traceEdges:m.trace.edges.length});});}}};
        """})
        network=BrowserNetwork(d);wait=WebDriverWait(d,1800,poll_frequency=.1)
        def el(i):return d.find_element(By.ID,i)
        def text(i):return el(i).get_attribute('textContent')
        def click(i):wait.until(lambda _:el(i).is_enabled());d.execute_script('arguments[0].click()',el(i))
        def route(view):d.execute_script("document.querySelector('[data-miner-view="+view+"]').click()")
        def snap():return d.execute_script('return window.flypowWorkspace?.snapshot()')
        def log():return d.execute_script('return window.flypowComputation?.snapshot()')
        def js(code):
            result=d.execute_async_script('const done=arguments[0];(async()=>{'+code+'})().then(done,e=>done({error:String(e)}))')
            if isinstance(result,dict) and 'error' in result:raise AssertionError(result['error'])
            return result
        def boot():d.get(a.url.rstrip('/')+'/mining/');wait.until(lambda _:snap() and el('miner-primary').is_enabled())
        def finish():
            wait.until(lambda _:snap()['preparation'] in ['error','space'] or (snap()['preparation']=='ready' and snap()['execution'] in ['complete','paused','error','empty'] and not snap()['running'] and not (snap().get('plan') or {}).get('launchIntent')))
            assert snap()['execution']!='error' and snap()['preparation']=='ready',text('miner-error-detail')
        def run_selected(k):
            route('tools');stimuli=d.execute_script('return Number(document.getElementById("research-stimulus-index").max)+1');target=k//(stimuli*4);stim=(k//4)%stimuli;repeat=k%4
            d.execute_script("document.getElementById('research-cell').selectedIndex=arguments[0];document.getElementById('research-stimulus-index').value=arguments[1];document.getElementById('research-repeat-index').value=arguments[2]",target,stim,repeat);click('research-run');route('experience')
        def capture(name):p=out.parent/(name+'.png');d.save_screenshot(str(p));report['screenshots'].append(str(p))
        def model_dir(code):return js("const cfg=await(await fetch('/assets/data/research-config.json')).json(),root=await navigator.storage.getDirectory(),{modelDirectoryName}=await import('/assets/model-storage.mjs');const dir=await root.getDirectoryHandle(modelDirectoryName(cfg));"+code)
        def input_dir(code):return js("const m=await(await fetch('/assets/data/official-inputs.json')).json(),root=await navigator.storage.getDirectory(),{inputDirectoryName}=await import('/assets/chunk-store.mjs');const dir=await root.getDirectoryHandle(inputDirectoryName(m));"+code)
        try:
            boot();assert not snap()['ready'] and not snap()['running'];assert d.execute_script('return !window.observedWorker');assert not network.requests
            d.execute_script("FlyI18n.setLanguage('en')");wait.until(lambda _:d.execute_script('return FlyI18n.language')=='en')
            report['checks'].append('first visit inspects disk only; no Worker, official transfer or simulation starts')
            if a.preparation=='prepared':
                route('tools');el('research-graph').send_keys(str(a.graph.resolve()));el('research-model').send_keys(str(a.model.resolve()));click('research-prepare');wait.until(lambda _:snap()['ready']);route('experience');assert not snap()['running']
                click('miner-single');finish();assert len(snap()['saved'])==1
                report['checks'].append('explicit prepared-artifact load validates real full files; one-experiment action runs and saves exactly one task')
            else:
                if a.preparation=='import':d.execute_script("window.originalFetch=window.fetch.bind(window);window.fetch=(url,options)=>String(url).startsWith('https://storage.googleapis.com/')?Promise.reject(new TypeError('Injected official read denial')):originalFetch(url,options)")
                click('miner-single')
                if a.preparation=='import':
                    wait.until(lambda _:snap()['preparation']=='files');el('miner-files').send_keys(str(a.annotation.resolve()));wait.until(lambda _:el('miner-files').is_enabled());d.execute_script("document.getElementById('miner-files').value=''");el('miner-files').send_keys('\n'.join(str(p.resolve()) for p in [a.weights,a.transmitter]))
                    def checkpoint():
                        try:return input_dir("try{return JSON.parse(await(await(await dir.getFileHandle('weights-chunks.json')).getFile()).text());}catch{return null;}")
                        except AssertionError:return None
                    wait.until(lambda _:len((checkpoint() or {}).get('chunks',[]))>=2);click('miner-prepare-pause');wait.until(lambda _:snap()['preparation']=='paused' and el('miner-primary').is_enabled());assert not snap()['running'];saved=checkpoint();assert saved['chunks'];report['partial_import_blocks']=len(saved['chunks']);assert input_dir("const p=JSON.parse(await(await(await dir.getFileHandle('annotation-chunks.json')).getFile()).text()),s=m.sources.find(s=>s.id==='annotation');return p.chunks.length===Math.ceil(s.bytes/(4*1024*1024));")
                    input_dir("const h=await dir.getFileHandle('weights.feather'),f=await h.getFile(),old=new Uint8Array(await f.slice(10,11).arrayBuffer())[0],w=await h.createWritable({keepExistingData:true});await w.write({type:'write',position:10,data:new Uint8Array([old^1])});await w.close();return true;")
                    d.execute_script('window.flypowPreparationTrace=[]');click('miner-single')
                finish();assert len(snap()['saved'])==1 and snap()['ready'];report['input_validation']=assert_single_input_checks(d.execute_script('return flypowPreparationTrace'))
                report['checks'].append('one explicit start stages all three real official inputs, checks each once, constructs exact full model and automatically computes/saves one task')
                if a.preparation=='import':report['checks'].append('manual missing-file selections continue the same intent; second-file interruption retains first-file checkpoints and the damaged block is reimported')
            report['initial_profile']=snap()['profileId'];report['initial_result']=d.execute_script('return observedResults.at(-1)');assert report['initial_result']['traceCells']<=64 and report['initial_result']['traceEdges']<=256
            # A sustained real experiment gives time to observe, pause and inspect.
            # Arm the real button before dispatch, so Selenium round trips cannot
            # miss the partial-step interval on a fast or busy browser.
            d.execute_script("""
              window.pauseProbeArmed=true;window.pauseProbeAt=null;
              observedWorker.addEventListener('message',({data:m})=>{if(window.pauseProbeArmed&&m.type==='compute-progress'&&m.completedSteps>=2&&m.completedSteps<m.totalSteps-2){window.pauseProbeArmed=false;window.pauseProbeAt=performance.now();document.getElementById('miner-pause-now').click();}});
            """)
            run_selected(124);WebDriverWait(d,120,poll_frequency=.1).until(lambda _:snap()['paused'])
            assert snap()['replay']['live'] and d.execute_script('return observedTraceBatches')>1
            report['pause_ack_ms']=d.execute_script('return performance.now()-window.pauseProbeAt');report['pause_ack_scope']='page button request through Worker acknowledgement, including polling; no Selenium click round trip'
            paused=log()['latest'];time.sleep(.5);assert log()['latest']['completedSteps']==paused['completedSteps'];assert log()['latest']['recentNeuronUpdatesPerSecond'] is None
            d.execute_script("FlyI18n.setLanguage('zh')");wait.until(lambda _:d.execute_script('return FlyI18n.language')=='zh');assert '暂停' in text('propagation-identity')
            d.execute_script("FlyI18n.setLanguage('en')");wait.until(lambda _:d.execute_script('return FlyI18n.language')=='en');assert 'paused' in text('propagation-identity')
            report['checks'].append('pause is acknowledged between actual slices; counters/rates freeze and the unfinished task remains in memory')
            # Actual background-tab visibility, rather than a synthetic event.
            # Create the second tab while the task is already paused. Creating
            # a browsing context after resume can consume the entire remaining
            # experiment on a busy test host, making this a save-boundary test.
            main_tab=d.current_window_handle;d.switch_to.new_window('tab');background_tab=d.current_window_handle;d.get('about:blank');d.switch_to.window(main_tab)
            click('miner-primary');wait.until(lambda _:not snap()['paused']);assert 'Live core observation' in text('propagation-identity')
            d.switch_to.window(background_tab);time.sleep(.3);d.switch_to.window(main_tab)
            WebDriverWait(d,15,poll_frequency=.1).until(lambda _:snap()['paused'])
            background_steps=log()['latest']['completedSteps'];time.sleep(.3);assert snap()['paused'] and log()['latest']['completedSteps']==background_steps
            report['checks'].append('real tab hiding pauses computation and replay; returning does not resume high load without another explicit click')
            # Seeking pins viewing time, while later live batches still populate its time index.
            d.execute_script("document.getElementById('research-time').value=1;document.getElementById('research-time').dispatchEvent(new Event('input'))");assert snap()['replay']['step']==1
            click('miner-primary');wait.until(lambda _:not snap()['paused']);finish();assert snap()['replay']['step']==1;assert snap()['runningTaskId'] is None;assert snap()['viewedResultId']
            result_hash=text('research-result-hash').removeprefix('SHA-256 ');report['sustained_result_hash']=result_hash
            if snap()['profileId']=='quick32':assert result_hash=='6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0'
            elif snap()['profileId']=='duration128-v1-dev':assert result_hash=='08fda8d1038550ef0ff4237a266e23f063bced5c29fd97d0ebebf3c84ba9ca9d'
            report['checks'].append('in-memory resume completes exact native result; live trace continues receiving while the viewed time stays pinned')
            # Real replay has one cursor and never increases completed work.
            counters=log()['latest']['neuronUpdates'];click('propagation-next');assert snap()['replay']['step']==2;click('propagation-prev');assert snap()['replay']['step']==1
            d.execute_script("document.getElementById('research-replay-mode').value='a';document.getElementById('research-replay-mode').dispatchEvent(new Event('change'))");assert snap()['replay']['step']==1
            click('research-play');time.sleep(.3);click('research-play');assert snap()['replay']['time']>1;assert log()['latest']['neuronUpdates']==counters
            report['checks'].append('seek, step, A/B switch and rAF playback share model time; result replay never adds simulation work')
            # Capture an actually observed arrival, rather than choosing a
            # quarter-window with no visible subnet activity.
            visible_step=js("const idx=await(await fetch('/assets/data/research-profiles.json')).json(),entry=idx.profiles.find(p=>p.id===flypowWorkspace.snapshot().profileId),cfg=await(await fetch(entry.config_path)).json(),cat=await(await fetch(entry.catalog_path)).json(),{taskForIndex}=await import('/assets/catalog-task.mjs'),{loadLocalPreview}=await import('/assets/response-store.mjs'),bundle=await loadLocalPreview(cat,cfg,await taskForIndex(cat,124)),counts=new Map();for(const e of bundle.trace?.transfers||[]){if(e[5]<cfg.steps)counts.set(e[5],(counts.get(e[5])||0)+1);}return [...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??0;")
            report['screenshot_model_step']=visible_step
            d.execute_script("document.getElementById('research-replay-mode').value='b';document.getElementById('research-replay-mode').dispatchEvent(new Event('change'))")
            d.execute_script("document.getElementById('research-time').value=arguments[0];document.getElementById('research-time').dispatchEvent(new Event('input'))",visible_step+.5)
            for language in ['en','zh']:
                d.execute_script('FlyI18n.setLanguage(arguments[0])',language);wait.until(lambda _:d.execute_script('return FlyI18n.language')==language)
                assert ('完整模型实验' in text('miner-result-summary')) if language=='zh' else ('full-model experiment' in text('miner-result-summary'))
                for width in [320,390,768,1440]:
                    d.set_window_size(width,1000);time.sleep(.12);assert d.execute_script('return document.documentElement.scrollWidth <= innerWidth+1'),(language,width)
                    assert el('miner-primary').is_displayed() and el('propagation-canvas').is_displayed();capture(f'workbench-{language}-{width}')
                    d.execute_script("document.documentElement.style.scrollBehavior='auto';document.getElementById('research-response').scrollIntoView({behavior:'instant',block:'start'})");time.sleep(.1);capture(f'propagation-{language}-{width}');d.execute_script("scrollTo({top:0,behavior:'instant'})")
            d.execute_script("FlyI18n.setLanguage('en')");d.set_window_size(1440,1000)
            d.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]});click('research-play');time.sleep(.12);assert not snap()['replay']['playing'];click('propagation-next');assert el('propagation-canvas').get_attribute('tabindex')=='0';d.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[]})
            report['checks'].append('EN/ZH workbench is readable without overflow at 320/390/768/1440; reduced motion supports static stepping and keyboard-focusable 2D')
            # Preserve the historical view while two different eligible tasks save.
            historical=snap()['viewedResultId'];count=len(snap()['saved']);d.execute_script("document.getElementById('miner-limit-count').value=2");click('miner-primary');finish();assert len(snap()['saved'])==count+2;assert len({r['taskId'] for r in snap()['saved']})==len(snap()['saved']);assert snap()['viewedResultId']==historical
            report['checks'].append('continuous session saves two distinct eligible tasks and task limit stops; pinned historical viewing is not replaced')
            # Small active limit pauses a real sustained experiment, preserving state.
            d.execute_script("document.getElementById('miner-limit-minutes').value=0.003");run_selected(125);wait.until(lambda _:snap()['paused']);assert snap()['session']['elapsedMs']<1500;assert log()['latest']['completedSteps']<log()['latest']['totalSteps'];click('miner-stop');d.switch_to.alert.accept();finish();d.execute_script("document.getElementById('miner-limit-minutes').value=10")
            report['checks'].append('active-time limit pauses within a real slice; explicit discard releases only the unfinished task')
            # A small session budget retains science instead of truncating it.
            d.execute_script("document.getElementById('miner-limit-storage').value=1")
            count=len(snap()['saved']);run_selected(124);finish();assert len(snap()['saved'])==count and any(r['event']=='save-error' and r.get('code')=='resource' for r in log()['entries'])
            click('miner-show-result');assert el('research-download').is_enabled();d.execute_script("document.getElementById('miner-limit-storage').value=1024")
            report['checks'].append('real result exceeds explicit 1 MiB session storage budget; dispatch stops with complete output available for export')
            # Hold an actual response save at its I/O boundary; stop must finish it.
            d.execute_script("""
              window.originalStreamWrite=FileSystemWritableFileStream.prototype.write;window.holdResultSave=true;window.saveWaiting=false;
              FileSystemWritableFileStream.prototype.write=function(...args){if(window.holdResultSave&&flypowComputation.snapshot().latest?.stage==='saving'){window.holdResultSave=false;window.saveWaiting=true;return new Promise(resolve=>{window.releaseResultSave=()=>resolve(originalStreamWrite.apply(this,args));});}return originalStreamWrite.apply(this,args);};
            """)
            saved_before=snap()['saved'];count=len(saved_before);expected=count+(0 if any(int(r['k'])==125 for r in saved_before) else 1);run_selected(125);wait.until(lambda _:d.execute_script('return window.saveWaiting'))
            assert log()['latest']['completedSteps']==128;click('miner-stop');d.switch_to.alert.accept();assert snap()['running'] and len(snap()['saved'])==count
            d.execute_script('window.releaseResultSave();FileSystemWritableFileStream.prototype.write=window.originalStreamWrite');finish();assert len(snap()['saved'])==expected
            saved_root=js("const idx=await(await fetch('/assets/data/research-profiles.json')).json(),entry=idx.profiles.find(p=>p.id===flypowWorkspace.snapshot().profileId),cfg=await(await fetch(entry.config_path)).json(),cat=await(await fetch(entry.catalog_path)).json(),{taskForIndex}=await import('/assets/catalog-task.mjs'),{loadLocalResponse}=await import('/assets/response-store.mjs');return (await loadLocalResponse(cat,cfg,await taskForIndex(cat,125))).resultHash;")
            assert saved_root==d.execute_script('return observedResults.at(-1).hash')
            report['checks'].append('stop during a gated real OPFS save finishes the completed scientific archive and dispatches no further task')
            # Stale identity cannot mark the worker ready or overwrite completed work.
            old=snap();d.execute_script("observedWorker.dispatchEvent(new MessageEvent('message',{data:{type:'ready',generation:-1,operationId:'stale'}}))");assert snap()['saved']==old['saved'] and snap()['ready']==old['ready']
            # Scientific save failure keeps actual full output exportable.
            d.execute_script("window.realEstimate=navigator.storage.estimate.bind(navigator.storage);navigator.storage.estimate=async()=>flypowComputation.snapshot().latest?.stage==='saving'?{quota:1,usage:1}:realEstimate()")
            before_count=len(snap()['saved']);run_selected(126);finish();assert len(snap()['saved'])==before_count;assert any(r['event']=='save-error' for r in log()['entries']);click('miner-show-result');assert el('research-download').is_enabled() and 'save failed' in text('miner-result-summary');d.execute_script('navigator.storage.estimate=window.realEstimate')
            report['checks'].append('injected disk quota failure retains complete real science and export controls; stale Worker ready message is ignored')
            # Refresh keeps durable files and explanation, never the in-memory task.
            requests_before=len(network.requests);boot();assert not snap()['running'] and not snap()['ready'];assert not d.execute_script('return !!window.observedWorker');click('miner-single');finish();assert snap()['ready'];assert len(network.requests)==requests_before
            report['checks'].append('refresh restores saved data only; one explicit click validates warm model and computes a different task with zero official requests')
            if a.preparation!='prepared':
                route('settings');click('miner-release');model_dir("const h=await dir.getFileHandle('model-v0.bin'),f=await h.getFile(),old=new Uint8Array(await f.slice(60,61).arrayBuffer())[0],w=await h.createWritable({keepExistingData:true});await w.write({type:'write',position:60,data:new Uint8Array([old^1])});await w.close();return true;");route('experience');click('miner-single');finish();assert snap()['ready'];assert len(network.requests)==requests_before
                report['checks'].append('injected corrupt derived model repairs within the same start using intact official input cache; no network download or result deletion')
            # Trace side-file corruption never invalidates original archive v1.
            trace_status=js("""
              const index=await(await fetch('/assets/data/research-profiles.json')).json(),entry=index.profiles.find(p=>p.id===PROFILE),cfg=await(await fetch(entry.config_path)).json(),cat=await(await fetch(entry.catalog_path)).json();
              const {taskForIndex}=await import('/assets/catalog-task.mjs'),{loadLocalPreview}=await import('/assets/response-store.mjs'),task=await taskForIndex(cat,124),root=await navigator.storage.getDirectory(),namespace='flypow-responses-v1-'+cat.campaign.campaign_id.map(x=>x.toString(16).padStart(2,'0')).join(''),dir=await(await root.getDirectoryHandle(namespace)).getDirectoryHandle(task.taskId);
              const manifest=await(await(await dir.getFileHandle('trace-manifest.json')).getFile()).arrayBuffer(),handle=await dir.getFileHandle('trace.json'),file=await handle.getFile(),bytes=new Uint8Array(await file.arrayBuffer());bytes[10]^=1;let writer=await handle.createWritable();await writer.write(bytes);await writer.close();const damaged=await loadLocalPreview(cat,cfg,task);bytes[10]^=1;writer=await handle.createWritable();await writer.write(bytes);await writer.close();await dir.removeEntry('trace-manifest.json');const missing=await loadLocalPreview(cat,cfg,task);writer=await(await dir.getFileHandle('trace-manifest.json',{create:true})).createWritable();await writer.write(manifest);await writer.close();const restored=await loadLocalPreview(cat,cfg,task);return {damaged:damaged.traceStatus,missing:missing.traceStatus,restored:restored.traceStatus,resultRoot:restored.resultHash};
            """.replace('PROFILE',json.dumps(snap()['profileId'])))
            assert trace_status['damaged']=='unavailable-or-damaged' and trace_status['missing']=='missing' and trace_status['restored']=='local-core-observation';assert trace_status['resultRoot']==result_hash;report['trace_fault_status']=trace_status
            report['checks'].append('corrupt/missing independent trace falls back without changing original archive identity; restored side files remain locally observed')
            # A faulted Worker releases runtime readiness and cannot finish old work.
            count=len(snap()['saved']);d.execute_script("window.faultProbeArmed=true;observedWorker.addEventListener('message',({data:m})=>{if(window.faultProbeArmed&&m.type==='compute-progress'&&m.completedSteps>=2&&m.completedSteps<m.totalSteps){window.faultProbeArmed=false;observedWorker.dispatchEvent(new ErrorEvent('error',{message:'Injected Worker crash'}));}})");run_selected(127);wait.until(lambda _:snap()['execution']=='error' and not snap()['running']);assert not snap()['ready'] and len(snap()['saved'])==count
            report['checks'].append('explicitly injected Worker fault stops unfinished work, clears runtime readiness and preserves saved results')
            boot();click('miner-single');finish()
            before_cursor=snap()['replay']['step'];el('propagation-canvas').send_keys(Keys.ARROW_RIGHT);assert snap()['replay']['step']==min(before_cursor+1,127)
            report['profile_results']=[{'profile':'duration128-v1-dev','k':124,'resultRoot':result_hash}]
            for choice,golden in [('duration256-v1-dev','82502595566cb3070a914bc426060b6b48dc89e58650195dbee363c45fab5683'),('quick32','6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0')]:
                assert any(o.get_attribute('value')==choice for o in el('miner-profile').find_elements(By.TAG_NAME,'option')),'Required validated profile is missing: '+choice
                Select(el('miner-profile')).select_by_value(choice);wait.until(lambda _:snap()['profileId']==choice)
                assert snap()['viewedResultId'] is None and snap()['replay'] is None and not el('research-response').is_displayed(), 'Previous profile view must be cleared before dispatch'
                run_selected(124);finish();click('miner-show-result');assert golden in text('research-result-hash')
                report['profile_results'].append({'profile':choice,'k':124,'resultRoot':golden})
            report['checks'].append('idle profile switching reuses model without changing frozen task identities; real 256-step and old32 results match native roots')
            report['checks'].append('2D propagation and original result export are available independently of 3D anatomy loading')
            report['official_request_count']=len(network.requests);report['network_write_count']=len(network.writes);report['network_observer_errors']=list(network.errors);report['last_state']=snap()
            errors=[x['message'] for x in d.get_log('browser') if x['level']=='SEVERE' and 'Injected official read denial' not in x['message']];report['severe_browser_errors']=errors
            assert not network.writes,network.writes
            assert not network.errors,network.errors
            assert not errors,errors
            report['success']=True
        finally:
            report['official_request_count']=len(network.requests);report['network_write_count']=len(network.writes);report['network_observer_errors']=list(network.errors)
            try:report['last_state']=snap();report['last_error']=text('miner-error-detail')
            except Exception:pass
            out.write_text(json.dumps(report,indent=2)+'\n');network.close();d.quit()
    print(json.dumps({'success':report.get('success',False),'checks':len(report['checks']),'report':str(out)},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',required=True);p.add_argument('--report',required=True);p.add_argument('--preparation',choices=['prepared','download','import'],default='prepared')
    for name,default in [('graph','data/prepared/registry-male-cns-v1.0/graph-v1.bin'),('model','data/prepared/registry-male-cns-v1.0/model-v0.bin'),('annotation','/workspace/flypow-annotations-v1.0.feather'),('weights','/workspace/flypow-weights-ranges-v1.0.feather'),('transmitter','/workspace/flypow-transmitters-v1.0.feather')]:p.add_argument('--'+name,type=Path,default=Path(default))
    main(p.parse_args())
