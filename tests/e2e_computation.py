#!/usr/bin/env python3
"""Real full-model Chromium compute counters, progress, pause and log export.

The invalid task request is an explicit injected failure. Model, timing,
simulation counters, cache restore and all successful computations are real.
"""
import argparse
import json
from pathlib import Path
import tempfile
import time
from urllib.parse import urlsplit

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from e2e_official_download import BrowserNetwork

GOLDEN='6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0'

def main(a):
    origin=urlsplit(a.url)
    if origin.scheme!='https' and origin.hostname not in {'localhost','127.0.0.1'}:
        raise ValueError('Use verified HTTPS or a loopback test server')
    out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'flypow-computation-e2e-v1','url':a.url,'checks':[],
            'inputs':'actual frozen full graph/model imported locally, never uploaded',
            'faults':'one invalid Worker task request is explicitly injected',
            'screenshots':[]}
    with tempfile.TemporaryDirectory(prefix='compute-browser-',dir=out.parent) as profile:
        downloads=Path(profile)/'downloads';downloads.mkdir()
        opts=webdriver.ChromeOptions();opts.binary_location='/usr/bin/chromium'
        for flag in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--renderer-process-limit=2','--num-raster-threads=1','--window-size=1440,1000','--user-data-dir='+profile]:opts.add_argument(flag)
        opts.set_capability('goog:loggingPrefs',{'browser':'ALL'})
        opts.add_experimental_option('prefs',{'download.default_directory':str(downloads.resolve()),'download.prompt_for_download':False})
        d=webdriver.Chrome(options=opts);d.set_script_timeout(60)
        network=BrowserNetwork(d);wait=WebDriverWait(d,180,poll_frequency=.1)
        def el(id):return d.find_element(By.ID,id)
        def text(id):return el(id).get_attribute('textContent')
        def phase(section):return d.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-'+section)
        def click(id):wait.until(lambda _:el(id).is_enabled());d.execute_script('arguments[0].click()',el(id))
        def route(view):d.execute_script("document.querySelector('[data-miner-view="+view+"]').click()")
        def summary():return d.execute_script('return window.flypowComputation?.snapshot()')
        def shot(name):
            path=out.parent/(out.stem+'-'+name+'.png');d.save_screenshot(str(path));report['screenshots'].append(str(path))
        try:
            d.get(a.url.rstrip('/')+'/mining/');wait.until(lambda _:el('miner-primary').is_enabled())
            assert not el('miner-computation').is_displayed()
            assert not d.execute_script('return performance.getEntriesByType("resource").some(r=>/\.wasm|\.feather/.test(r.name))')
            report['checks'].append('cold page starts no bulk download or computation; telemetry panel appears only after explicit work')
            route('tools');el('research-graph').send_keys(str(a.graph.resolve()));el('research-model').send_keys(str(a.model.resolve()))
            started=time.monotonic();click('research-prepare');wait.until(lambda _:phase('preparation') in ['ready','error','space'])
            assert phase('preparation')=='ready',text('miner-error-detail')
            report['prepare_seconds']=round(time.monotonic()-started,3);route('experience')
            started=time.monotonic();click('miner-primary')
            wait.until(lambda _:summary()['latest'] and 2<=summary()['latest']['completedSteps']<28)
            live=summary()['latest'];assert live['stage']=='simulation';assert live['recentNeuronUpdatesPerSecond']>0
            assert live['neuronUpdates']==2*165122*live['completedSteps']
            assert el('miner-computation').is_displayed();assert el('miner-run-summary').is_displayed()
            assert float(el('miner-compute-progress').get_attribute('value'))<32
            click('miner-compute-show');shot('running')
            report['live_sample']=live
            click('miner-pause-after');wait.until(lambda _:phase('execution') in ['paused','error'])
            assert phase('execution')=='paused',text('miner-error-detail')
            report['experiment_seconds']=round(time.monotonic()-started,3)
            done=summary();steps=[r['telemetry'] for r in done['entries'] if r['event']=='progress' and r['telemetry']['stage']=='simulation']
            assert [r['completedSteps'] for r in steps]==list(range(33))
            assert done['latest']['stage']=='complete';assert done['latest']['completedSteps']==32
            assert done['latest']['neuronUpdates']==10567808;assert done['latest']['recentNeuronUpdatesPerSecond'] is None
            assert done['latest']['remainingSimulationMs'] is None
            assert done['latest']['synapseTransmissions']>0;assert done['latest']['synapseTransmissions']!=25563197*32*2
            assert text('miner-compute-percent')=='100%';assert 'Average simulation throughput' in text('miner-compute-rate-label')
            assert GOLDEN in text('research-result-hash');assert phase('preparation')=='ready'
            assert 'Pause requested' in text('miner-compute-log');assert 'SHA-256 '+GOLDEN in text('miner-compute-log')
            report['result_root']=GOLDEN;report['completed_measurement']=done['latest']
            report['checks'].append('all 33 actual progress samples arrive before completion; full model native golden result unchanged; graceful pause preserves model and stops recent rates')
            click('miner-compute-export');wait.until(lambda _:list(downloads.glob('*.txt')))
            downloaded=next(downloads.glob('*.txt')).read_text();assert downloaded==text('miner-compute-log')
            assert 'TaskID ' in downloaded and 'neuron updates/s' in downloaded and GOLDEN in downloaded
            for secret in ['salt','beneficiary','refundRecipient','privateKey']:assert secret not in downloaded
            log_path=out.with_suffix('.txt');log_path.write_text(downloaded);report['exported_log']=str(log_path)
            elapsed=text('miner-compute-elapsed');time.sleep(.6);assert text('miner-compute-elapsed')==elapsed
            report['checks'].append('TXT log download exactly matches displayed actual work; task identity and final result root present; completed elapsed time freezes')
            for lang in ['en','zh']:
                if d.execute_script('return FlyI18n.language')!=lang:click('language-switch');wait.until(lambda _:d.execute_script('return FlyI18n.language')==lang)
                for width in [320,390,768,1440]:
                    d.set_window_size(width,1000);assert d.execute_script('return document.documentElement.scrollWidth<=innerWidth+1'),(lang,width)
                    if width==390:el('miner-computation').location_once_scrolled_into_view;shot('mobile-'+lang)
                if lang=='zh':assert '神经元更新/秒' in text('miner-compute-neurons');assert '计算日志' in text('miner-compute-log')
            click('language-switch');wait.until(lambda _:d.execute_script('return FlyI18n.language')=='en');d.set_window_size(1440,1000)
            report['checks'].append('live/finished measurements and translated logs work in EN/ZH at 320/390/768/1440 without overflow')
            d.execute_script("document.getElementById('miner-limit-count').value=1")
            # Task 0 can finish before WebDriver acknowledges a stop. Choose a
            # genuine active catalog input, repeat 1, so this is a mid-run test.
            route('tools');d.execute_script("document.getElementById('research-repeat-index').value=1")
            click('research-run');route('experience');wait.until(lambda _:summary()['latest'] and summary()['latest']['taskId']!=done['latest']['taskId'] and 1<=summary()['latest']['completedSteps']<28)
            partial=summary()['latest'];click('miner-stop');d.switch_to.alert.accept();wait.until(lambda _:phase('execution')=='paused')
            stopped=summary()['latest'];assert stopped['stage']=='stopped'
            report['stopped_measurement']=stopped
            assert stopped['recentNeuronUpdatesPerSecond'] is None
            assert partial['completedSteps']<=stopped['completedSteps']<32
            assert 'Stopped; this task must start again' in text('miner-compute-stage')
            percent=text('miner-compute-percent');elapsed=text('miner-compute-elapsed');n=len(summary()['entries'])
            time.sleep(.7);assert text('miner-compute-percent')==percent;assert text('miner-compute-elapsed')==elapsed;assert len(summary()['entries'])==n
            assert phase('preparation')=='paused'
            report['checks'].append('immediate stop retains actual partial work, no fictitious 100% or checkpoint, and no post-termination progress')
            requests=len(network.requests);click('miner-primary');wait.until(lambda _:phase('preparation') in ['ready','error'])
            assert phase('preparation')=='ready',text('miner-error-detail');assert len(network.requests)==requests
            assert phase('execution')=='paused'
            report['checks'].append('model cache remains compatible; explicit restore rechecks it without official requests or automatic computation')
            d.execute_script("window.originalPost=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...rest){if(message.type==='run'){message={...message,task:{...message.task,bodyId:0}};Worker.prototype.postMessage=window.originalPost;}return window.originalPost.call(this,message,...rest)}")
            click('miner-primary');wait.until(lambda _:phase('execution')=='error')
            assert summary()['entries'][-1]['event']=='error'
            assert text('miner-compute-percent')=='—';assert 'Computation needs attention' in text('miner-compute-stage')
            assert 'Computation needs attention' in text('miner-compute-log')
            report['checks'].append('injected invalid task causes actual Worker rejection; clear error log and no claimed completed work')
            assert not network.writes and not network.errors
            report['network_write_count']=len(network.writes)
            report['browser_errors']=[r['message'] for r in d.get_log('browser') if r['level']=='SEVERE']
            assert not report['browser_errors'],report['browser_errors']
        finally:
            try:report['last_state']={'preparation':phase('preparation'),'execution':phase('execution'),'diagnostic':text('miner-error-detail'),'compute_stage':text('miner-compute-stage')};report['last_log']=summary()
            except Exception as e:report['last_state_error']=str(e)
            out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');network.close();d.quit()
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',required=True);p.add_argument('--graph',required=True,type=Path);p.add_argument('--model',required=True,type=Path);p.add_argument('--report',default='data/prepared/computation-report.json');main(p.parse_args())
