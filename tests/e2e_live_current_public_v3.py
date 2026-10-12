#!/usr/bin/env python3
"""HTTPS frontend acceptance with retained model; backend remains unconfigured.

The short actual Worker run is explicitly offline and is not V2 competition.
"""
import argparse,json,time,subprocess
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile,close_test_browser
from e2e_official_download import BrowserNetwork
def main(a):
 out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True);report={'scope':'Actual public HTTPS frontend; short complete-model offline Worker observation, not network competition','physicalAndroid':False,'profileRetained':True,'checks':[],'competitionServiceDeployed':False}
 def check(s):report['checks'].append(s);out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'passed':len(report['checks']),'check':s}),flush=True)
 with retained_profile() as profile:
  o=webdriver.ChromeOptions();o.binary_location='/usr/bin/chromium'
  for f in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--renderer-process-limit=1','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--user-data-dir='+profile,'--window-size=1440,1400']:o.add_argument(f)
  o.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=o);d.set_script_timeout(90);n=BrowserNetwork(d);w=WebDriverWait(d,180,poll_frequency=.2)
  js=d.execute_script
  def snap():return js('return window.flypowWorkspace?.snapshot()')
  def click(i):js('arguments[0].click()',d.find_element(By.ID,i))
  def route(v):js("document.querySelector('[data-miner-view="+v+"]').click()")
  def shot(name):p=out.parent/(name+'.png');d.save_screenshot(str(p));return str(p)
  try:
   graphics_injection=d.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':"const context=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(k,...a){return k==='webgl2'?null:context.call(this,k,...a)};"})['identifier']
   if a.navigation_only:
    report['scope']='Read-only public navigation regression; no model preparation or scientific computation'
    d.get(a.site.rstrip('/')+'/mining/');w.until(lambda _:snap());assert not snap()['running'];assert snap()['goalUi']['state']=='network-unconfigured';assert not any('/assets/data/brain.json' in x for x in js('return performance.getEntriesByType("resource").map(r=>r.name)'));check('Mining keeps its truthful target state without CPU startup or the homepage brain.json display path')
    d.get(a.site.rstrip('/')+'/atlas/?type=AVLP501');w.until(lambda _:js('return document.getElementById("atlas-viewer")?.dataset.ready==="true"'));assert js('return document.getElementById("atlas-viewer").dataset.bodyId')=='10348';assert js('return document.querySelector("#atlas-viewer canvas").dataset.renderer')=='webgl1';report['atlasScreenshot']=shot('atlas-webgl1');check('Original neuron list still displays body 10348 with WebGL1')
    d.execute_cdp_cmd('Page.removeScriptToEvaluateOnNewDocument',{'identifier':graphics_injection})
    d.get(a.site.rstrip('/')+'/');w.until(lambda _:d.find_element(By.TAG_NAME,'main'));w.until(lambda _:js('return document.querySelector("#brain-home")?.dataset.ready==="true"'));assert not js('return document.querySelector(".status-banner")');report['homeResourcePaths']=js('return performance.getEntriesByType("resource").map(r=>new URL(r.name).pathname)');report['homeScreenshot']=shot('homepage');check('Homepage with normal graphics capability and removed banner remains intact; its existing sample scene is retained')
    report['network']={'officialRequests':n.requests,'officialBytes':n.data_received_bytes};assert not n.requests;report['browserErrors']=[x for x in d.get_log('browser') if x['level']=='SEVERE'];assert not report['browserErrors'],report['browserErrors'];report['passed']=len(report['checks']);out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');return
   d.get(a.site.rstrip('/')+'/mining/');w.until(lambda _:snap());report['browserVersion']=d.capabilities['browserVersion'];assert snap()['goalUi']['state']=='network-unconfigured' and snap()['goalUi']['disabled'];assert js('return document.getElementById("miner-search-mode").value')=='target';assert not snap()['running'];assert not js('return document.getElementById("research-play")||document.getElementById("research-time")');report['targetUnavailableScreenshot']=shot('target-unconfigured');check('Website keeps default target card and truthful unconfigured reason; no silent legacy scheduling or CPU startup')
   assert snap()['cacheModel'],'Retained HTTPS model cache is required; this test cannot download';report['cacheBefore']=True
   js("const x=document.getElementById('miner-search-mode');x.value='offline';x.dispatchEvent(new Event('change'));const threads=document.getElementById('miner-threads');threads.value=1;threads.dispatchEvent(new Event('change'));")
   route('tools');click('research-restore');w.until(lambda _:snap()['ready'] and not snap()['preparationBusy'] and not snap()['actionBusy']);route('experience');check('HTTPS complete model restored from existing OPFS without official downloads')
   js("const x=document.getElementById('miner-graphics');x.checked=true;x.dispatchEvent(new Event('change'));document.getElementById('miner-limit-minutes').value=3;")
   click('miner-primary');w.until(lambda _:snap()['running']);w.until(lambda _:snap()['viewDiagnostics']['renderedStep']>=8);assert snap()['anatomy']['renderer']=='webgl1' and snap()['anatomy']['rendererRevision']=='162';report['current']=snap();report['currentScreenshot']=shot('public-current-webgl1');check('Actual HTTPS Worker complete-state snapshots render with pinned WebGL1 morphology ribbons; offline run is explicitly labelled')
   if a.record:
    frames=[];samples=[];js('document.getElementById("anatomy-stage").scrollIntoView({block:"center"})')
    for i in range(6):
     s=snap();assert s['running'] and s['viewDiagnostics']['maxPendingSlots']<=1;frames.append(shot('current-frame-'+str(i)));samples.append(s);time.sleep(.15)
    gif=out.parent/'current-public-worker.gif';subprocess.run(['convert','-delay','25','-loop','0',*frames,str(gif)],check=True,timeout=60);report['recording']=str(gif);report['recordingFrames']=frames;report['recordingSamples']=samples;report['recordingScope']='Six actual HTTPS current Worker frames, final counterclockwise strip triangles, explicit offline mode. Sampling cadence is not GPU FPS.';check('Final white ribbons recorded from current complete-model computation, with actual scopes/steps and bounded buffers')
   identity=snap()['viewDiagnostics']['scope'];assert identity['roundId'] is None;js("const x=document.getElementById('miner-graphics');x.checked=false;x.dispatchEvent(new Event('change'));");before=snap()['viewDiagnostics']['latestCompletedStep'];w.until(lambda _:snap()['viewDiagnostics']['latestCompletedStep']>before);assert snap()['viewDiagnostics']['pendingSlots']==0;check('Public graphics switch stops display while authorized full-model computation advances')
   click('miner-primary');w.until(lambda _:snap()['paused']);held=snap()['viewDiagnostics']['latestCompletedStep'];time.sleep(.3);assert snap()['viewDiagnostics']['latestCompletedStep']==held;js("const x=document.getElementById('miner-graphics');x.checked=true;x.dispatchEvent(new Event('change'));");time.sleep(.2);assert snap()['paused'];check('Pause and re-enable graphics preserve explicit CPU intent and bounded display slots')
   js('window.confirm=()=>true');click('miner-stop');w.until(lambda _:not snap()['running']);route('settings');click('miner-release');w.until(lambda _:not snap()['ready']);d.refresh();w.until(lambda _:snap());assert not snap()['running'] and snap()['cacheModel'];check('Refresh retains HTTPS model, results and preferences without starting CPU')
   assert not any('/assets/data/brain.json' in x for x in js('return performance.getEntriesByType("resource").map(r=>r.name)'))
   d.get(a.site.rstrip('/')+'/atlas/?type=AVLP501');w.until(lambda _:js('return document.getElementById("atlas-viewer")?.dataset.ready==="true"'));assert js('return document.getElementById("atlas-viewer").dataset.bodyId')=='10348';assert js('return document.querySelector("#atlas-viewer canvas").dataset.renderer')=='webgl1';report['atlasScreenshot']=shot('atlas-webgl1');check('Original neuron list still loads correct body and WebGL1 morphology')
   d.execute_cdp_cmd('Page.removeScriptToEvaluateOnNewDocument',{'identifier':graphics_injection})
   d.get(a.site.rstrip('/')+'/');w.until(lambda _:d.find_element(By.TAG_NAME,'main'));w.until(lambda _:js('return document.querySelector("#brain-home")?.dataset.ready==="true"'));assert not js('return document.querySelector(".status-banner")');check('Homepage with normal graphics capability and removed banner remains intact; mining does not use its existing brain.json sample')
   report['network']={'officialRequests':n.requests,'officialBytes':n.data_received_bytes};assert not n.requests;report['browserErrors']=[x for x in d.get_log('browser') if x['level']=='SEVERE'];assert not report['browserErrors'],report['browserErrors'];report['passed']=len(report['checks']);out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
  finally:n.close();close_test_browser(d)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--site',default='https://flybrain.work');p.add_argument('--report',default='data/prepared/live-current-v3/public-browser/report.json');p.add_argument('--record',action='store_true');p.add_argument('--navigation-only',action='store_true',help='Verify page navigation without repeating completed Worker observations');main(p.parse_args())
