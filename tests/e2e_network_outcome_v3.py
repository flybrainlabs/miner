#!/usr/bin/env python3
"""Retained browsers read the same real signed outcome. Never starts a Worker."""
import argparse,json
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile,close_test_browser
from e2e_official_download import BrowserNetwork
def main(a):
 report={'scope':'Loopback preview, real signed outcome, two retained identities, no scientific runs','physicalAndroid':False,'checks':[],'browsers':[]};previous=json.loads(Path(a.competition).read_text());out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True)
 for profile in [Path('/workspace/.flypow-tools/mining-3d-profile'),Path('/workspace/.flypow-tools/live-current-v3-miner-B')]:
  with retained_profile(profile) as retained:
   o=webdriver.ChromeOptions();o.binary_location='/usr/bin/chromium'
   for f in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--user-data-dir='+retained,'--window-size=1440,1050']:o.add_argument(f)
   d=webdriver.Chrome(options=o);d.set_script_timeout(90);n=BrowserNetwork(d);w=WebDriverWait(d,90,poll_frequency=.2)
   try:
    d.get('http://127.0.0.1:8084/mining/');w.until(lambda _:d.execute_script('return window.flypowWorkspace?.snapshot().authorityOnline'))
    d.execute_async_script("const done=arguments[arguments.length-1];import('/assets/goal-mining-view.mjs').then(({GoalMiningView})=>{const original=GoalMiningView.prototype.ui;GoalMiningView.prototype.ui=function(...a){window.outcomeView=this;return original.apply(this,a)};done(true);});")
    d.execute_script('arguments[0].click()',d.find_element(By.ID,'miner-target-sync'));w.until(lambda _:d.execute_script('return !!window.outcomeView'))
    w.until(lambda _:d.execute_script('return outcomeView.events.some(e=>e.kind==="ROUND_FINALIZED"&&e.roundId===arguments[0])',previous['roundId']))
    state=d.execute_script('return {snapshot:window.flypowWorkspace.snapshot(),network:outcomeView.snapshot,events:outcomeView.events,identity:outcomeView.client.identity.publicKey,finalText:document.getElementById("miner-round-outcome").textContent}');s=state['snapshot'];assert not s['running'] and not s['ready'];event=next(e for e in state['events'] if e['kind']=='ROUND_FINALIZED' and e['roundId']==previous['roundId']);assert event['payload']['claimId']==previous['winner']['claimId']
    if a.stage_complete:assert state['network']['state']=='RESEARCH_STAGE_COMPLETE' and state['network']['round'] is None
    else:assert state['network']['round']['roundId']==previous['nextRound']['roundId'] and state['network']['round']['pre']['goalId']==previous['nextRound']['pre']['goalId']
    assert not n.requests;state['officialRequests']=0;report['browsers'].append(state);report['checks'].append('Retained identity reads signed winner and '+('honest finite-stage completion' if a.stage_complete else 'same next distinct goal')+' without CPU startup');out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
   finally:n.close();close_test_browser(d)
 assert report['browsers'][0]['identity']!=report['browsers'][1]['identity'];report['passed']=len(report['checks']);out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'passed':report['passed'],'scientificRuns':0}))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--competition',default='data/prepared/live-current-v3/competition/report.json');p.add_argument('--report',default='data/prepared/live-current-v3/two-browser-outcome.json');p.add_argument('--stage-complete',action='store_true');main(p.parse_args())
