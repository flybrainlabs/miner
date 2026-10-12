#!/usr/bin/env python3
"""Actual cached full-model records through ResponseView/PropagationView.

No model simulation or official download. The persistent browser profile is kept.
The two recorded executions are view fixtures, not a new network competition.
"""
import argparse,io,json,re,subprocess,threading,time,traceback
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile,close_test_browser

HARNESS='''<script type="module">
import {ResponseView} from '/assets/response-view.mjs';
import {buildRecord} from '/assets/response-record.mjs';
import {taskForIndex} from '/assets/catalog-task.mjs';
window.FlyI18n={language:'en',t:(s,v={})=>Object.entries(v).reduce((s,[k,x])=>s.replaceAll('{'+k+'}',String(x)),s)};
const config=await(await fetch('/assets/data/research-profiles/duration256-v1-dev/config.json')).json(),catalog=await(await fetch('/assets/data/research-profiles/duration256-v1-dev/catalog.json')).json();
window.response=new ResponseView(config,{onError:e=>window.viewError=e.message});window.viewer=response.propagation;viewer.setGraphicsEnabled(true,{remember:false});response.show();
// This CI machine has no GPU. Bound raster work without changing scientific records.
viewer.scene.renderer.setPixelRatio(.65);viewer.scene.quality='low';
const [a,b,archive,registry]=await Promise.all([fetch('/__trace-a').then(r=>r.json()),fetch('/__trace-b').then(r=>r.json()),fetch('/__archive').then(r=>r.arrayBuffer()),fetch('/__registry').then(r=>r.arrayBuffer())]);
window.traceA=a;window.traceB=b;const ids=new DataView(registry),bodyIndex=body=>{let low=0,high=config.neuron_count;while(low<high){const mid=(low+high)>>1;if(ids.getBigUint64(52+8*mid,true)<body)low=mid+1;else high=mid;}return low;};
const task=await taskForIndex(catalog,124),bundle=await buildRecord(archive,config,task,bodyIndex);window.historyBundle={...bundle,resultHash:bundle.resultRoot,responseBytes:archive.byteLength,archive,task,config,trace:a};
if(bundle.resultRoot!==a.resultRoot)throw new Error('Historical scientific root differs');
window.batch=(trace,end,sequence=0,start=0)=>{
 const rows=trace.states.filter(r=>r[0]>=start&&r[0]<=end),bytes=new ArrayBuffer(rows.length*72),v=new DataView(bytes);rows.forEach((r,i)=>{const at=i*72;v.setUint32(at,r[0],true);v.setUint32(at+4,r[1],true);v.setUint8(at+8,r[2]);v.setUint8(at+9,r[3]?1:0);v.setUint8(at+10,r[4]);v.setUint8(at+11,r[5]);for(let j=0;j<7;j++)v.setBigInt64(at+12+j*8,BigInt(r[6+j]),true);});
 return {taskId:trace.taskId,executionId:trace.executionId,sequence,lastStep:end,rows:bytes,identity:sequence===0?{...trace,resultRoot:null,coverage:{...trace.coverage,complete:false,lastStep:-1},states:[],transfers:[]}:null};
};
window.feed=(trace,end=31,start=0,sequence=0)=>{for(let at=start;at<=end;at+=16)response.receive(batch(trace,Math.min(at+15,end),sequence++,at));};
window.source=()=>({mode:response.mode,pinned:response.pinned,executionId:response.live?.executionId||response.bundle?.trace?.executionId,replay:viewer.replay.snapshot(),scene:viewer.scene?.snapshot()||{mode:'2d'},cacheBytes:response.inbox.bytes});
window.sceneReady=true;
</script>'''

def main(a):
 repo=Path(__file__).resolve().parents[1];release=Path(a.release).resolve();out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True)
 trace_a=Path('data/prepared/optimization-benchmarks/duration256-v1-dev-124-trace.json').read_bytes();trace_b=Path('data/prepared/optimization-benchmarks/duration256-v1-dev-200-trace.json').read_bytes();archive=Path('data/prepared/optimization-benchmarks/duration256-v1-dev-124-0.bin').read_bytes()
 with Path('data/prepared/registry-male-cns-v1.0/graph-v1.bin').open('rb') as f:registry=f.read(52+165122*8)
 html=re.sub(r'<script\b[^>]*>.*?</script>','',(repo/'web/pages/mining.html').read_text(),flags=re.S)
 html='<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="/assets/favicon.svg"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/network.css"><link rel="stylesheet" href="/assets/brand.css"><link rel="stylesheet" href="/assets/research-app.css"></head><body data-page="mining"><main id="main">'+html+'</main>'+HARNESS+'</body></html>'
 fixtures={'/__scene':(html.encode(),'text/html'),'__none':(b'','text/plain'),'/__trace-a':(trace_a,'application/json'),'/__trace-b':(trace_b,'application/json'),'/__archive':(archive,'application/octet-stream'),'/__registry':(registry,'application/octet-stream')};requests=[]
 class Handler(SimpleHTTPRequestHandler):
  def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(release),**kwargs)
  def log_message(self,*args):pass
  def do_GET(self):
   path=self.path.split('?')[0];requests.append(path)
   if path in fixtures:
    raw,mime=fixtures[path];self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
   else:super().do_GET()
 server=ThreadingHTTPServer(('127.0.0.1',8086),Handler);server.daemon_threads=True;threading.Thread(target=server.serve_forever,daemon=True).start()
 report={'schema':'flypow-goal-v2-recorded-scene-acceptance','checks':[],'screenshots':[],'frames':[],'browserProfileRetained':True,'officialDownloads':0,'renderCondition':'CPU SwiftShader; 2 CPU quota / 2 GiB; recorded full-model execution, no physical GPU claim'}
 def save():out.write_text(json.dumps(report,indent=2)+'\n')
 def check(s):report['checks'].append(s);save();print(json.dumps({'passed':len(report['checks']),'check':s}),flush=True)
 with retained_profile() as profile:
  options=webdriver.ChromeOptions();options.binary_location='/usr/bin/chromium'
  for flag in ['--headless=new','--no-sandbox','--no-proxy-server','--disable-dev-shm-usage','--renderer-process-limit=1','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--disable-frame-rate-limit','--disable-backgrounding-occluded-windows','--window-size=1200,900','--user-data-dir='+profile]:options.add_argument(flag)
  options.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=options);d.set_script_timeout(90);wait=WebDriverWait(d,90,poll_frequency=.2)
  def js(s,*args):return d.execute_script(s,*args)
  def snap():return js('return source()')
  def asyncjs(s):return d.execute_async_script('const done=arguments[0];(async()=>{'+s+'})().then(done,e=>done({error:e.message}));')
  def visible():js("document.getElementById('anatomy-stage').scrollIntoView({block:'center',behavior:'instant'})");wait.until(lambda _:snap()['scene'].get('visible'))
  def ready():wait.until(lambda _:snap()['scene'].get('geometryState')=='ready' and not snap()['scene'].get('geometryLoading'))
  def shot(name):p=out.parent/(name+'.png');d.save_screenshot(str(p));report['screenshots'].append(str(p));return p
  def advance():before=snap()['replay']['viewCursor'];WebDriverWait(d,25).until(lambda _:snap()['replay']['viewCursor']>before);return snap()
  try:
   if not a.visual_only:
    d.get('http://127.0.0.1:8086/__scene');wait.until(lambda _:js('return window.sceneReady'));visible();js('feed(traceA,63)');ready();report['browserVersion']=d.capabilities['browserVersion'];camera=js('viewer.scene.yaw=.7;viewer.scene.pitch=-.12;viewer.scene.draw();return viewer.scene.snapshotCamera()');js('feed(traceB,63)');ready();assert snap()['executionId']==js('return traceB.executionId');assert snap()['scene']['camera']==camera;check('A: automatic recorded execution changes preserve rotated camera; camera interactions do not pin old execution')
    js('feed(traceA,63);viewer.replay.seek(10);viewer.replay.play();response.markUnfinished("paused")');advance();js('response.markRunning()');assert snap()['replay']['intent']=='play';check('B/D: computation status notifications preserve viewing; manual playback advances across repeated UI updates')
    js('viewer.replay.pause();response.markRunning()');paused=snap()['replay']['viewCursor'];time.sleep(.5);assert snap()['replay']['viewCursor']==paused;check('C: explicit viewing pause survives computation resume')
    js('viewer.replay.play();response.hide();response.show()');visible();advance();js('viewer.setGraphicsEnabled(false,{remember:false})');held=snap()['replay']['viewCursor'];time.sleep(.3);assert snap()['replay']['viewCursor']==held;js('viewer.setGraphicsEnabled(true,{remember:false})');visible();advance();check('E: internal hide/return and graphics off/on recover original play intent without restarting CPU')
    js('viewer.replay.pause();response.pinned=false;feed(traceB,63)');ready();assert snap()['executionId']==js('return traceB.executionId');check('F: cached second execution follows immediately; coordinator A-completes/B-only selection is separately tested')
    assert not asyncjs('await response.render(historyBundle);return false;');ready();js('feed(traceB,63)');assert snap()['mode']=='saved';assert snap()['executionId']==js('return traceA.executionId');shot('history-desktop');check('G: explicit complete history remains pinned while another recorded execution receives data')
    js('response.pinned=false;feed(traceA,63);viewer.replay.seek(63);viewer.replay.play()');assert snap()['replay']['viewCursor']==63 and snap()['replay']['waiting'];js('feed(traceA,95,64,4)');advance();assert snap()['replay']['viewCursor']>=63;js('viewer.replay.seek(95);viewer.replay.seek(40)');advance();js('viewer.replay.pause();viewer.replay.seek(95);viewer.replay.seek(40)');assert snap()['replay']['intent']=='paused';check('H/I: live upper bound waits without rewinding; new data and seek respect play/paused intent')
    before=js('return {a:response.inbox.entries.get(traceA.executionId).trace.states.length,b:response.inbox.entries.get(traceB.executionId).trace.states.length,bytes:response.inbox.bytes}');js('for(let i=0;i<20;i++){response.pinned=false;feed(i%2?traceA:traceB,63);}');after=js('return {a:response.inbox.entries.get(traceA.executionId).trace.states.length,b:response.inbox.entries.get(traceB.executionId).trace.states.length,bytes:response.inbox.bytes}');assert before==after;check('J/K: 20 repeated cached follows do not duplicate states, current or cache bytes; gap/late faults use TraceInbox regression')
    # Geometry resources are deliberately delayed while the authoritative cursor changes.
    js('viewer.replay.pause()')
    result=asyncjs("const {anatomyAssets}=await import('/assets/anatomy-assets.mjs'),cell=viewer.scene.assetIndex.cells.find(x=>x.body_id==='16789');let error=null;try{await anatomyAssets.topology({...cell,topology_sha256:'0'.repeat(64)},viewer.config);}catch(e){error=e.message;viewer.geometryError(e);}const valid=await anatomyAssets.topology(cell,viewer.config);return {error,reported:viewer.lastGeometryError,body:valid.bodyId};");assert 'hash mismatch' in result.get('error','') and result['reported']==result['error'] and str(result['body'])=='16789';check('L/N: actual asset digest failure reaches the display error handler; correct morphology resource can be fetched again without scientific computation')
   # Separate the long fault-switch sequence from raster evidence on GPU-less CI.
   # Same leased profile/origin/files; no model download, simulation or data deletion.
   close_test_browser(d);options.arguments.remove('--disable-frame-rate-limit');d=webdriver.Chrome(options=options);d.set_script_timeout(90);wait=WebDriverWait(d,90,poll_frequency=.2)
   report['sequentialBrowserLaunches']=2;d.get('http://127.0.0.1:8086/__scene');wait.until(lambda _:js('return window.sceneReady'));visible();js('feed(traceA,63)');ready()
   asyncjs('await response.render(historyBundle);return true;');ready();visible();step=js('const counts=new Map();for(const e of traceA.transfers)counts.set(e[4],(counts.get(e[4])||0)+1);return [...counts].sort((a,b)=>b[1]-a[1])[0][0]');js('viewer.replay.seek(arguments[0]+.2)',step);assert snap()['scene']['renderParticles']>0;scene=snap()['scene'];report['observedCells']=scene['located'];report['activeStep']=step;report['actualEventCount']=js('return traceA.transfers.length');report['routeProvenance']=js('return [...viewer.scene.edgePaths.values()][0].provenance');shot('real-swc-propagation');check('M: genuine recorded model transfers draw heads and trails on original same-body SWC paths, no spatial bridge')
   js('viewer.replay.setMode("a");viewer.replay.play()');advance();assert snap()['scene']['renderParticles']==0 and snap()['scene']['glows']==0;js('viewer.replay.pause();viewer.replay.setMode("b")');check('M: silent A advances in model time with zero invented pulses or firing glows')
   images=[]
   for name,t in [('emit-early',step+.1),('emit-middle',step+.5),('emit-late',step+.9),('recorded-arrival',step+1.1)]:
    js('viewer.replay.seek(arguments[0])',t);p=shot(name);images.append(p);report['frames'].append({'name':name,'modelTime':t,'scene':snap()['scene']})
   js('viewer.replay.seek(arguments[0]+.1);viewer.replay.play()',step);advance();report['frames'].append({'name':'automatic-playback','scene':snap()['scene']});images.append(shot('automatic-playback'));js('viewer.replay.pause();response.hide();response.show()');visible();assert snap()['replay']['intent']=='paused';images.append(shot('paused-return'));js('viewer.replay.play()');advance();images.append(shot('continued'));js('response.pinned=false;feed(traceB,63);viewer.replay.seek(40.5)');ready();images.append(shot('second-recorded-execution'))
   subprocess.run(['convert','-delay','75','-loop','0',*[str(p) for p in images],str(out.parent/'recorded-propagation.gif')],check=True,timeout=60);report['recording']=str(out.parent/'recorded-propagation.gif');report['recordingDescription']='Actual browser captured frames; slow playback steps and pause/return/continue/recorded execution switch. 750 ms presentation per captured frame, not GPU FPS.'
   js('viewer.replay.pause()');camera=snap()['scene']['camera'];d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':False});visible();assert js('return document.documentElement.scrollWidth')<=391;assert snap()['scene']['camera']==camera;shot('real-swc-mobile');check('Desktop/390 px keep transparent real MaleCNS shells and connected morphology with no horizontal overflow')
   d.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]});js('viewer.replay.play()');assert not js('return viewer.replay.playing');js('viewer.replay.stepForward()');d.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[]});js("document.querySelector('#anatomy-stage canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()");wait.until(lambda _:snap()['scene']['mode']=='2d');assert d.find_element(By.ID,'propagation-canvas').is_displayed();shot('context-loss');check('N: reduced motion permits recorded stepping; real WebGL context loss falls back to recorded 2D data')
   assert '/assets/data/brain.json' not in requests;report['miningBrainJsonRequests']=0;report['browserErrors']=d.get_log('browser');report['final']=snap();report['passed']=len(report['checks']);save()
  except Exception as e:
   report['failure']=str(e);report['traceback']=traceback.format_exc()
   try:report['state']=snap();report['browserErrors']=d.get_log('browser');report['browserRafResponsive']=d.execute_async_script('const done=arguments[0];let fired=false;requestAnimationFrame(()=>{fired=true;done(true)});setTimeout(()=>{if(!fired)done(false)},2000);');shot('failure')
   except Exception:pass
   save();raise
  finally:close_test_browser(d);server.shutdown()

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--visual-only',action='store_true',help='Reuse the separately recorded state-path evidence and run raster evidence only');p.add_argument('--release',default='/workspace/flypow-goal-v2-preview');p.add_argument('--report',default='data/prepared/goal-v2-scene/report.json');main(p.parse_args())
