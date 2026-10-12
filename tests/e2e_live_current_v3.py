#!/usr/bin/env python3
"""Current Worker data in the actual UI; controlled known inputs are tests.

Retains browser profiles, OPFS and identities. Never downloads official data.
One browser run yields one complete passing candidate for later arbitration.
"""
import argparse,json,time,traceback,subprocess
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile,DEFAULT_PROFILE,close_test_browser
from e2e_official_download import BrowserNetwork
def main(a):
 out=Path(a.report).resolve();out.parent.mkdir(parents=True,exist_ok=True);report=dict(schema='flypow-live-current-v3-browser-v1',checks=[],profileRetained=True,physicalAndroid=False,controlledKnownInput=True,renderCondition='Chromium/ANGLE SwiftShader; cgroup 2 CPU/2 GiB, no physical GPU claim')
 def save():out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 def check(s):report['checks'].append(s);save();print(json.dumps(dict(passed=len(report['checks']),check=s)),flush=True)
 with retained_profile(a.profile) as profile:
  opt=webdriver.ChromeOptions();opt.binary_location='/usr/bin/chromium'
  for f in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--renderer-process-limit=1','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--user-data-dir='+profile,'--window-size=1440,1050']:opt.add_argument(f)
  opt.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=opt);d.set_script_timeout(180);wait=WebDriverWait(d,240,poll_frequency=.2);network=BrowserNetwork(d,staged_network=json.loads(Path(a.staged_network).read_text()) if a.staged_network else None,staged_origin=a.url.rstrip('/'))
  def js(code,*args):return d.execute_script(code,*args)
  def asyncjs(code,*args):return d.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+code+'})().then(done,e=>done({error:e.message,stack:e.stack}));',*args)
  def el(i):return d.find_element(By.ID,i)
  def click(i):js('arguments[0].click()',el(i))
  def snap():return js('return window.flypowWorkspace?.snapshot()')
  def graphics(on):js("const x=document.getElementById('miner-graphics');x.checked=arguments[0];x.dispatchEvent(new Event('change'));",on)
  def route(view):js("document.querySelector('[data-miner-view="+view+"]').click()")
  def shot(name):p=out.parent/(name+'.png');d.save_screenshot(str(p));return str(p)
  try:
   if a.staged_network:
    staged=json.loads(Path(a.staged_network).read_text())
    assert staged['developmentOnly'] and staged['enabled'] and all(staged[k] is False for k in ['payment','rewards','requiredWallet'])
    report['stagedNetwork']=staged;report['configurationOverrideOnly']=True
    # Only the unpublished frontend configuration is staged. The HTTPS API,
    # signatures, Worker, uploads, replay and arbitration are actual services.
   if a.webgl1:d.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':"const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(k,...a){return k==='webgl2'?null:original.call(this,k,...a)};"})
   if a.compatibility:d.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':"window.acceptanceContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(k,attributes,...a){return /webgl/.test(k)&&attributes?.antialias?null:acceptanceContext.call(this,k,attributes,...a)};"})
   d.get(a.url+'/mining/');wait.until(lambda _:snap());wait.until(lambda _:snap()['authorityOnline']);assert not snap()['running'];assert el('miner-search-mode').get_attribute('value')=='target';report['browserVersion']=d.capabilities['browserVersion'];report['initial']=snap();check('Signed target default, calibrated capabilities and explicit start; no automatic CPU')
   recovered=[]
   route('contributions')
   while snap()['goalUi']['pendingOutputs']:
    buttons=d.find_elements(By.CSS_SELECTOR,'[data-recover-trial]');assert buttons,'Pending output must have a real recovery action'
    trial=buttons[-1].get_attribute('data-recover-trial');js('arguments[0].click()',buttons[-1]);wait.until(lambda _:not d.find_elements(By.CSS_SELECTOR,'[data-recover-trial="'+trial+'"]'));recovered.append(trial)
   report['recoveredWithoutComputation']=recovered
   if recovered:check('Retained completed backgrounds recovered through UI before CPU start; no recomputation')
   assert not js("return document.getElementById('research-time')||document.getElementById('research-play')");graphics(False);route('tools')
   if snap()['cacheModel']:click('research-restore')
   else:
    el('research-graph').send_keys(str(Path('data/prepared/registry-male-cns-v1.0/graph-v1.bin').resolve()));el('research-model').send_keys(str(Path('data/prepared/registry-male-cns-v1.0/model-v0.bin').resolve()));click('research-prepare')
   wait.until(lambda _:snap()['ready'] and not snap()['preparationBusy'] and not snap()['actionBusy'] or snap()['preparation']=='error');assert snap()['ready'],el('miner-error-detail').get_attribute('textContent');report['modelCacheRestored']=report['initial']['cacheModel'];route('experience');check('Retained complete model or one local-file seed; zero official downloads')
   # Only candidate selection and automatic stopping are controlled. Run,
   # complete A/B, evaluation, archive, commit, upload and reveal are real code.
   js('window.acceptancePreferredInput=arguments[0]',json.loads(Path(a.input_file).read_text()) if a.input_file else {'stimulatedBodyId':'87973','startStep':0,'endStep':1,'current':150})
   result=asyncjs("""
    const {GoalSearchRunner}=await import('/assets/goal-search-runner.mjs'),{inputs}=await import('/assets/target-protocol-v2.mjs'),{LiveObservationView}=await import('/assets/live-observation-view.mjs');
    const prepare=GoalSearchRunner.prototype.prepareRound;GoalSearchRunner.prototype.prepareRound=async function(round){await prepare.call(this,round);window.acceptanceRunner=this;const legal=inputs(round.goal),preferred=window.acceptancePreferredInput,ordered=[preferred,...legal.filter(x=>JSON.stringify(x)!==JSON.stringify(preferred))];this.order={schema:'controlled-known-input-v3-test-only',size:ordered.length,at:i=>ordered[i]};this.cursor.cursor=0;};
    const complete=GoalSearchRunner.prototype.complete;GoalSearchRunner.prototype.complete=function(e){if(e.meta.sciencePassed)this.pauseNow('controlled-test-candidate-complete');complete.call(this,e);};
    const draw=LiveObservationView.prototype.draw;LiveObservationView.prototype.draw=function(f){window.acceptanceObservation=this;return draw.call(this,f);};return true;
   """);assert result is True,result
   js("const x=document.getElementById('miner-threads');x.value=1;x.dispatchEvent(new Event('change'));document.getElementById('miner-limit-minutes').value=20;")
   graphics(not a.graphics_off);el('anatomy-stage').location_once_scrolled_into_view;click('miner-primary');wait.until(lambda _:snap()['running']);report['expectedRoundId']=snap()['target']['roundId'];wait.until(lambda _:snap()['viewDiagnostics']['latestCompletedStep' if a.graphics_off else 'renderedStep']>=4);report['current']=snap();
   if not a.graphics_off:assert report['current']['anatomy']['renderer']==('webgl1' if a.webgl1 else 'webgl2')
   check('Actual Worker progress with graphics off' if a.graphics_off else 'Actual complete-step snapshots render in the main view without historical playback')
   samples=[];frames=[];began=time.monotonic();last_seq=0;controls=False;recorded=0;recording_complete=False;late_graphics=False;history_live=False;compatibility_done=False
   while time.monotonic()-began<600:
    s=snap();diag=s['viewDiagnostics'];scope=diag.get('scope');focus=s.get('target',{}).get('focusedExecutionId')
    if scope and s['running'] and diag.get('stage') not in ['complete','stopped']:assert focus==scope['executionId'],(focus,scope)
    if scope:
     e=next((x for x in s.get('executions',[]) if x['executionId']==scope['executionId']),None)
     if e:assert e['taskId']==scope['trialId'] and e['candidateId']==scope['candidateId'] and e['roundId']==scope['roundId']
    samples.append(dict(at=time.monotonic()-began,graphicsEnabled=s['graphicsEnabled'],scope=scope,computed=diag['latestCompletedStep'],snapshot=diag['snapshotStep'],drawn=diag['renderedStep'],pending=diag['pendingSlots'],latencies=diag['latencies'][-1:],stage=diag.get('stage'),ribbon=s['anatomy'].get('ribbon')))
    assert diag['pendingSlots']<=1 and diag['maxPendingSlots']<=1
    if s['graphicsEnabled'] and s['anatomy'].get('ribbon',{}).get('routeCount',0)>0 and recorded<24:
     frames.append(shot('live-frame-'+str(recorded).zfill(3)));recorded+=1
    if a.late_graphics and not late_graphics and diag['latestCompletedStep']>=32:
     late_graphics=True;graphics(True);wait.until(lambda _:snap()['viewDiagnostics']['renderedStep']>=32);assert snap()['anatomy']['renderer']==('webgl1' if a.webgl1 else 'webgl2');report['lateGraphics']=snap();report['forcedRenderer']=snap()['anatomy']['renderer'];check('Graphics enabled during actual current computation; forced renderer follows current complete state')
    if a.compatibility and late_graphics and not compatibility_done:
     compatibility_done=True;scope=snap()['viewDiagnostics']['scope'];assert snap()['anatomy']['antialias'] is False
     d.set_window_size(1440,1400);js('window.scrollTo(0,0)');report['currentDesktopScreenshot']=shot('desktop-current-goal');el('anatomy-stage').location_once_scrolled_into_view
     report['lowDPR']=js('return acceptanceObservation.scene.renderer.getPixelRatio()');assert report['lowDPR']<=.65
     d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':False});d.execute_cdp_cmd('Emulation.setTouchEmulationEnabled',{'enabled':True});el('anatomy-stage').location_once_scrolled_into_view
     camera=snap()['anatomy']['camera'];r=js("const r=document.getElementById('anatomy-stage').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}")
     def touch(kind,points):d.execute_cdp_cmd('Input.dispatchTouchEvent',{'type':kind,'touchPoints':points})
     touch('touchStart',[{'x':r['x'],'y':r['y'],'id':1}]);touch('touchMove',[{'x':r['x']+30,'y':r['y']+15,'id':1}]);touch('touchEnd',[])
     assert snap()['anatomy']['camera']['yaw']!=camera['yaw'];zoom=snap()['anatomy']['camera']['zoom'];touch('touchStart',[{'x':r['x']-25,'y':r['y'],'id':1},{'x':r['x']+25,'y':r['y'],'id':2}]);touch('touchMove',[{'x':r['x']-50,'y':r['y'],'id':1},{'x':r['x']+50,'y':r['y'],'id':2}]);touch('touchEnd',[]);assert snap()['anatomy']['camera']['zoom']<zoom
     assert snap()['viewDiagnostics']['scope']==scope;report['currentMobileScreenshot']=shot('mobile-current-touch');check('Current Worker data survives 390px touch rotation/pinch at low DPR with antialias disabled; emulated input only')
     js('acceptanceObservation.scene.renderer.getContext().getExtension("WEBGL_lose_context").loseContext()');wait.until(lambda _:js('return acceptanceObservation.fallback&&!acceptanceObservation.scene'));assert snap()['viewDiagnostics']['scope']==scope
     js('HTMLCanvasElement.prototype.getContext=function(k,...a){return /webgl/.test(k)?null:acceptanceContext.call(this,k,...a)}');assert asyncjs('await acceptanceObservation.retryDisplay();return !!acceptanceObservation.scene;') is False
     before=snap()['viewDiagnostics']['renderedStep'];wait.until(lambda _:snap()['viewDiagnostics']['renderedStep']>before);assert el('propagation-canvas').is_displayed();report['fallbackCurrentScreenshot']=shot('canvas-current');check('Actual context loss and unavailable WebGL fall back to Canvas consuming new complete states without replay')
     js('HTMLCanvasElement.prototype.getContext=function(k,attributes,...a){return /webgl/.test(k)&&attributes?.antialias?null:acceptanceContext.call(this,k,attributes,...a)}');assert asyncjs('await acceptanceObservation.retryDisplay();return !!acceptanceObservation.scene;') is True;el('anatomy-stage').location_once_scrolled_into_view;wait.until(lambda _:snap()['anatomy'].get('geometryState')=='ready');wait.until(lambda _:snap()['viewDiagnostics']['renderedStep']>=before)
     assert snap()['viewDiagnostics']['scope']==scope;check('Display retry reuses current identity and cached morphology while scientific computation continues')
    if a.late_graphics and late_graphics and recorded>=4 and not recording_complete:
     graphics(False);recording_complete=True;check('Targeted forced-renderer current frames captured; remaining full science uses graphics off')
    if not history_live and scope and any(m['trials']>=1 and not m['sciencePassed'] and m['roundId']==scope['roundId'] for m in s.get('goalResults',[])) and diag['latestCompletedStep']>=4:
     route('contributions');buttons=d.find_elements(By.CSS_SELECTOR,'[data-candidate-view]')
     if buttons:
      before_scope=snap()['viewDiagnostics']['scope'];js('arguments[0].click()',buttons[0]);wait.until(lambda _:snap()['artifactSelection']);after=snap();after_scope=after['viewDiagnostics']['scope']
      # Loading a saved background can span the actual A/B completion barrier.
      # A legitimate next background must follow the current execution, while
      # selecting historical artifacts must never become the observation source.
      if after_scope!=before_scope:
       active=next(e for e in after['target']['executions'] if e['executionId']==after['target']['focusedExecutionId']);assert after_scope['executionId']==active['executionId'] and after_scope['trialId']==active['trialId'] and after_scope['candidateId']==active['candidateId'] and after_scope['roundId']==after['target']['roundId']
      assert after['viewDiagnostics']['source']=='current-computation';route('experience');history_live=True;check('Saved background metrics opened during another actual background calculation without replacing current identity')
     else:route('experience')
    if not a.graphics_off and not controls and diag['renderedStep']>=12:
     controls=True;click('miner-primary');wait.until(lambda _:snap()['paused']);paused=snap();time.sleep(.4);assert snap()['viewDiagnostics']['latestCompletedStep']==paused['viewDiagnostics']['latestCompletedStep'];graphics(False);assert not snap()['graphicsEnabled'];click('miner-primary');wait.until(lambda _:not snap()['paused']);before=snap()['viewDiagnostics']['latestCompletedStep'];time.sleep(.8);assert snap()['viewDiagnostics']['latestCompletedStep']>before;graphics(True);wait.until(lambda _:snap()['viewDiagnostics']['renderedStep']>=before);check('Explicit pause freezes computation; graphics off permits authorized work and re-enable takes current state')
     js('const until=performance.now()+650;while(performance.now()<until){}');time.sleep(.4);assert snap()['viewDiagnostics']['pendingSlots']<=1;check('650 ms main-thread block does not create a historical frame queue')
     d.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]});time.sleep(.4);assert js('return acceptanceObservation.motion.matches');d.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[]});check('Reduced motion retains actual latest-state updates')
    if controls and recorded>=8 and not recording_complete:
     graphics(False);recording_complete=True;check('Current Worker recording captured; remaining full evidence computation uses graphics switch off')
    if any(m['roundId']==report['expectedRoundId'] and m['sciencePassed'] and m['trials']>=2 and m['phase'] in ['verifying','revealed','valid','winner-confirmed'] for m in s.get('goalResults',[])):break
    time.sleep(.2)
   else:raise AssertionError('Complete candidate/commit/reveal timed out')
   report['samples']=samples;report['recordingFrames']=frames;report['candidate']=next(m for m in snap()['goalResults'] if m['roundId']==report['expectedRoundId'] and m['sciencePassed']);report['scientificArtifacts']=asyncjs("const m=await acceptanceRunner.store.metadata(arguments[0]);return {input:m.input,trials:m.trials,manifest:m.manifest,receipt:m.receipt};",report['candidate']['candidateId']);report['claim']=asyncjs("const m=await acceptanceRunner.store.metadata(arguments[0]);return {claimId:m.claimId,receipt:m.receipt,phase:m.phase};",report['candidate']['candidateId']);report['roundId']=report['candidate']['roundId'];report['goalId']=snap()['target']['goalId'];report['minerId']=js('return acceptanceRunner.client.identity.publicKey');report['final']=snap();check('Real Worker candidate satisfies all backgrounds, saves, commits, uploads and reveals; verification still pending')
   if a.artifacts:
    report['artifactRecovery']=asyncjs(Path('tests/browser_artifact_probe_v3.js').read_text());assert 'error' not in report['artifactRecovery'],report['artifactRecovery'];check('Two real completed background copies survive injected metadata save faults, independent recovery and complete ZIP without changing live focus')
   if frames:
    subprocess.run(['convert','-delay','25','-loop','0',*frames,str(out.parent/'current-calculation.gif')],check=True,timeout=60);report['recording']=str(out.parent/'current-calculation.gif');report['recordingScope']='Actual current Worker frames; sampled GIF cadence is not GPU FPS or model time.'
   d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':False});js('window.scrollTo(0,0)');time.sleep(.3);assert js('return document.documentElement.scrollWidth')<=391;report['mobileScreenshot']=shot('mobile-390');check('390px layout contains the target, start/status and brain without horizontal overflow; emulation only')
   diag=snap()['viewDiagnostics'];before=diag['scope'];route('contributions');clicks=d.find_elements(By.CSS_SELECTOR,'#miner-goal-result-list [data-candidate-view]');assert clicks;js('arguments[0].click()',clicks[0]);wait.until(lambda _:snap()['artifactSelection']);assert snap()['viewDiagnostics']['scope']==before;assert snap()['viewDiagnostics']['source']=='current-computation';check('Historical metrics/download selection cannot replace current observation identity')
   js('window.confirm=()=>true');click('miner-stop');wait.until(lambda _:not snap()['running']);route('settings');click('miner-release');wait.until(lambda _:not snap()['ready']);d.refresh();wait.until(lambda _:snap() and snap()['authorityOnline']);assert not snap()['running'] and snap()['cacheModel'];assert any(m['sciencePassed'] for m in snap()['goalResults']);check('Refresh preserves full model, candidates and signing identity; never resumes CPU')
   report['network']=dict(officialRequests=network.requests,officialBytes=network.data_received_bytes,configurationOverrides=network.staged_requests,observerErrors=network.errors);assert not network.requests and not network.errors
   # Chromium can deliver a dedicated Worker's Fetch event to its parent page
   # debugger. The real Worker rejects inactive configuration before running;
   # require page load, at least one guarded trial dispatch, and final refresh.
   if a.staged_network:assert len(network.staged_requests)>=3,'Page, actual Worker trial and refresh must receive the pinned staged configuration'
   severe=[x for x in d.get_log('browser') if x['level']=='SEVERE'];expected=lambda x:x['source']=='network' and '/api/target-mining/v2/claims/'+report['claim']['claimId']+' - Failed to load resource: the server responded with a status of 404' in x['message'];report['expectedAbsentClaimProbes']=[x for x in severe if expected(x)];report['browserErrors']=[x for x in severe if not expected(x)];assert not report['browserErrors'],report['browserErrors'];report['passed']=len(report['checks']);save()
  except Exception as e:
   report['failure']=str(e);report['traceback']=traceback.format_exc()
   report['network']=dict(officialRequests=network.requests,officialBytes=network.data_received_bytes,configurationOverrides=network.staged_requests,observerErrors=network.errors)
   try:report['uiError']=el('miner-error-detail').get_attribute('textContent');report['state']=snap();report['browserErrors']=d.get_log('browser');report['failureScreenshot']=shot('failure')
   except Exception:pass
   save();raise
  finally:network.close();close_test_browser(d)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default='http://127.0.0.1:8084');p.add_argument('--profile',type=Path,default=DEFAULT_PROFILE);p.add_argument('--report',default='data/prepared/live-current-v3/browser-1/report.json');p.add_argument('--staged-network',help='Stage only the unpublished pinned configuration; all API calls use the actual HTTPS service');p.add_argument('--input-file');p.add_argument('--artifacts',action='store_true');p.add_argument('--webgl1',action='store_true');p.add_argument('--graphics-off',action='store_true');p.add_argument('--late-graphics',action='store_true');p.add_argument('--compatibility',action='store_true');main(p.parse_args())
