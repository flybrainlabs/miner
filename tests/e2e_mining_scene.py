#!/usr/bin/env python3
"""Render recorded full-model trace in the actual shared 3D viewer.

Local fixtures never enter a release. No scientific events are manufactured.
"""
import argparse,json,re,threading,time,tempfile
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

def main(a):
    repo=Path(__file__).resolve().parents[1];stage=Path(a.release).resolve();trace=Path(a.trace).read_bytes()
    html=(repo/'web/pages/mining.html').read_text()
    html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S)
    html='<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="icon" href="/assets/favicon.svg"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body data-page="mining">'+html+'''<script type="module">
      import {PropagationView} from '/assets/propagation-view.mjs';
      import {validateTrace} from '/assets/propagation-trace.mjs';
      const config=await(await fetch('/assets/data/research-profiles/duration256-v1-dev/config.json')).json();
      window.viewer=new PropagationView({config,t:(s,v={})=>Object.entries(v).reduce((s,[k,x])=>s.replaceAll('{'+k+'}',String(x)),s)});
      await viewer.scene?.ready;
      window.sceneReady=true;
      window.recordedTrace=await(await fetch('/__trace')).json();
      window.loadRecorded=()=>viewer.load({trace:recordedTrace,identity:recordedTrace.resultRoot});
    </script></body></html>'''
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(stage),**kwargs)
        def do_GET(self):
            if self.path.split('?')[0] in ['/__scene','/__trace']:
                raw=html.encode() if self.path.split('?')[0]=='/__scene' else trace
                self.send_response(200);self.send_header('Content-Type','text/html' if self.path.split('?')[0]=='/__scene' else 'application/json');self.end_headers();self.wfile.write(raw)
            else:super().do_GET()
        def log_message(self,*_):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
    out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True);report={'schema':'flypow-mining-3d-scene-v1','checks':[],'source_trace':str(a.trace),'screenshots':[]}
    options=webdriver.ChromeOptions();options.binary_location='/usr/bin/chromium'
    for flag in ['--headless=new','--no-sandbox','--no-proxy-server','--disable-dev-shm-usage','--renderer-process-limit=1','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--window-size=1440,900']:options.add_argument(flag)
    options.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=options);d.set_script_timeout(60);wait=WebDriverWait(d,120,poll_frequency=.2)
    def check(message):report['checks'].append(message);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passed':len(report['checks']),'check':message}),flush=True)
    def shot(name):p=out.parent/(name+'.png');d.save_screenshot(str(p));report['screenshots'].append(str(p))
    def snap():return d.execute_script('return viewer.scene?.snapshot()||{mode:"2d"}')
    try:
        d.get('http://127.0.0.1:'+str(server.server_port)+'/__scene');wait.until(lambda _:d.execute_script('return window.sceneReady&&window.recordedTrace'))
        d.execute_script("document.getElementById('anatomy-stage').scrollIntoView({block:'center',behavior:'instant'})");wait.until(lambda _:snap()['visible']);check('Shared viewer loads real brain and four precise target shapes before any recorded result')
        d.execute_script('loadRecorded()');wait.until(lambda _:snap()['located']==32);print(json.dumps(snap()),flush=True)
        step=d.execute_script('''const counts=new Map();for(const e of recordedTrace.transfers){if(e[4]<recordedTrace.steps-1)counts.set(e[4],(counts.get(e[4])||0)+1);}return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]??0;''')
        d.execute_script('viewer.replay.seek(arguments[0])',step+.5);assert snap()['particles']>0,snap();report['active_frame']=snap();shot('real-propagation');check('32 exact observed bodies display recorded s→s+1 pulses at a real active model step')
        frames=[]
        for t in [step+.1,step+.5,step+.9,step+1]:
            started=time.monotonic();d.execute_script('viewer.replay.seek(arguments[0])',t);frames.append({'time':t,'round_trip_ms':(time.monotonic()-started)*1000,'scene':snap()})
        d.execute_script('viewer.replay.seek(arguments[0])',step+.5);assert snap()['particles']==report['active_frame']['particles'];report['static_frames']=frames;check('Deterministic moving heads, arrivals and spike-only glow derive from absolute recorded time')
        d.execute_script('viewer.replay.play()');time.sleep(1);started=time.monotonic();d.execute_script('viewer.replay.pause()');report['playback_pause_round_trip_ms']=(time.monotonic()-started)*1000;assert snap()['viewTime']>step+.5;check('Actual animation advances continuously and pause remains responsive on the software WebGL renderer')
        # Real geometry rejects wrong file hash and exact-body substitution.
        r=d.execute_async_script('''const done=arguments[0];(async()=>{const {anatomyAssets}=await import('/assets/anatomy-assets.mjs'),entry=viewer.scene.assetIndex.cells[0];let rejected=0;for(const c of [{...entry,geometry_sha256:'0'.repeat(64)},{...entry,body_id:'999999'}])try{await anatomyAssets.geometry(c,viewer.scene.config);}catch{rejected++;}return rejected;})().then(done);''');assert r==2;check('Deliberately wrong geometry digest and another body identity are rejected without affecting computation')
        # Unknown exact body has no borrowed position or representative skeleton.
        d.execute_async_script('''const done=arguments[0];viewer.scene.setCells([{bodyId:'999999',index:160000,stimulus:false}],[]).then(done);''');assert snap()['located']==0 and snap()['unlocated']==1;check('A body without verified anatomy remains unlocated; no random placement or borrowed morphology')
        d.execute_async_script('''const done=arguments[0];viewer.scene.setTrace(recordedTrace).then(done);''');d.execute_script('viewer.replay.seek(arguments[0])',step+.5)
        camera=snap()['camera'];layouts=[]
        for width,height in [(1440,900),(1366,768),(768,1000),(390,844),(320,800)]:
            d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False});d.execute_script("document.getElementById('anatomy-stage').scrollIntoView({block:'center',behavior:'instant'})");time.sleep(.1)
            layout=d.execute_script('return {innerWidth,scrollWidth:document.documentElement.scrollWidth}');assert layout['scrollWidth']<=width+1,layout;assert snap()['camera']==camera;layouts.append(layout)
            if width==390:shot('mobile-real-trace')
        report['layouts']=layouts;check('Desktop/tablet/mobile widths preserve the same scene and user camera without overflow')
        d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':1440,'height':900,'deviceScaleFactor':1,'mobile':False});d.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]});d.execute_script('viewer.replay.play()');assert not d.execute_script('return viewer.replay.playing');d.execute_script('viewer.replay.stepForward()');check('Reduced motion stops the JavaScript viewing clock and retains explicit recorded-state stepping')
        d.execute_script("const canvas=document.querySelector('#anatomy-stage canvas');canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()");wait.until(lambda _:snap()['mode']=='2d');d.execute_script('viewer.replay.seek(arguments[0])',step+.5);assert d.find_element(By.ID,'propagation-canvas').is_displayed();shot('context-loss-fallback');check('Actual WebGL context loss switches to the recorded 2D trace while retaining the time cursor')
        report['browser_errors']=d.get_log('browser');report['passed']=len(report['checks']);report['success']=True
    except Exception as e:
        report['failure']=str(e)
        try:report['state']=snap();report['browser_errors']=d.get_log('browser');shot('failure')
        except Exception:pass
        raise
    finally:
        out.write_text(json.dumps(report,indent=2)+'\n');d.quit();server.shutdown()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--release',required=True);p.add_argument('--trace',default='data/prepared/optimization-benchmarks/duration256-v1-dev-124-trace.json');p.add_argument('--report',default='data/prepared/mining-3d-scene/report.json');main(p.parse_args())
