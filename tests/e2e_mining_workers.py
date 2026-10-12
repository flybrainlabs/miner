#!/usr/bin/env python3
"""Independent full-model Worker instances, overlapping real work and native bytes.

Uses the retained browser cache. No official dataset downloads or fabricated
work counters. The app remains idle while the test owns two isolated runtimes.
"""
import argparse, json, os, threading, time, traceback
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import DEFAULT_PROFILE, retained_profile
from e2e_official_download import BrowserNetwork

GOLD='82502595566cb3070a914bc426060b6b48dc89e58650195dbee363c45fab5683'

def process_rss(root):
    parents={};sizes={}
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():continue
        try:
            fields=dict(line.split(':',1) for line in (path/'status').read_text().splitlines() if ':' in line)
            pid=int(path.name);parents[pid]=int(fields['PPid']);sizes[pid]=int(fields.get('VmRSS','0 kB').split()[0])*1024
        except (OSError,ValueError,KeyError):pass
    descendants={root};changed=True
    while changed:
        added={pid for pid,parent in parents.items() if parent in descendants}-descendants
        changed=bool(added);descendants.update(added)
    return sum(sizes.get(pid,0) for pid in descendants)

def main(a):
    out=Path(a.report);out.parent.mkdir(parents=True,exist_ok=True)
    report={'schema':'flypow-full-model-independent-workers-v1','url':a.url,'profile':str(Path(a.profile).resolve()),'profile_retained':True,'checks':[],'rss_scope':'sum of process resident pages, may double-count shared pages; not available RAM','cgroup_memory_limit_bytes':Path('/sys/fs/cgroup/memory.max').read_text().strip(),'cgroup_cpu_quota':Path('/sys/fs/cgroup/cpu.max').read_text().strip()}
    def write():out.write_text(json.dumps(report,indent=2)+'\n')
    def check(message):report['checks'].append(message);write();print(json.dumps({'passed':len(report['checks']),'check':message}),flush=True)
    with retained_profile(a.profile) as profile:
        options=webdriver.ChromeOptions();options.binary_location='/usr/bin/chromium'
        for arg in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--renderer-process-limit=1','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--user-data-dir='+profile]:options.add_argument(arg)
        options.set_capability('goog:loggingPrefs',{'browser':'ALL'})
        d=webdriver.Chrome(options=options);d.set_script_timeout(120);wait=WebDriverWait(d,900,.2);network=BrowserNetwork(d)
        stop=threading.Event();rss=[]
        def sample():
            while not stop.wait(.5):rss.append(process_rss(d.service.process.pid))
        threading.Thread(target=sample,daemon=True).start()
        def js(source):
            result=d.execute_async_script('const done=arguments[0];(async()=>{'+source+'})().then(done,error=>done({error:String(error)}));')
            if isinstance(result,dict) and result.get('error'):raise AssertionError(result['error'])
            return result
        try:
            d.get(a.url.rstrip('/')+'/mining/');wait.until(lambda _:d.execute_script('return window.flypowWorkspace&&flypowWorkspace.snapshot().preparation==="needed"'))
            d.execute_script("const x=document.getElementById('miner-graphics');x.checked=false;x.dispatchEvent(new Event('change'))")
            assert d.execute_script('return flypowWorkspace.snapshot().cacheModel'),'Seed this origin once with the cached full model via e2e_mining_3d.py'
            js("""
                const {ModelRuntime}=await import('/assets/preparation-controller.mjs'),{ResearchProfiles}=await import('/assets/research-profiles.mjs');
                const profiles=await ResearchProfiles.load();const p=await profiles.get('duration256-v1-dev');window.workerConfig=p.config;window.workerCatalog=p.catalog;
                window.isolatedWorkers=[new ModelRuntime(()=>{},'acceptance-primary'),new ModelRuntime(()=>{},'acceptance-secondary')];window.workerEvents=[];window.workerResults=[];
                for(const runtime of isolatedWorkers){runtime.onCompute=m=>workerEvents.push({...m,at:performance.now()});}
                await isolatedWorkers[0].request('restore',{config:workerConfig},'ready');await isolatedWorkers[1].request('restore',{config:workerConfig,wasmModule:isolatedWorkers[0].wasmModule},'ready');
                return isolatedWorkers.map(w=>({id:w.workerId,generation:w.generation,ready:w.ready,memory:w.memoryReport}));
            """)
            report['browser']=d.capabilities['browserVersion'];check('Two independent ModelRuntime/WASM instances restore the exact same retained model without network download')
            # File selection supplies the trusted native response without a network transfer.
            d.execute_script("const e=document.createElement('input');e.type='file';e.id='native-response';document.body.append(e)")
            d.find_element(By.ID,'native-response').send_keys(str(Path(a.native).resolve()))
            js("""
                const {taskForIndex}=await import('/assets/catalog-task.mjs');window.workerFinished=false;window.workerFailure=null;
                const tasks=await Promise.all([125,124].map(k=>taskForIndex(workerCatalog,k)));
                const operations=isolatedWorkers.map(async(runtime,i)=>{
                    const start=performance.now(),task=tasks[i];
                    const result=await runtime.request('run',{config:workerConfig,task,sessionId:'independent-full-model-acceptance',executionId:crypto.randomUUID()},'result');
                    workerResults[i]={workerId:runtime.workerId,k:task.k,taskId:task.taskId,start,end:performance.now(),resultHash:result.resultHash,memory:result.memoryReport,telemetry:result.computation};
                    if(i===1){const native=document.getElementById('native-response').files[0],actual=result.archive;let equal=native.size===actual.size,mismatch=null;
                        for(let at=0;equal&&at<native.size;at+=4*1024*1024){const [left,right]=await Promise.all([native.slice(at,at+4*1024*1024).arrayBuffer(),actual.slice(at,at+4*1024*1024).arrayBuffer()]);const x=new Uint8Array(left),y=new Uint8Array(right);for(let j=0;j<x.length;j++)if(x[j]!==y[j]){equal=false;mismatch=at+j;break;}}
                        workerResults[i].nativeBytes={equal,bytes:native.size,mismatch};
                    }
                    return true;
                });
                Promise.all(operations).then(()=>workerFinished=true,error=>{workerFailure=String(error);workerFinished=true;});return tasks.map(t=>({k:t.k,taskId:t.taskId}));
            """)
            wait.until(lambda _:d.execute_script('return window.workerFinished'))
            report['failure_from_worker']=d.execute_script('return workerFailure');assert not report['failure_from_worker'],report['failure_from_worker']
            report['results']=d.execute_script('return workerResults');report['events']=d.execute_script('return workerEvents')
            primary,secondary=report['results'];assert primary['taskId']!=secondary['taskId']
            report['overlap_ms']=min(primary['end'],secondary['end'])-max(primary['start'],secondary['start']);assert report['overlap_ms']>0
            assert all(any(e.get('workerId')==r['workerId'] and e.get('completedSteps',0)>0 and e.get('neuronUpdates',0)>0 for e in report['events']) for r in report['results'])
            check('Distinct legal TaskIDs overlap, with independently observed scientific step and work counters on both Workers')
            assert secondary['resultHash']==GOLD and secondary['nativeBytes']['equal'];assert secondary['telemetry']['neuronUpdates']==2*165122*256
            check('Secondary Worker k124 response matches every native byte and the original single-Worker 256 golden root')
            js("for(const runtime of isolatedWorkers)runtime.release();return true;")
            report['official_requests']=len(network.requests);report['official_data_received_bytes']=network.data_received_bytes;assert not network.requests and network.data_received_bytes==0
            report['browser_errors']=[e for e in d.get_log('browser') if e['level']=='SEVERE'];assert not report['browser_errors'],report['browser_errors']
            report['success']=True;report['passed']=len(report['checks'])
        except Exception as error:
            report['failure']=str(error);report['traceback']=traceback.format_exc();raise
        finally:
            stop.set();report['peak_process_tree_rss_bytes']=max(rss,default=0);write();network.close();d.quit()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default='http://127.0.0.1:8084');p.add_argument('--profile',default=str(DEFAULT_PROFILE));p.add_argument('--report',default='data/prepared/mining-3d-workers/report.json');p.add_argument('--native',default='data/prepared/optimization-benchmarks/duration256-v1-dev-124-0.bin');main(p.parse_args())
