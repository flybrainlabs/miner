#!/usr/bin/env python3
"""Actual Chromium/Worker/WASM with explicit isolated chain-read fixtures.

Model files are read locally. This does not use a personal RPC key, spend public
funds or establish public finality. Browser profiles and all output files remain.
"""
import argparse
import hashlib
import json
import mimetypes
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading
import time
from urllib.parse import urlsplit
from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait

def main(args):
    release = args.release.resolve()
    cases = [json.loads(path.read_text()) for path in args.fixture]
    output = args.report.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    profile = args.profile.resolve()
    profile.mkdir(parents=True, exist_ok=True)
    active = {'case': None}
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *values, **options):
            super().__init__(*values, directory=str(release), **options)
        def log_message(self, *_):
            pass
        def do_GET(self):
            path = urlsplit(self.path).path
            if path.startswith('/__science/select/'):
                index = int(path.rsplit('/', 1)[1])
                if not 0 <= index < len(cases):
                    self.send_error(404)
                    return
                active['case'] = cases[index]
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{}')
                return
            case = active['case']
            if case and path == '/assets/data/scientific-deployment-v5.json':
                data = json.dumps(case['deployment']).encode()
            elif case and path == '/__science/fixture.json':
                data = json.dumps({k:v for k,v in case.items() if k not in ('graphPath','modelPath')}).encode()
            elif case and path in ('/__science/graph.bin','/__science/model.bin'):
                file = Path(case['graphPath'] if path.endswith('graph.bin') else case['modelPath'])
                self.send_response(200)
                self.send_header('Content-Type','application/octet-stream')
                self.send_header('Content-Length',str(file.stat().st_size))
                self.end_headers()
                with file.open('rb') as source:
                    self.copyfile(source, self.wfile)
                return
            else:
                return super().do_GET()
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(data)))
            self.end_headers()
            self.wfile.write(data)
    server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url = 'http://127.0.0.1:'+str(server.server_port)
    options = webdriver.ChromeOptions()
    options.binary_location = '/usr/bin/chromium'
    for flag in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--disable-gpu','--disable-software-rasterizer','--window-size=1280,1000','--user-data-dir='+str(profile)]:
        options.add_argument(flag)
    options.set_capability('goog:loggingPrefs',{'browser':'ALL'})
    driver = webdriver.Chrome(options=options)
    driver.set_script_timeout(240)
    report = {'schema':'flybrain-scientific-browser-acceptance-v5','scope':'Actual Chromium, local model files, current Worker/WASM; chain account reads are explicit isolated SBF fixtures; GPU disabled for CPU/WASM acceptance','publicChainTransactions':0,'realPersonalRpcAcceptance':False,'checks':[],'cases':[],'profileRetained':True}
    try:
        driver.get(url+'/mining/')
        WebDriverWait(driver,90).until(lambda d:d.execute_script('return !!window.flypowWorkspace'))
        assert driver.execute_script('return !!document.getElementById("scientific-mining-v5")')
        assert driver.execute_script('return document.querySelector("#scientific-mining-v5 button").disabled')
        assert not driver.execute_script('return performance.getEntriesByType("resource").some(r=>/\.wasm(?:\?|$)|\.feather/.test(r.name))')
        report['checks'].append('The staged website loads the V5 waiting state without starting a model download, computation or payment')
        for index,case in enumerate(cases):
            started=time.monotonic()
            value=driver.execute_async_script("""
const index=arguments[0],done=arguments[arguments.length-1];
(async()=>{
  await fetch('/__science/select/'+index);const f=await(await fetch('/__science/fixture.json')).json();
  const sdk=await import('/assets/vendor/generated/scientific-v5.mjs');
  const r=sdk.decodeRound(Uint8Array.from(f.roundAccount.data)),task=await sdk.scientificTrialTask(r,f.roundAddress,f.content,f.input,f.role,f.assignment,0);
  const worker=new Worker('/assets/research-worker.mjs',{type:'module'}),id=crypto.randomUUID();let pending;
  window.scienceAcceptanceStage='loading-model';window.scienceAcceptanceProgress=null;
  worker.onerror=e=>{pending?.reject(new Error(e.message||'Worker failed'));};
  worker.onmessage=({data:m})=>{
    if(m.type==='progress'||m.type==='compute-progress')window.scienceAcceptanceProgress={type:m.type,label:m.label,loaded:m.loaded,stage:m.stage,completedSteps:m.completedSteps};
    if(m.type==='compute-progress'&&m.progressSeq)worker.postMessage({...m,type:'progress-ack'});
    if(m.type==='error'){pending?.reject(new Error(m.message));return;}
    if(m.type===pending?.expected){const p=pending;pending=null;p.resolve(m);}
  };
  const request=(type,value,expected,transfer=[])=>new Promise((resolve,reject)=>{pending={resolve,reject,expected};worker.postMessage({type,...value,workerId:'science-browser',sessionId:id,executionId:id,operationId:crypto.randomUUID(),configKey:'science-fixture',generation:1},transfer);});
  try{
    const graph=new File([await(await fetch('/__science/graph.bin')).blob()],'graph-v1.bin'),model=new File([await(await fetch('/__science/model.bin')).blob()],'model-v0.bin');
    await request('prepare',{config:f.config,graphFile:graph,modelFile:model},'ready');
    window.scienceAcceptanceStage='running';
    const channel=new MessageChannel();channel.port1.onmessage=({data:m})=>{
      let value,error;if(m.method==='getGenesisHash')value=f.deployment.genesisHash;
      else if(m.method==='getAccountInfo'&&m.address===f.roundAddress)value=f.roundAccount;
      else error='Explicit isolated fixture read scope';channel.port1.postMessage({id:m.id,value,error});
    };channel.port1.start();
    const result=await request('run',{task,config:f.config,round:{roundAddress:f.roundAddress,content:f.content,goal:f.content.goal},factoryReadPort:channel.port2,networkId:f.deployment.genesisHash,observe:false},'result',[channel.port2]);
    window.scienceAcceptanceStage='retaining-output';
    channel.port1.close();const root=sdk.hex(new Uint8Array(await crypto.subtle.digest('SHA-256',await new Blob([result.archive]).arrayBuffer())));
    const {ScientificJournalV5}=await import('/assets/scientific-mining-v5.mjs'),journal=new ScientificJournalV5(),key='browser-fixture:'+id;
    await journal.put(key,{schema:'browser-fixture-v5',root,archive:new Blob([result.archive])});const retained=await new ScientificJournalV5().get(key);
    if(retained.root!==root||retained.archive.size!==result.responseBytes)throw new Error('Actual IndexedDB archive retention');
    done({ok:true,resultRoot:root,reportedRoot:result.resultHash,metrics:result.goalMetrics,computation:result.computation,bytes:result.responseBytes,retained:true});
  }finally{worker.terminate();}
})().catch(e=>done({ok:false,error:e.message}));
""",index)
            assert value.get('ok'),value
            assert value['resultRoot']==value['reportedRoot']==case['expected']['root'],value
            assert value['metrics']==case['expected']['metrics'],value
            assert value['computation']['executionMethod']=='exact-events-v1'
            assert value['computation']['completedSteps']==256
            assert value['retained']
            report['cases'].append({'neurons':case['config']['neuron_count'],'elapsedSeconds':round(time.monotonic()-started,3),**value})
        report['checks'].append('The actual Worker verifies its bound SBF round through the scoped read port and produces exactly the native archive and complete non-target metrics')
        report['checks'].append('Actual OPFS output and a structured Blob archive remain readable through a fresh IndexedDB journal object')
        report['passed']=True
        driver.save_screenshot(str(output.with_suffix('.png')))
    finally:
        try:
            report['lastStage']=driver.execute_script('return {stage:window.scienceAcceptanceStage,progress:window.scienceAcceptanceProgress}')
            report['browserErrors']=[r['message'][:1000] for r in driver.get_log('browser') if r['level']=='SEVERE'][-12:]
        except Exception:
            pass
        driver.quit()
        server.shutdown()
        output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':report.get('passed',False),'cases':len(report['cases']),'publicChainTransactions':0,'profileRetained':True}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',type=Path,required=True)
    parser.add_argument('--fixture',type=Path,action='append',required=True)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--profile',type=Path,required=True)
    main(parser.parse_args())
