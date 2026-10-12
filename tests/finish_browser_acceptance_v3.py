#!/usr/bin/env python3
"""Finish retained acceptance after an artifact-test fault; never starts CPU."""
import json,time,subprocess
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile,close_test_browser
from e2e_official_download import BrowserNetwork
p=Path('data/prepared/live-current-v3/browser-A/report.json');report=json.loads(p.read_text());report['checks']=list(dict.fromkeys(report['checks']))
with retained_profile() as profile:
 o=webdriver.ChromeOptions();o.binary_location='/usr/bin/chromium'
 for f in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--renderer-process-limit=1','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--user-data-dir='+profile,'--window-size=1440,1050']:o.add_argument(f)
 o.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=o);d.set_script_timeout(180);n=BrowserNetwork(d);wait=WebDriverWait(d,180,poll_frequency=.2)
 js=d.execute_script
 def asyncjs(s,*args):return d.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+s+'})().then(done,e=>done({error:e.message,stack:e.stack}));',*args)
 def snap():return js('return window.flypowWorkspace?.snapshot()')
 def click(i):js('arguments[0].click()',d.find_element(By.ID,i))
 def route(v):js("document.querySelector('[data-miner-view="+v+"]').click()")
 def check(s):
  if s not in report['checks']:report['checks'].append(s)
  p.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'check':s}),flush=True)
 try:
  d.get('http://127.0.0.1:8084/mining/');wait.until(lambda _:snap() and snap()['authorityOnline']);assert not snap()['running']
  asyncjs("const {GoalMiningView}=await import('/assets/goal-mining-view.mjs'),ui=GoalMiningView.prototype.ui;GoalMiningView.prototype.ui=function(...a){window.acceptanceRunner=this.runner;return ui.apply(this,a)};return true;");click('miner-target-sync');wait.until(lambda _:js('return !!window.acceptanceRunner'))
  route('contributions');recovered=[]
  while snap()['goalUi']['pendingOutputs']:
   buttons=d.find_elements(By.CSS_SELECTOR,'[data-recover-trial]');assert buttons;trial=buttons[-1].get_attribute('data-recover-trial');js('arguments[0].click()',buttons[-1]);wait.until(lambda _:not d.find_elements(By.CSS_SELECTOR,'[data-recover-trial="'+trial+'"]'));recovered.append(trial)
  report['recoveredArtifactTestOutputs']=recovered;assert not snap()['running'];check('Refresh resumes existing upload/retained artifact recovery without loading or recomputing the model')
  wait.until(lambda _:next((m['phase'] in ['verifying','revealed','valid'] for m in snap()['goalResults'] if m['candidateId']==report['candidate']['candidateId']),False))
  report['claim']=asyncjs("const m=await acceptanceRunner.store.metadata(arguments[0]);return {claimId:m.claimId,receipt:m.receipt,phase:m.phase};",report['candidate']['candidateId']);report['candidate']['phase']=report['claim']['phase'];check('Existing real browser candidate finishes private upload and reveal after refresh')
  probe=asyncjs(Path('tests/browser_artifact_probe_v3.js').read_text());assert 'error' not in probe,probe;report['artifactRecovery']=probe;check('Two copied real Worker backgrounds/traces survive storage faults, refresh instances, ordered recovery and complete background ZIP')
  frames=report['recordingFrames'][:8];report['recordingFrames']=frames
  subprocess.run(['convert','-delay','25','-loop','0',*frames,str(p.parent/'current-calculation.gif')],check=True,timeout=60);report['recording']=str(p.parent/'current-calculation.gif');report['recordingScope']='First eight actual current Worker frames from preceding uninterrupted calculation; GIF timing is not GPU FPS.'
  route('experience');d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':False});js('window.scrollTo(0,0)');time.sleep(.3);assert js('return document.documentElement.scrollWidth')<=391;d.save_screenshot(str(p.parent/'mobile-390.png'));report['mobileScreenshot']=str(p.parent/'mobile-390.png');check('390px target/start/current-state layout has no horizontal overflow; emulation only')
  before=snap()['viewDiagnostics']['scope'];route('contributions');buttons=d.find_elements(By.CSS_SELECTOR,'[data-candidate-view]');assert buttons;js('arguments[0].click()',buttons[0]);wait.until(lambda _:snap()['artifactSelection']);assert snap()['viewDiagnostics']['scope']==before;check('Historical metrics and downloads remain separate from live observation identity')
  assert snap()['cacheModel'] and not snap()['running'];assert not n.requests;report['browserErrors']=[x for x in d.get_log('browser') if x['level']=='SEVERE'];assert not report['browserErrors'],report['browserErrors'];report['network']={'officialRequests':n.requests,'officialBytes':n.data_received_bytes};report['finalAfterRecovery']=snap();report['recoveryScientificRuns']=0;report['passed']=len(report['checks']);
  for key in ['failure','traceback','uiError','state','failureScreenshot']:report.pop(key,None)
  p.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passed':report['passed'],'newScientificRuns':0}),flush=True)
 finally:n.close();close_test_browser(d)
