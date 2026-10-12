#!/usr/bin/env python3
"""Read real native 32/128 history without changing the fixed mining batch.

Seeds missing history from previously verified native artifacts only. Retains
existing model/results; no full-model calculation or official download is needed.
"""
import argparse,json
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import DEFAULT_PROFILE,retained_profile
from e2e_official_download import BrowserNetwork

GOLD={'quick32':'6fb503749865cfe4419a633d1652d109cf216e1c79ef7ae0e22d0f990680c9a0','duration128-v1-dev':'08fda8d1038550ef0ff4237a266e23f063bced5c29fd97d0ebebf3c84ba9ca9d'}
def main(a):
    out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True);report={'schema':'flypow-mining-history-browser-v1','checks':[],'profile_retained':True}
    with retained_profile(a.profile) as profile:
        options=webdriver.ChromeOptions();options.binary_location='/usr/bin/chromium'
        for f in ['--headless=new','--no-sandbox','--no-proxy-server','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--user-data-dir='+profile]:options.add_argument(f)
        options.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=options);d.set_script_timeout(60);wait=WebDriverWait(d,120,.2);network=BrowserNetwork(d)
        try:
            d.get(a.url.rstrip('/')+'/mining/');wait.until(lambda _:d.execute_script('return window.flypowWorkspace'))
            d.execute_script("const x=document.getElementById('miner-graphics');x.checked=false;x.dispatchEvent(new Event('change'));for(const id of ['history-response','history-graph']){const e=document.createElement('input');e.type='file';e.id=id;document.body.append(e);}")
            d.find_element(By.ID,'history-graph').send_keys(str(Path(a.graph).resolve()))
            for profile_id,root in GOLD.items():
                d.find_element(By.ID,'history-response').send_keys(str((Path(a.inputs)/(profile_id+'-124-0.bin')).resolve()))
                r=d.execute_async_script('''const [id,golden,done]=arguments;(async()=>{
                    const {ResearchProfiles}=await import('/assets/research-profiles.mjs'),{taskForIndex}=await import('/assets/catalog-task.mjs'),{buildRecordFile,digest}=await import('/assets/response-record.mjs'),{saveLocalResponse,listLocalResponses}=await import('/assets/response-store.mjs');
                    const p=await(await ResearchProfiles.load()).get(id),task=await taskForIndex(p.catalog,124),existing=await listLocalResponses(p.catalog,p.config);
                    if(existing.some(r=>r.task_id===task.taskId&&r.result_root===golden))return {method:'retained historical result',taskId:task.taskId};
                    const file=document.getElementById('history-response').files[0],actual=await digest(new Uint8Array(await file.arrayBuffer()));if(actual!==golden)throw Error('Native history root differs from golden');
                    const graph=document.getElementById('history-graph').files[0],bodies=new BigUint64Array(await graph.slice(52,52+p.config.neuron_count*8).arrayBuffer());
                    const bodyIndex=body=>{let lo=0,hi=bodies.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(bodies[mid]<body)lo=mid+1;else hi=mid;}return bodies[lo]===body?lo:-1;};
                    const bundle=await buildRecordFile(file,p.config,task,bodyIndex,actual);await saveLocalResponse({...bundle,task,archive:file},p.catalog);return {method:'verified native historical artifact',taskId:task.taskId};
                })().then(done,e=>done({error:String(e)}));''',profile_id,root)
                assert not r.get('error'),r
                d.execute_script("document.querySelector('[data-miner-view=contributions]').click();const e=document.getElementById('miner-history-profile');e.value=arguments[0];e.dispatchEvent(new Event('change'))",profile_id)
                wait.until(lambda _:d.execute_script("return [...document.querySelectorAll('#miner-contribution-list article')].some(e=>e.dataset.taskId===arguments[0])",r['taskId']))
                d.execute_script("[...document.querySelectorAll('#miner-contribution-list article')].find(e=>e.dataset.taskId===arguments[0]).querySelector('button').click()",r['taskId'])
                wait.until(lambda _:d.execute_script('return flypowWorkspace.snapshot().viewedResultId')==root)
                s=d.execute_script('return flypowWorkspace.snapshot()');assert s['profileId']=='duration256-v1-dev' and not s['running'];assert int(d.find_element(By.ID,'research-time').get_attribute('max'))==({'quick32':31,'duration128-v1-dev':127}[profile_id])
                report['checks'].append({'profile':profile_id,'root':root,**r});print(json.dumps({'passed':len(report['checks']),'profile':profile_id}),flush=True)
            report['official_requests']=len(network.requests);report['official_data_received_bytes']=network.data_received_bytes;assert not network.requests
            report['success']=True;report['browser_errors']=[e for e in d.get_log('browser') if e['level']=='SEVERE'];assert not report['browser_errors'],report['browser_errors']
        finally:out.write_text(json.dumps(report,indent=2)+'\n');network.close();d.quit()
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default='http://127.0.0.1:8084');p.add_argument('--profile',default=str(DEFAULT_PROFILE));p.add_argument('--graph',default='data/prepared/registry-male-cns-v1.0/graph-v1.bin');p.add_argument('--inputs',default='data/prepared/optimization-benchmarks');p.add_argument('--report',default='data/prepared/mining-3d-history/report.json');main(p.parse_args())
