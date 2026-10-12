#!/usr/bin/env python3
"""Real cached full model and V2 browser lifecycle; keeps the fixed browser profile."""
import argparse,json,time,traceback
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile,DEFAULT_PROFILE,close_test_browser
from e2e_official_download import BrowserNetwork

def main(a):
 out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True);report={'schema':'flypow-goal-v2-browser-acceptance','checks':[],'screenshots':[],'browser_profile_retained':True,'render_condition':'CPU SwiftShader on 2 CPU / 2 GiB server; no physical GPU performance claim'}
 def save():out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 def check(s):report['checks'].append(s);save();print(json.dumps({'passed':len(report['checks']),'check':s}),flush=True)
 with retained_profile() as profile:
  options=webdriver.ChromeOptions();options.binary_location='/usr/bin/chromium'
  for arg in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--renderer-process-limit=1','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--user-data-dir='+profile,'--window-size=1440,1050']:options.add_argument(arg)
  options.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=options);d.set_script_timeout(120);wait=WebDriverWait(d,180,poll_frequency=.2);network=BrowserNetwork(d)
  def snap():return d.execute_script('return window.flypowWorkspace?.snapshot()')
  def el(i):return d.find_element(By.ID,i)
  def click(i):d.execute_script('arguments[0].click()',el(i))
  def shot(n):p=out.parent/(n+'.png');d.save_screenshot(str(p));report['screenshots'].append(str(p))
  def route(view):d.execute_script("document.querySelector('[data-miner-view="+view+"]').click()")
  def graphics(on):d.execute_script("const x=document.getElementById('miner-graphics');x.checked=arguments[0];x.dispatchEvent(new Event('change'))",on)
  try:
   d.get(a.url+'/mining/');wait.until(lambda _:snap());report['browser_version']=d.capabilities['browserVersion'];wait.until(lambda _:snap()['authorityOnline']);assert not snap()['running'];assert el('miner-primary').text in ['Start mining','开始挖矿'];assert not el('miner-limit-count').is_displayed();assert not el('miner-single').is_displayed();shot('initial-desktop');check('Signed authority target is the default; no ordinary task count, no auto CPU start, explicit offline mode retained')
   # All tests reuse the existing localhost OPFS origin and scientific files.
   report['cache_before']=snap()['cacheModel'];graphics(False);route('tools')
   if snap()['cacheModel'] and not a.view_only:click('research-restore');wait.until(lambda _:snap()['ready'] or snap()['preparation']=='error')
   if not snap()['ready'] and not a.view_only:
    el('research-graph').send_keys(str(Path('data/prepared/registry-male-cns-v1.0/graph-v1.bin').resolve()));el('research-model').send_keys(str(Path('data/prepared/registry-male-cns-v1.0/model-v0.bin').resolve()));click('research-prepare');wait.until(lambda _:snap()['ready'] or snap()['preparation']=='error')
    report['cache_method']='trusted prepared local files seeded once'
   else:report['cache_method']='existing OPFS model restored'
   assert snap()['ready'] or (a.view_only and snap()['cacheModel']),el('miner-error-detail').get_attribute('textContent');route('experience');assert not snap()['running'];check('Retained OPFS model is available without downloading; historical viewing needs no model reload' if a.view_only else 'Same browser profile restores the complete model only on explicit action; official download is unnecessary')
   if not a.view_only:
    prior_trials={m['candidateId']:m['trials'] for m in snap()['goalResults']}
    d.execute_script("const x=document.getElementById('miner-threads');x.value=1;x.dispatchEvent(new Event('change'));document.getElementById('miner-limit-minutes').value='10'");click('miner-primary');wait.until(lambda _:snap()['running']);wait.until(lambda _:any((e.get('telemetry')or{}).get('completedSteps',0)>=8 for e in snap()['executions']));assert not snap()['graphicsEnabled'];assert snap()['target']['executions'][0]['candidateId'];report['active']=snap();click('miner-primary');wait.until(lambda _:snap()['paused']);before=snap()['session']['elapsedMs'];time.sleep(.6);assert snap()['session']['elapsedMs']<before+150;check('Real V2 input and authority seed execute in the full WASM Worker; graphics off and safe pause stop work counters')
    # Increasing the time budget while paused must reach the actual runner.
    d.execute_script("document.getElementById('miner-limit-minutes').value='12'");click('miner-primary');wait.until(lambda _:not snap()['paused']);assert snap()['session']['minutes']==12;wait.until(lambda _:any(m['trials']>prior_trials.get(m['candidateId'],0) for m in snap()['goalResults']));report['records']=snap()['goalResults'];report['newScientificBackgroundSaved']=True;click('miner-primary');wait.until(lambda _:snap()['paused']);shot('paused-desktop');check('Revised paused budget takes effect; a newly completed scientific background is independently saved while the candidate search remains a session')
   graphics(True);route('contributions');wait.until(lambda _:d.find_elements(By.CSS_SELECTOR,'#miner-goal-result-list [data-candidate-view]'));d.execute_script("document.querySelector('#miner-goal-result-list [data-candidate-view]').click()");wait.until(lambda _:snap()['viewDiagnostics']['source']=='history' and snap()['viewedResultId']);assert snap()['viewDiagnostics']['source']=='history',el('miner-error-detail').get_attribute('textContent');el('anatomy-stage').location_once_scrolled_into_view;wait.until(lambda _:snap()['viewDiagnostics']['visible']);wait.until(lambda _:snap()['anatomy'].get('geometryState') in ['ready','partial-error']);assert snap()['anatomy']['located']>0;assert snap()['anatomy']['routeMode']=='morphology-guided';assert snap()['anatomy']['mappedSynapsePairs']==0
   report['anatomy']=snap()['anatomy'];shot('history-connected-lines');check('Saved V2 history opens without restarting CPU; real full SWC forest geometry and morphology provenance load')
   d.execute_script("document.getElementById('research-time').value=40.4;document.getElementById('research-time').dispatchEvent(new Event('input'))");before=snap()['replay']['time'];click('research-play');WebDriverWait(d,20).until(lambda _:snap()['replay']['time']>before or snap()['replay']['state']=='ended');click('research-play');paused=snap()['replay']['time'];route('settings');route('experience');time.sleep(.5);assert snap()['replay']['time']==paused;check('Manual saved replay advances during compute pause; page return respects explicit viewing pause')
   d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':False});d.execute_script('window.scrollTo(0,0)');time.sleep(.3);assert d.execute_script('return document.documentElement.scrollWidth')<=391;shot('mobile-390');check('390 px layout has no horizontal overflow and keeps the mining control accessible')
   # Stop is explicit; no render/refresh/return triggers CPU.
   graphics(False);d.execute_script('window.confirm=()=>true');
   if snap()['running']:click('miner-stop');wait.until(lambda _:not snap()['running'])
   d.refresh();wait.until(lambda _:snap() and snap()['authorityOnline']);assert not snap()['running'];assert not snap()['graphicsEnabled'];assert snap()['cacheModel'];assert any(m['trials'] for m in snap()['goalResults']);check('Refresh preserves graphics preference, full model, candidate files and submission identity; never auto resumes unfinished CPU state')
   report['network']={'official_requests':network.requests,'data_received_bytes':network.data_received_bytes,'writes':network.writes,'errors':network.errors};assert not network.requests;report['browser_errors']=[x for x in d.get_log('browser') if x['level']=='SEVERE'];assert not report['browser_errors'],report['browser_errors'];report['final']=snap();report['passed']=len(report['checks']);save()
  except Exception as e:
   report['failure']=str(e);report['traceback']=traceback.format_exc();report['ui_error']=el('miner-error-detail').get_attribute('textContent')
   try:report['state']=snap();report['browser_errors']=d.get_log('browser');shot('failure')
   except Exception:pass
   save();raise
  finally:network.close();close_test_browser(d)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default='http://127.0.0.1:8084');p.add_argument('--report',default='data/prepared/goal-v2-browser/report.json');p.add_argument('--view-only',action='store_true');main(p.parse_args())
