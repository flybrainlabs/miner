#!/usr/bin/env python3
"""Mobile-capability rendering checks using retained recorded scientific data.

Chromium runs on this server's software GPU; touch and missing browser/GPU
features are explicitly emulated. This does not claim a physical Android test.
No model preparation, simulation, official download, or browser-data deletion.
"""
import argparse,json,re,threading,time,traceback
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile,close_test_browser
from e2e_official_download import BrowserNetwork

FAULTS={
 'old-abort':"delete AbortSignal.prototype.throwIfAborted;",
 'webgl1':"window.__canvasContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:window.__canvasContext.call(this,kind,...args);};delete AbortSignal.prototype.throwIfAborted;",
 'limited-buffers':"window.__canvasContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,attributes,...args){return /webgl/.test(kind)&&(attributes?.antialias||attributes?.powerPreference==='low-power')?null:window.__canvasContext.call(this,kind,attributes,...args);};",
 'no-webgl':"window.__canvasContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/.test(kind)?null:window.__canvasContext.call(this,kind,...args);};",
 'asset-failure':"window.__fetch=window.fetch;window.fetch=(path,...args)=>String(path).includes('/data/mining-anatomy.json')?Promise.resolve(new Response('',{status:503})):window.__fetch(path,...args);",
 'stale-index':"window.__fetch=window.fetch;window.__staleIndexHits=0;window.fetch=(path,...args)=>{const p=String(path);if(p.includes('/data/mining-anatomy.json')&&!p.includes('sha256=')){window.__staleIndexHits++;return window.__fetch('/__old-index');}return window.__fetch(path,...args);};",
}

def main(a):
 repo=Path(__file__).resolve().parents[1];out=a.report;out.parent.mkdir(parents=True,exist_ok=True)
 report={'schema':'flypow-mobile-3d-compatibility-v1','checks':[],'states':{},'profileRetained':True,'modelSimulation':False,'physicalAndroidTest':False,'renderEnvironment':'Chromium / CPU SwiftShader; 390px, touch, Android Chrome UA and injected capability faults'}
 def save():out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 def check(name):report['checks'].append(name);save();print(json.dumps({'passed':len(report['checks']),'check':name}),flush=True)
 body=re.sub(r'<script\b[^>]*>.*?</script>','',(repo/'web/pages/mining.html').read_text(),flags=re.S)
 html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/research-app.css"><main>'+body+'</main>'+'''<script type="module">
 import {PropagationView} from '/assets/propagation-view.mjs';
 const config=await(await fetch('/assets/data/research-profiles/duration256-v1-dev/config.json')).json();
 window.viewer=new PropagationView({config,t:(s,v={})=>Object.entries(v).reduce((s,[k,x])=>s.replaceAll('{'+k+'}',String(x)),s)});
 viewer.setGraphicsEnabled(true,{remember:false});await viewer.scene?.ready;
 if(viewer.scene)viewer.scene.renderer.setPixelRatio(.65);
 window.recordedTrace=await(await fetch('/__trace')).json();window.sceneReady=true;
 </script>'''
 trace=(repo/'data/prepared/optimization-benchmarks/duration256-v1-dev-124-trace.json').read_bytes()
 old_index=a.old_index.read_bytes() if a.cache_only else None
 if old_index is not None:
  assert json.loads(old_index)['schema']=='flypow-mining-anatomy-v1'
  assert old_index!=(a.release/'assets/data/mining-anatomy.json').read_bytes()
 requests=[]
 class Handler(SimpleHTTPRequestHandler):
  def __init__(self,*args,**kw):super().__init__(*args,directory=str(a.release),**kw)
  def log_message(self,*args):pass
  def end_headers(self):self.send_header('Cache-Control','no-cache');super().end_headers()
  def do_GET(self):
   path=self.path.split('?')[0];requests.append(path)
   if path in ['/__mobile','/__trace'] or path=='/__old-index' and old_index is not None:
    raw=html.encode() if path=='/__mobile' else old_index if path=='/__old-index' else trace;self.send_response(200);self.send_header('Content-Type','text/html' if path=='/__mobile' else 'application/json');self.end_headers();self.wfile.write(raw)
   else:super().do_GET()
 server=ThreadingHTTPServer(('127.0.0.1',8087),Handler);server.daemon_threads=True
 threading.Thread(target=server.serve_forever,daemon=True).start()
 with retained_profile() as profile:
  opt=webdriver.ChromeOptions();opt.binary_location='/usr/bin/chromium'
  for x in ['--headless=new','--no-sandbox','--no-proxy-server','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--renderer-process-limit=1','--user-data-dir='+profile,'--window-size=1200,1000']:opt.add_argument(x)
  opt.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=opt);d.set_script_timeout(90)
  net=BrowserNetwork(d);net.block_official=True;d.execute_cdp_cmd('Network.enable',{});d.execute_cdp_cmd('Network.setCacheDisabled',{'cacheDisabled':True});d.execute_cdp_cmd('Network.setBlockedURLs',{'urls':['https://storage.googleapis.com/*']})
  wait=WebDriverWait(d,120,poll_frequency=.3)
  def js(s,*args):return d.execute_script(s,*args)
  def asyncjs(s):return d.execute_async_script('const done=arguments[0];(async()=>{'+s+'})().then(done,e=>done({error:e.message}));')
  def snap():return js('return viewer.scene?.snapshot()||{mode:"2d",error:viewer.lastDisplayError}')
  def visible():js("document.getElementById('anatomy-stage').scrollIntoView({block:'center',behavior:'instant'})");wait.until(lambda _:snap().get('visible'))
  def ready():wait.until(lambda _:snap().get('geometryState')=='ready' and not snap().get('geometryLoading'))
  def inject(source):return d.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':source})['identifier']
  def uninject(key):d.execute_cdp_cmd('Page.removeScriptToEvaluateOnNewDocument',{'identifier':key})
  def page(fault=None):
   key=inject(FAULTS[fault]) if fault else None
   try:d.get('http://127.0.0.1:8087/__mobile');wait.until(lambda _:js('return window.sceneReady'))
   finally:
    if key:uninject(key)
  def shot(name):p=out.parent/(name+'.png');d.save_screenshot(str(p));return str(p)
  d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':2,'mobile':True})
  d.execute_cdp_cmd('Emulation.setTouchEmulationEnabled',{'enabled':True,'maxTouchPoints':5})
  d.execute_cdp_cmd('Network.setUserAgentOverride',{'userAgent':'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36'})
  report['browserVersion']=d.capabilities['browserVersion']
  try:
   if a.cache_only:
    page('stale-index');visible();ready();assert snap()['mode']=='3d' and snap()['located']==4 and js('return window.__staleIndexHits')==0
    result=asyncjs("const {AnatomyAssetStore}=await import('/assets/anatomy-assets.mjs');const {MINING_ANATOMY_INDEX_SHA256:h}=await import('/assets/mining-anatomy-index.mjs');const s=new AnatomyAssetStore(),before=window.__staleIndexHits;let rejected=false;try{await s.get('/assets/data/mining-anatomy.json','0'.repeat(64));}catch(e){rejected=e.message.includes('hash mismatch');}const current=await s.get('/assets/data/mining-anatomy.json',h);return {rejected,schema:current.schema,staleHits:window.__staleIndexHits-before};")
    assert result['rejected'] and result['schema']=='flypow-mining-anatomy-v2' and result['staleHits']==0
    report['cacheResult']=result;check('A genuinely old V1 cached index cannot shadow V2: digest-versioned display URLs load original target shapes; incorrect digests are still rejected')
   elif not a.public_only:
    page('old-abort');visible();ready();assert snap()['mode']=='3d' and snap()['located']==4
    abort=asyncjs("const {anatomyAssets}=await import('/assets/anatomy-assets.mjs');const c=new AbortController();c.abort();try{await anatomyAssets.get('/never-request',null,c.signal);return false;}catch(e){return e.name==='AbortError';}")
    assert abort and '/never-request' not in requests
    check('Missing AbortSignal.throwIfAborted still loads four real initial morphologies; cancellation still rejects before any request')
    page('webgl1');visible();ready();assert snap()['renderer']=='webgl1' and snap()['rendererRevision']=='162'
    js('viewer.load({trace:recordedTrace,identity:recordedTrace.resultRoot})');ready()
    step=js('const counts=new Map();for(const e of recordedTrace.transfers)counts.set(e[4],(counts.get(e[4])||0)+1);return [...counts].sort((a,b)=>b[1]-a[1])[0][0]');js('viewer.replay.seek(arguments[0]+.5)',step)
    assert snap()['located']==32 and snap()['renderParticles']>0 and snap()['geometryErrors']==0
    report['states']['webgl1']=snap();report['webgl1Screenshot']=shot('webgl1-mobile-real-record')
    version=js('const gl=viewer.scene.renderer.getContext();return gl.getParameter(gl.VERSION)');assert version.startswith('WebGL 1.0');report['webgl1Version']=version
    check('Actual WebGL 1 draws 32 identity-checked original SWC morphologies and real recorded propagation without WebGL 2 or the modern abort method')
    camera=snap()['camera'];r=js("const r=document.getElementById('anatomy-stage').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}")
    def touch(kind,points):d.execute_cdp_cmd('Input.dispatchTouchEvent',{'type':kind,'touchPoints':points})
    touch('touchStart',[{'x':r['x'],'y':r['y'],'id':1}]);touch('touchMove',[{'x':r['x']+35,'y':r['y']+20,'id':1}]);touch('touchEnd',[])
    assert snap()['camera']['yaw']!=camera['yaw'] and snap()['camera']['pitch']!=camera['pitch']
    zoom=snap()['camera']['zoom'];touch('touchStart',[{'x':r['x']-30,'y':r['y'],'id':1},{'x':r['x']+30,'y':r['y'],'id':2}]);touch('touchMove',[{'x':r['x']-65,'y':r['y'],'id':1},{'x':r['x']+65,'y':r['y'],'id':2}]);touch('touchEnd',[])
    assert snap()['camera']['zoom']<zoom
    check('Real touch input rotates in both directions and two-finger pinch changes the 3D camera without browser gesture cancellation')
    js('viewer.replay.pause();viewer.setGraphicsEnabled(false,{remember:false})');held=snap()['renderCount'];cursor=js('return viewer.replay.time');js('viewer.scene.draw()');time.sleep(.3);assert snap()['renderCount']==held and js('return viewer.replay.time')==cursor
    js('viewer.setGraphicsEnabled(true,{remember:false})');visible();assert snap()['renderCount']>held
    check('Graphics off stops actual rendering and viewing; graphics on retains recorded data and the user camera')
    page('limited-buffers');visible();ready();assert snap()['renderer']=='webgl2' and snap()['antialias'] is False
    check('A browser rejecting antialias or low-power context attributes automatically starts WebGL 2 with smaller default buffers')
    page('no-webgl');assert snap()['mode']=='2d' and js('return viewer.fallback');assert d.find_element(By.ID,'anatomy-error').is_displayed();assert 'WebGL' in d.find_element(By.ID,'anatomy-error').text
    js('viewer.load({trace:recordedTrace,identity:recordedTrace.resultRoot});viewer.replay.seek(36.5)');assert d.find_element(By.ID,'propagation-canvas').is_displayed();cursor=js('return viewer.replay.time')
    js('HTMLCanvasElement.prototype.getContext=window.__canvasContext');result=asyncjs('await viewer.retryDisplay();return !!viewer.scene;');assert result is True;visible();ready();assert js('return viewer.replay.time')==cursor and not d.find_element(By.ID,'anatomy-error').is_displayed()
    check('When both WebGL versions are unavailable, truthful Canvas fallback remains usable; retry actually restores 3D and the recorded cursor')
    page('asset-failure');assert snap()['mode']=='2d' and 'asset unavailable' in js('return viewer.lastDisplayError')
    js('window.fetch=window.__fetch');assert asyncjs('await viewer.retryDisplay();return !!viewer.scene;') is True;visible();ready();assert snap()['located']==4 and not js('return viewer.lastDisplayError')
    check('A failed display-resource request reports its cause and retry reloads original target shapes without changing scientific data')
    page();visible();ready();assert snap()['rendererRevision']=='180';camera=snap()['camera'];js('viewer.scene.renderer.getContext().getExtension("WEBGL_lose_context").loseContext()');wait.until(lambda _:snap()['mode']=='2d')
    assert asyncjs('await viewer.retryDisplay();return !!viewer.scene;') is True;visible();ready();assert snap()['renderer']=='webgl2' and snap()['camera']==camera
    check('Modern WebGL 2 stays on r180; real context loss can be retried with the camera retained')
    errors=[e for e in d.get_log('browser') if e['level']=='SEVERE'];assert not errors,errors
    report['unexpectedErrors']=errors
   if a.public_url:
    def workspace():return js('return window.flypowWorkspace?.snapshot()')
    for fault in [None,'webgl1']:
     key=inject(FAULTS[fault]) if fault else None
     original_graphics=None
     try:
      d.get(a.public_url.rstrip('/')+'/mining/');wait.until(lambda _:workspace())
      before=workspace();original_graphics=before['graphicsEnabled']
      js("const x=document.getElementById('miner-graphics');x.checked=true;x.dispatchEvent(new Event('change'));document.querySelector('[data-miner-view=experience]').click();document.getElementById('anatomy-stage').scrollIntoView({block:'center',behavior:'instant'})")
      wait.until(lambda _:workspace()['anatomy'].get('geometryState')=='ready');s=workspace();expected='webgl1' if fault else 'webgl2'
      assert s['anatomy']['renderer']==expected and s['anatomy']['located']==4 and s['anatomy']['geometryErrors']==0
      assert not s['running'] and s['cacheModel']==before['cacheModel'] and s['saved']==before['saved']
      assert js('return document.documentElement.scrollWidth')<=391
      report['states']['public-'+expected]={'anatomy':s['anatomy'],'cacheModelRetained':s['cacheModel'],'savedResultCount':len(s['saved'])}
      report['public-'+expected+'Screenshot']=shot('public-'+expected+'-390')
      check('Public HTTPS Android Chrome emulation initializes '+expected+' with original anatomy, no horizontal overflow or CPU startup; model and saved results retained')
     finally:
      if original_graphics is not None:js("const x=document.getElementById('miner-graphics');x.checked=arguments[0];x.dispatchEvent(new Event('change'))",original_graphics)
      if key:uninject(key)
    errors=[e for e in d.get_log('browser') if e['level']=='SEVERE'];assert not errors,errors;report['publicUnexpectedErrors']=errors
    key=inject(FAULTS['webgl1'])
    try:
     d.get(a.public_url.rstrip('/')+'/atlas/');wait.until(lambda _:js("const h=document.getElementById('atlas-viewer');return h?.dataset.ready==='true'&&h.querySelector('canvas')?.dataset.renderer==='webgl1'"))
     assert js("return document.getElementById('atlas-viewer').dataset.contextReady")== 'true'
     report['atlasBody']=js("return document.getElementById('atlas-viewer').dataset.bodyId")
     check('Public Atlas shares the compatible renderer: an original neuron and official brain outline load through actual WebGL 1')
    finally:uninject(key)
   report['officialRequests']=len(net.requests);report['officialBytes']=net.data_received_bytes;report['networkWrites']=len(net.writes);report['observerErrors']=net.errors
   assert not net.requests and not net.writes and not net.errors
   check('Zero official data requests/bytes, network writes or unexpected browser errors; fixed profile and all browser data retained')
   report['passed']=len(report['checks']);save()
  except Exception as e:
   report['failure']=str(e);report['traceback']=traceback.format_exc()
   try:report['failureScreenshot']=shot('failure');report['failureConsole']=d.get_log('browser')
   except Exception:pass
   save();raise
  finally:net.close();close_test_browser(d);server.shutdown()

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--release',type=Path,default=Path('/workspace/flypow-goal-v2-preview'));p.add_argument('--report',type=Path,required=True);p.add_argument('--public-url');p.add_argument('--public-only',action='store_true');p.add_argument('--cache-only',action='store_true');p.add_argument('--old-index',type=Path,help='Original V1 anatomy JSON for the cache regression only');a=p.parse_args()
 if a.cache_only and not a.old_index:p.error('--cache-only requires --old-index')
 main(a)
