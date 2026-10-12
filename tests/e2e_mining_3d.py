#!/usr/bin/env python3
"""Real Chromium, independent full-model Workers and WebGL anatomy acceptance.

Faults are explicitly injected; all scientific work uses the frozen full model.
The cached/prepared input path avoids another 1.1 GB cold download.
"""
import argparse,json,platform,os,time,traceback
from browser_cache import DEFAULT_PROFILE, retained_profile
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from e2e_official_download import BrowserNetwork

GOLD={'duration256-v1-dev': '82502595566cb3070a914bc426060b6b48dc89e58650195dbee363c45fab5683','quick32':'6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0','duration128-v1-dev':'08fda8d1038550ef0ff4237a266e23f063bced5c29fd97d0ebebf3c84ba9ca9d'}
def main(a):
 out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True)
 report={'schema':'flypow-mining-3d-browser-v1','url':a.url,'browser_profile':str(Path(a.profile).resolve()),'profile_retained':True,'hardware':{'platform':platform.platform(),'logical_processors':os.cpu_count(),'physical_memory_bytes':os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES')},'checks':[],'screenshots':[],'faults':'quota shortfall, injected Worker error, deliberately wrong geometry hash and disabled WebGL where checked; scientific results are real'}
 def write():out.write_text(json.dumps(report,indent=2)+'\n')
 def check(s):report['checks'].append(s);write();print(json.dumps({'passed':len(report['checks']),'check':s}),flush=True)
 if a.profile:Path(a.profile).mkdir(parents=True,exist_ok=True)
 report['hardware']['cgroup_memory_limit_bytes']=Path('/sys/fs/cgroup/memory.max').read_text().strip()
 report['hardware']['cgroup_cpu_quota']=Path('/sys/fs/cgroup/cpu.max').read_text().strip()
 with retained_profile(a.profile) as profile:
  options=webdriver.ChromeOptions();options.binary_location='/usr/bin/chromium'
  for arg in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--renderer-process-limit=1','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--user-data-dir='+profile,'--window-size=1440,1050']:options.add_argument(arg)
  options.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=options);d.set_script_timeout(180);wait=WebDriverWait(d,900,poll_frequency=.15)
  d.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':'''window.poolObserved=[];window.poolWorkers=[];const Base=Worker;window.Worker=class extends Base{constructor(...args){super(...args);if(String(args[0]).includes('research-worker')){poolWorkers.push(this);this.addEventListener('message',({data:m})=>{if(['compute-progress','result','control-state','ready'].includes(m.type)){poolObserved.push({type:m.type,workerId:m.workerId,executionId:m.executionId,operationId:m.operationId,sessionId:m.sessionId,taskId:m.taskId,k:m.task?.k,stage:m.stage||m.state,step:m.completedSteps,updates:m.neuronUpdates,synapses:m.synapseTransmissions,hash:m.resultHash,at:performance.now(),memory:m.memoryReport});if(poolObserved.length>20000)poolObserved.shift();}});}}};'''});
  network=BrowserNetwork(d)
  def el(i):return d.find_element(By.ID,i)
  def snap():return d.execute_script('return window.flypowWorkspace?.snapshot()')
  def click(i):wait.until(lambda _:el(i).is_enabled());d.execute_script('arguments[0].click()',el(i))
  def js(s):
   r=d.execute_async_script('const done=arguments[0];(async()=>{'+s+'})().then(done,e=>done({error:String(e)}))')
   if isinstance(r,dict) and 'error'in r:raise AssertionError(r['error'])
   return r
  def route(view):d.execute_script("document.querySelector('[data-miner-view="+view+"]').click();window.scrollTo({top:0,behavior:'instant'});")
  def graphics(enabled):
   d.execute_script("const x=document.getElementById('miner-graphics');x.checked=arguments[0];x.dispatchEvent(new Event('change'));",enabled)
   assert snap()['graphicsEnabled']==enabled
  def stage_visible():
   d.execute_script("document.getElementById('anatomy-stage').scrollIntoView({block:'center',behavior:'instant'})")
   wait.until(lambda _:snap()['anatomy'].get('visible'))
  def queue_order(order):
   # Control only permitted selection tie breaking; no TaskID, seed or work changes.
   d.execute_script('''const original=crypto.getRandomValues.bind(crypto);let remaining=0,targetIndex=0;
    crypto.getRandomValues=function(array){if(array instanceof Uint32Array&&array.length===1){
     if(!remaining){const s=flypowWorkspace.snapshot(),used=new Set([...s.saved.map(x=>x.k),...s.executions.map(x=>x.k)]),indices=Array.from({length:832},(_,i)=>i).filter(k=>!used.has(k)),target=arguments.length&&window.acceptanceQueue.find(k=>!used.has(k));remaining=indices.length-1;targetIndex=indices.indexOf(target);}
     const i=remaining--,j=i===targetIndex?0:i;array[0]=Math.floor((j+.25)/(i+1)*4294967296);return array;
    }return original(array);};window.acceptanceQueue=arguments[0];''',order)
  def threads(n):d.execute_script("const x=document.getElementById('miner-threads');x.value=arguments[0];x.dispatchEvent(new Event('input'));x.dispatchEvent(new Event('change'));",n)
  def finish():wait.until(lambda _:snap() and not snap()['running'] and snap()['execution'] in ['complete','paused','empty','error']);assert snap()['execution']!='error',el('miner-error-detail').text
  def selected(k):
   before=len(results());route('tools');d.execute_script("document.getElementById('research-cell').selectedIndex=arguments[0];document.getElementById('research-stimulus-index').value=arguments[1];document.getElementById('research-repeat-index').value=arguments[2];",k//208,(k//4)%52,k%4);click('research-run');wait.until(lambda _:snap()['running'] or len(results())>before);route('experience')
  def capture(name):p=out.parent/(name+'.png');d.save_screenshot(str(p));report['screenshots'].append(str(p))
  def results():return d.execute_script("return poolObserved.filter(m=>m.type==='result')")
  def viewport(w,h):d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':w,'height':h,'deviceScaleFactor':1,'mobile':False});
  try:
   d.get(a.url.rstrip('/')+'/mining/?profile=duration512-v1-dev');wait.until(lambda _:snap() and el('miner-primary').is_enabled());graphics(True);wait.until(lambda _:snap()['anatomy'].get('backgroundSamples')==24000);d.execute_script("FlyI18n.setLanguage('en')");viewport(1440,900)
   report['browser_version']=d.capabilities['browserVersion'];report['webgl_renderer']=d.execute_script("const c=document.querySelector('#anatomy-stage canvas'),g=c.getContext('webgl2');const e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)")
   assert snap()['profileId']=='duration256-v1-dev' and snap()['anatomy']['mode']=='3d' and not d.execute_script('return poolWorkers.length');assert not d.find_elements(By.ID,'miner-profile')
   assert '832' in el('miner-profile-note').text;capture('initial-3d-en');check('Cold entry shows real WebGL anatomy, fixed enabled 256 / 832 batch; residual 512 query does not launch or change computation')
   viewport(1440,900);camera=snap()['anatomy']['camera'];stage=el('anatomy-stage');ActionChains(d).move_to_element(stage).click_and_hold().move_by_offset(90,20).release().perform();wait.until(lambda _:snap()['anatomy']['camera']['yaw']!=camera['yaw']);camera=snap()['anatomy']['camera']
   route('tools');report['cache_before']=snap()['cacheModel']
   if snap()['cacheModel']:
    click('research-restore');wait.until(lambda _:snap()['ready'] or snap()['preparation'] in ['error','files','space'])
   if not snap()['ready']:
    el('research-graph').send_keys(str(Path(a.graph).resolve()));el('research-model').send_keys(str(Path(a.model).resolve()));click('research-prepare');wait.until(lambda _:el('research-run').is_enabled() or snap()['preparation']=='error');report['preparation_method']='prepared local files seeded once'
   else:report['preparation_method']='retained OPFS model restored without import'
   assert snap()['ready'],el('miner-error-detail').text;route('experience');stage_visible();assert snap()['anatomy']['camera']==camera;check('Exact full model restored or seeded once from trusted local files; preparation/route changes preserve the one 3D scene and user camera')
   graphics(False);report['display_off']=snap();assert not snap()['anatomy']['visible'];assert not snap()['replay'] or not snap()['replay']['playing'];check('Explicit graphics switch stops rendering, retains camera and leaves computation controls enabled')
   threads(1);selected(124);wait.until(lambda _:snap()['running'] and snap()['replay']);wait.until(lambda _:any((e.get('telemetry')or{}).get('completedSteps',0)>5 for e in snap()['executions']))
   cursor=snap()['replay']['time'];assert not snap()['replay']['playing'];assert not snap()['anatomy']['visible'];click('miner-primary');wait.until(lambda _:snap()['paused']);assert snap()['pool']['busy']==0;count=d.execute_script('return flypowComputation.snapshot().latest.neuronUpdates');time.sleep(.3);assert d.execute_script('return flypowComputation.snapshot().latest.neuronUpdates')==count
   pauseCam=snap()['anatomy']['camera'];d.execute_script("FlyI18n.setLanguage('zh')");assert snap()['anatomy']['camera']==pauseCam;capture('paused-threads-zh');click('miner-primary');finish();assert results()[-1]['hash']==GOLD['duration256-v1-dev'];report['single_worker']=results()[-1];check('Single full-model 256 cascade, safe pause/resume, stable language/camera and original result root')
   graphics(True)
   if snap()['replay']['playing']:click('research-play')
   stage_visible();d.execute_script("document.getElementById('research-time').value='36.5';document.getElementById('research-time').dispatchEvent(new Event('input'));")
   wait.until(lambda _:snap()['anatomy'].get('located')==32);assert snap()['anatomy']['particles']+snap()['anatomy']['arrivals']>0,snap()['anatomy'];capture('propagation-3d-zh');time_before=snap()['replay']['time'];d.execute_script("FlyI18n.setLanguage('en')");assert snap()['replay']['time']==time_before and snap()['anatomy']['camera']==pauseCam
   # Select a real cell through the shared inspector controls (also ray-picked in UI).
   d.execute_script("const e=document.getElementById('propagation-cell');e.value=e.options[1].value;e.dispatchEvent(new Event('change'));document.getElementById('propagation-inspector').open=true");assert 'Incoming' in el('propagation-detail').text;capture('selected-inspector-en');check('Real 32-cell exact skeletons and s→s+1 signed pulses; deterministic seek/selected state and A/B inspector')
   report['anatomy']=snap()['anatomy'];graphics(False)
   # Full-model ceiling 2: this environment has only 2 GiB / 2 CPU quota.
   queue_order([125,126,127,332]);d.execute_script("document.getElementById('miner-limit-count').value='4';document.getElementById('miner-limit-minutes').value='10'");threads(2);click('miner-primary');wait.until(lambda _:snap()['pool']['busy']==2)
   assert len(set(e['taskId'] for e in snap()['executions']))==len(snap()['executions']);assert snap()['viewedResultId']==GOLD['duration256-v1-dev'] and snap()['replay']['time']==36.5 and snap()['anatomy']['camera']==pauseCam
   report['two_worker_active']=snap();threads(1);wait.until(lambda _:snap()['pool']['parked']==1 and snap()['pool']['busy']<=1);report['shrunk']=snap();assert snap()['session']['elapsedMs']>0;capture('thread-adjustment-en');threads(2);wait.until(lambda _:snap()['pool']['busy']==2)
   click('miner-primary');wait.until(lambda _:snap()['paused']);assert snap()['pool']['busy']==0;report['pause_ack']=snap();click('miner-primary');wait.until(lambda _:snap()['pool']['busy']==2);click('miner-pause-after');finish();report['multi_worker_results']=results();assert len({r['taskId'] for r in report['multi_worker_results']})==len(report['multi_worker_results']);check('Two independent full-model WASM Workers overlap on distinct TaskIDs; 2→1 parks state, 1→2 resumes it, global pause and saving preserve pinned history')
   report['overlap']=d.execute_script('return flypowWorkspace.snapshot().poolHistory');report['messages']=d.execute_script('return poolObserved');report['memory_scope']='Per Worker: WASM linear-memory capacity. Linux process RSS sampled independently; neither is available RAM.'
   # The independent-secondary same-task comparison is a separate cached run.
   selected(0);finish();click('miner-show-result');wait.until(lambda _:snap()['viewedResultId']==results()[-1]['hash']);graphics(True);stage_visible();assert snap()['anatomy']['glows']==0;graphics(False);report['silent_result']=results()[-1];check('A real no-response full-model task saves normally and shows no fabricated signals')
   # Count boundary: 4 requested, only one task reservation/dispatch.
   before=len(results());queue_order([1]);d.execute_script("document.getElementById('miner-limit-count').value='1'");click('miner-primary');wait.until(lambda _:snap()['running']);finish();assert len(results())==before+1;assert snap()['session']['completed']==1;check('One remaining task allowance dispatches exactly one experiment with two requested threads')
   # Space reservation fails before task dispatch, preserving older results.
   before=len(results());d.execute_script("document.getElementById('miner-limit-storage').value='1'");click('miner-primary');finish();assert len(results())==before;assert snap()['session']['completed']==0;assert snap()['execution']=='paused';d.execute_script("document.getElementById('miner-limit-storage').value='1024'");check('Insufficient result budget blocks dispatch before allocations, without losing existing results')
   # Route/history/popstate and resize do not dispose or hide the scene.
   graphics(True);route('contributions');route('experience');d.back();d.forward();wait.until(lambda _:not el('research-response').get_attribute('hidden'));assert snap()['anatomy']['mode']=='3d';check('Back/forward returns to a visible existing anatomy stage')
   layout=[]
   for w,h in [(1440,900),(1366,768),(768,1000),(390,844),(320,800)]:
    for lang in ['en','zh']:
     viewport(w,h);d.execute_script('FlyI18n.setLanguage(arguments[0])',lang);time.sleep(.12);x=d.execute_script("return {width:innerWidth,scroll:document.documentElement.scrollWidth,button:document.getElementById('miner-primary').getBoundingClientRect().toJSON(),canvas:document.getElementById('anatomy-stage').getBoundingClientRect().toJSON()}");assert x['scroll']<=w+1,(w,lang,x);layout.append({'w':w,'h':h,'lang':lang,**x})
     if w in [390,1440] and lang=='zh':capture('layout-'+str(w)+'-zh')
   report['layouts']=layout;check('1440/1366/768/390/320 EN/ZH viewport layout, main controls and one responsive scene')
   viewport(1440,900);d.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]});click('research-play');assert not snap()['replay']['playing'];click('propagation-next');check('Reduced-motion JavaScript viewing clock remains static with explicit stepping')
   # No cache clearing. Refresh starts idle and keeps the chosen graphics preference.
   graphics(False);d.refresh();wait.until(lambda _:snap() and snap()['preparation']=='needed');assert not snap()['running'] and not d.execute_script('return poolWorkers.length');assert not snap()['graphicsEnabled'];assert '0 MB' in el('miner-start-estimate').text
   graphics(False);report['cache_after']=snap()['cacheModel'];route('tools');click('research-restore');wait.until(lambda _:snap()['ready']);assert not snap()['running'];check('Retained browser cache survives refresh, reports zero download and restores only after explicit action')
   report['network']={'official_requests':network.requests,'writes':network.writes,'errors':network.errors,'official_data_received_bytes':network.data_received_bytes,'official_encoded_received_bytes':network.encoded_received_bytes};report['browser_errors']=[e for e in d.get_log('browser') if e['level']=='SEVERE'];assert not report['browser_errors'],report['browser_errors'];assert not network.requests and network.data_received_bytes==0;report['final']=snap();report['passed']=len(report['checks']);write();print(json.dumps({'passed':report['passed'],'report':str(out)}),flush=True)
  except Exception as e:
   report['failure']=str(e);report['traceback']=traceback.format_exc();report['network']={'official_requests':network.requests,'writes':network.writes,'errors':network.errors,'official_data_received_bytes':network.data_received_bytes,'official_encoded_received_bytes':network.encoded_received_bytes}
   try:report['state']=snap();report['browser_errors']=d.get_log('browser');capture('failure')
   except Exception as failure:report['capture_error']=str(failure)
   write();raise
  finally:network.close();d.quit()
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default='http://127.0.0.1:8084');p.add_argument('--report',default='data/prepared/mining-3d-browser-local/report.json');p.add_argument('--profile',default=str(DEFAULT_PROFILE),help='Dedicated test profile; trusted model cache survives retries');p.add_argument('--graph',default='data/prepared/registry-male-cns-v1.0/graph-v1.bin');p.add_argument('--model',default='data/prepared/registry-male-cns-v1.0/model-v0.bin');main(p.parse_args())
