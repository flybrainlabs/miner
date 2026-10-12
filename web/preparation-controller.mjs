import { inspectStorage, storageBudget } from './model-storage.mjs';
import { FlowError, errorCode } from './miner-state.mjs';
import { officialReadURL } from './official-source.mjs';
import { PREPARATION_PHASE, reducePreparationProgress } from './preparation-progress.mjs';
import { throwIfAborted } from './browser-abort.mjs';

export async function modelLock(action){
  if(!navigator.locks)throw new FlowError('unsupported');
  return navigator.locks.request('flybrain-research-dev-v0',{ifAvailable:true},lock=>{
    if(!lock)throw new FlowError('other-tab');return action();
  });
}
// Worker creation and large data loads only follow an explicit user action.
export class ModelRuntime {
  constructor(onProgress=()=>{},workerId='compute-primary'){this.workerId=workerId;this.onProgress=onProgress;this.onCompute=()=>{};this.onTrace=()=>{};this.onLive=()=>{};this.onControl=()=>{};this.worker=null;this.pending=null;this.ready=false;this.lastProgress=0;this.generation=0;}
  request(type,data={},expected){
    if(this.pending)return Promise.reject(new FlowError('operation','Another model operation is in progress'));
    if(['prepare','restore','build-inputs'].includes(type))this.ready=false;
    if(!this.worker){
      const generation=++this.generation;
      this.worker=new Worker('/assets/research-worker.mjs?v=mining-product-20261011-r7',{type:'module',name:this.workerId});
      this.worker.onmessage=({data:m})=>{
        const pending=this.pending;
        if(!pending||generation!==this.generation||m.generation!==generation||m.workerId!==this.workerId||m.operationId!==pending.operationId||m.sessionId!==pending.sessionId||m.executionId!==pending.executionId||m.configKey!==pending.configKey)return;
        if(pending.expected==='result'&&m.taskId!==pending.taskId)return;
        if(m.type==='compute-progress'){if(this.pending?.expected==='result'){if(m.progressSeq)this.worker.postMessage({...m,type:'progress-ack'});this.onCompute(m);}return;}
        if(m.type==='live-snapshot'){if(this.pending?.expected==='result')this.onLive(m);return;}
        if(m.type==='trace-batch'){if(this.pending?.expected==='result'&&m.taskId===this.pending.taskId)this.onTrace(m);return;}
        if(m.type==='control-state'){this.onControl(m);return;}
        if(m.type==='progress'){
          const now=performance.now(),key=[m.stageId,m.sourceId,m.substage,m.status].join('/');if(key!==this.lastProgressKey||now-this.lastProgress>120||m.status!=='active'){this.lastProgressKey=key;this.lastProgress=now;this.onProgress(m);}return;
        }
        if(m.type==='memory-report'){this.memoryReport=m;window.flypowLastMemoryReport=m;return;}
        if(m.type==='build-report'){this.report=m.report;return;}
        if(!this.pending)return;
        if(m.type==='error'){const p=this.pending;this.pending=null;const e=new Error(m.message);e.code=m.code;e.sourceId=m.sourceId;e.computation=m.computation;p.reject(e);}
        else if(m.type===this.pending.expected){const p=this.pending;this.pending=null;if(m.type==='ready'){this.ready=true;if(m.wasmModule)this.wasmModule=m.wasmModule;}p.resolve(m);}
      };
      this.worker.onerror=e=>{if(generation!==this.generation)return;const p=this.pending;this.pending=null;this.ready=false;this.worker?.terminate();this.worker=null;p?.reject(new Error(e.message||'Worker failed'));};
    }
    return new Promise((resolve,reject)=>{const operationId=data.operationId||crypto.randomUUID(),sessionId=data.sessionId||null,executionId=data.executionId||null,configKey=data.config?[data.config.campaign,data.config.graph_sha256,data.config.model_sha256,data.config.task_catalog_sha256].join('/') : null;this.pending={resolve,reject,expected,operationId,sessionId,executionId,configKey,taskId:data.task?.taskId};this.worker.postMessage({type,...data,operationId,sessionId,executionId,configKey,workerId:this.workerId,generation:this.generation});});
  }
  control(action){const p=this.pending;if(p?.expected==='result')this.worker?.postMessage({type:'control',action,workerId:this.workerId,operationId:p.operationId,sessionId:p.sessionId,executionId:p.executionId,configKey:p.configKey,generation:this.generation,taskId:p.taskId});}
  observe(scope,enabled){const p=this.pending;if(p?.expected==='result'&&scope?.executionId===p.executionId)this.worker?.postMessage({type:'live-subscribe',scope,enabled});}
  acknowledge(scope,snapshotSeq){this.worker?.postMessage({type:'live-ack',scope,snapshotSeq});}
  release(){
    const p=this.pending;this.pending=null;this.generation++;this.worker?.terminate();this.worker=null;this.ready=false;
    if(p){const e=new FlowError('paused');e.name='AbortError';p.reject(e);}
  }
}
export async function probeOfficial(source,signal){
  const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  const timer=setTimeout(cancel,7000);
  try{
    const res=await fetch(officialReadURL(source),{mode:'cors',credentials:'omit',cache:'no-store',headers:{Range:'bytes=0-0'},signal:controller.signal});
    if(!res.ok||!res.body||res.type==='opaque')return {readable:false,reason:'server',status:res.status};
    const reader=res.body.getReader();let first;try{first=await reader.read();}finally{await reader.cancel().catch(()=>{});}
    if(first.done||!first.value?.length)return {readable:false,reason:'server',status:res.status};
    if(res.status===206&&res.headers.get('Content-Range')!==`bytes 0-0/${source.bytes}`)return {readable:false,reason:'identity',status:res.status};
    return {readable:true,reason:res.status===206?'range':'stream'};
  }catch(e){if(signal?.aborted)throw e;return {readable:false,reason:'policy-or-network'};}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();}
}
export class PreparationController {
  constructor({config,manifest,runtime,state,events}){
    Object.assign(this,{config,manifest,runtime,state,events});this.files={};this.rows=[];this.inventory=null;this.probe=null;this.abort=null;this.busy=false;
    runtime.onProgress=m=>{
      if(m.operationId!==this.operationId)return;
      const phase=PREPARATION_PHASE[m.stageId];if(!phase)return;
      const sourceProgress={...this.state.value.preparation.sourceProgress};
      if(m.sourceId)sourceProgress[m.sourceId]={stage:m.substage,loaded:m.done,total:m.total,retryCount:m.retryCount,status:m.status};
      const stages=reducePreparationProgress(this.state.value.preparation.stages||{parents:{},sources:{}},m,this.operationId);
      this.state.update('preparation',{phase,progress:m,sourceProgress,stages});
    };
  }
  async check(){
    this.state.update('preparation',{phase:'checking'});
    const capabilities={worker:typeof Worker!=='undefined',wasm:typeof WebAssembly!=='undefined',stream:typeof File!=='undefined'&&!!File.prototype.stream,locks:!!navigator.locks,opfs:!!navigator.storage?.getDirectory};
    this.inventory=await inspectStorage(this.config,this.manifest);this.events.context.cache=this.inventory.model;
    const supported=capabilities.worker&&capabilities.wasm&&capabilities.stream&&capabilities.locks;
      this.state.update('preparation',{phase:supported?'needed':'unsupported',capabilities,inventory:this.inventory,budget:storageBudget(this.config,this.manifest,this.inventory),error:supported?null:{code:'unsupported'}});
    this.events.emit('environment',supported?'complete':'failure',supported?'none':'unsupported');
  }
  async operation(action,operationId=null){
    if(this.busy)throw new FlowError('operation');this.busy=true;
    this.operationId=operationId||crypto.randomUUID();this.started=performance.now();
    try{return await modelLock(action);}catch(e){const code=errorCode(e);this.probe=null;this.state.update('preparation',{phase:code==='paused'?'paused':code==='space'?'space':'error',error:{code,detail:e.message},progress:null});this.events.emit('prepare','failure',code);throw e;}
    finally{this.busy=false;this.state.update('preparation',{});}
  }
  async importFiles(files){
    return this.operation(async()=>{
      this.state.update('preparation',{phase:'files',error:null});
      const result=await this.runtime.request('identify',{files:Array.from(files),manifest:this.manifest,operationId:this.operationId},'identified');
      this.rows=result.rows;for(const r of result.rows)if(r.status==='selected')this.files[r.id]=files[r.index];
      this.state.update('preparation',{phase:'files',imports:this.rows,selected:Object.keys(this.files),progress:null});
      return result;
    });
  }
  async start(plan=null){
    if(this.runtime.ready)return true;
    this.events.emit('prepare');
    return this.operation(async()=>{
      this.abort=new AbortController();const signal=this.abort.signal,active=()=>throwIfAborted(signal);
      this.inventory=await inspectStorage(this.config,this.manifest);
      active();
      this.state.update('preparation',{error:null,progress:null,sourceProgress:{},stages:{parents:{inspect:{status:'completed'}},sources:{}},readRestriction:null,inventory:this.inventory,budget:storageBudget(this.config,this.manifest,this.inventory)});
      if(this.inventory.model&&!this.invalidModel){
        this.state.update('preparation',{phase:'loading'});this.events.emit('restore');
        try{this.state.update('preparation',{persistent:!!await navigator.storage.persisted?.().catch(()=>false)});active();await this.runtime.request('restore',{config:this.config,operationId:this.operationId},'ready');active();this.events.emit('restore','complete');return this.finish('restored');}
        catch(e){
          const code=errorCode(e);this.events.emit('restore','failure',code);if(!['damaged','version'].includes(code))throw e;
          this.invalidModel=true;active();
          this.state.update('preparation',{phase:'building',repairReason:code,stages:{parents:{inspect:{status:'completed'},load:{status:'repairing'}},sources:{}}});
          // Repair only the derived model. Results, salts and source blocks stay.
          await this.runtime.request('clear-cache',{config:this.config,operationId:this.operationId},'cache-cleared');
          this.inventory=await inspectStorage(this.config,this.manifest);active();
        }
      }
      if(!this.inventory.opfs)throw new FlowError('no-opfs');
      const budget=storageBudget(this.config,this.manifest,this.inventory),estimate=this.inventory.estimate;
      if(estimate?.quota!=null&&estimate?.usage!=null&&estimate.quota-estimate.usage<budget.extra)throw new FlowError('space');
      const missing=this.manifest.sources.filter(s=>!this.files[s.id]&&(this.inventory.inputs.find(i=>i.id===s.id)?.checkedBytes||0)<s.bytes);
      if(missing.length){
        // One bounded actual-read check per preparation attempt, never HEAD/no-cors.
        this.state.update('preparation',{phase:'fetching',probe:true});this.probe=await Promise.all(missing.map(s=>probeOfficial(s,signal)));active();
        if(this.probe.some(p=>!p.readable)){
          this.state.update('preparation',{phase:'files',readRestriction:this.probe,selected:Object.keys(this.files),progress:null,probe:false});return false;
        }
      }
      const persistent=await navigator.storage.persist?.().catch(()=>false);
      active();
      this.state.update('preparation',{phase:'fetching',persistent:!!persistent,probe:false});
      // Valid cached blocks cause no requests. A damaged block may be fetched
      // again even when a lightweight inventory previously called it complete.
      await this.runtime.request('build-inputs',{files:this.files,manifest:this.manifest,config:this.config,operationId:this.operationId},'ready');
      this.files={};this.invalidModel=false;this.inventory=await inspectStorage(this.config,this.manifest);active();this.state.update('preparation',{inventory:this.inventory});return this.finish('built');
    },plan?.operationId);
  }
  finish(source){const stages=this.state.value.preparation.stages||{parents:{},sources:{}};stages.parents={...stages.parents,ready:{status:'completed'},load:{status:'completed'}};for(const id of ['inputs','verify','construct'])if(!stages.parents[id])stages.parents[id]={status:'skipped'};this.state.update('preparation',{phase:'ready',error:null,saved:true,source,stages,elapsedMs:performance.now()-this.started});this.events.emit('prepare','complete');return true;}
  async preparedFiles(graphFile,modelFile){
    if(!graphFile||!modelFile)throw new FlowError('damaged','Select both prepared model files');
    return this.operation(async()=>{
      this.abort=new AbortController();const active=()=>throwIfAborted(this.abort.signal);
      this.state.update('preparation',{phase:'loading',error:null,progress:null});
      await this.runtime.request('prepare',{graphFile,modelFile,config:this.config,operationId:this.operationId},'ready');
      active();
      let saved=false,saveError=null,persistent=false;
      if(navigator.storage?.getDirectory)try{persistent=await navigator.storage.persist?.();active();await this.runtime.request('cache',{config:this.config,operationId:this.operationId},'cached');active();saved=true;}catch(e){active();saveError={code:errorCode(e),detail:e.message};}
      active();if(!this.runtime.ready)throw new FlowError('operation','Prepared model is no longer loaded; restore the retained cache.');
      this.state.update('preparation',{phase:'ready',saved,saveError,persistent:!!persistent,error:null,progress:null});this.events.emit('prepare','complete');
    });
  }
  pause(){this.abort?.abort();this.runtime.release();this.probe=null;this.state.update('preparation',{phase:'paused',progress:null,probe:false,error:{code:'paused'}});}
  async clear(type){
    return this.operation(async()=>{await this.runtime.request(type==='inputs'?'clear-inputs':'clear-cache',{manifest:this.manifest,config:this.config},type==='inputs'?'inputs-cleared':'cache-cleared');this.inventory=await inspectStorage(this.config,this.manifest);this.state.update('preparation',{inventory:this.inventory,budget:storageBudget(this.config,this.manifest,this.inventory),...(type==='model'?{saved:false}: {})});});
  }
}
