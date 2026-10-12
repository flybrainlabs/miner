import { WorkMeter } from './work-meter.mjs';
import { ObservationFocus } from './observation-focus.mjs';
import { taskForIndex } from './catalog-task.mjs';
import { modelLock } from './preparation-controller.mjs';
import { FlowError, errorCode } from './miner-state.mjs';
import { ComputationLog } from './computation.mjs';
import { SessionPlan } from './session-plan.mjs';
import { ComputePool } from './compute-pool.mjs';
import { eligibleIndices, taskAvailability, catalogTaskCount } from './task-eligibility.mjs';
export { eligibleIndices } from './task-eligibility.mjs';
export const taskCount=catalogTaskCount;
export function sessionGuard({snapshot,rules,pending=0,maxPending=1,quote=null,spent=0n,feeLimit=null,hasServices=true}){
  if(!snapshot)return null;
  if(snapshot.state.state!==1||snapshot.clock.unixTimestamp>rules.submit_deadline)return 'activity-ended';
  if(!hasServices)return 'services';
  if(pending>=maxPending)return 'pending-limit';
  if(quote&&feeLimit!=null&&spent+quote.max>feeLimit)return 'fee-limit';
  return null;
}
// One coordinator owns the lock, task reservations, result queue and activity clock.
// Each slot owns an independent Worker, WASM instance, ModelHandle and SimSession.
export class TaskRunner {
  constructor({runtime,state,catalog,config,records,save,onResult,onTrace=()=>{},onFocus=()=>{},onSnapshot=()=>{},onObservationProgress=()=>{},onObservationStage=()=>{},activity=async()=>null,events,pool=null}){
    Object.assign(this,{runtime,state,catalog,config,records,save,onResult,onTrace,onFocus,onSnapshot,onObservationProgress,onObservationStage,activity,events});
    this.observation=new ObservationFocus(this);this.running=false;this.paused=false;this.generation=0;this.tasksByExecution=new Map();this.inFlight=new Set();this.computation=new ComputationLog(300);this.returning=SessionPlan.restored();this.pendingResults=new Map();
    this.pool=pool||new ComputePool(runtime);this.pool.onChange=()=>{this.publish();if(this.running)this.pump();};
    this.saveQueue=Promise.resolve();this.reservedBytes=0;this.history=[];this.samples=[];this.clock=()=>performance.now();this.meter=new WorkMeter({clock:()=>this.clock()});
  }
  eligibility(a,extra={}){return {local:this.records(this.config),compatible:k=>!this.inFlight.has(k),pending:a?.pendingRecords||[],snapshot:a?.snapshot,rules:a?.rules,...extra};}
  async recommend(a=null){a??=await this.activity();const reason=a&&sessionGuard(a);if(reason)throw new FlowError(reason);const list=eligibleIndices(this.catalog,this.eligibility(a,{random:()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296}));if(!list.length)throw new FlowError(a?.snapshot&&!a.snapshot.pages.every(p=>p.complete)?'queue-full':'catalog-complete');return taskForIndex(this.catalog,list[0]);}
  get active(){return [...this.tasksByExecution.values()].filter(e=>!e.done);}
  focus(id){const e=this.tasksByExecution.get(id);if(!e||e.done)return;this.observation.select(e);this.publish();}
  publish(){
    if(!this.state)return;const e=this.tasksByExecution.get(this.focusedExecutionId),pool=this.pool.snapshot();
    const tasks=this.active.map(x=>({executionId:x.id,workerId:x.slot.id,taskId:x.task.taskId,k:x.task.k,bodyId:String(x.task.bodyId),status:x.slot.status,telemetry:x.telemetry}));
    this.state.update('execution',{...(e?{task:e.task,executionId:e.id,operationId:e.operationId,runningTaskId:e.done?null:e.task.taskId,telemetry:e.telemetry}:{}),focusedExecutionId:this.focusedExecutionId||null,tasksByExecution:tasks,workerStates:pool.workers,pool,aggregate:this.aggregate||null,session:this.plan?.summary()});
  }
  start({plan=null,count=taskCount(this.catalog),minutes=10,storageBytes=1024*1024*1024,feeLimit=null,maxPending=1,task=null,allowRecompute=false}={}){
    if(this.running){if(this.paused)this.resume(plan||new SessionPlan({config:this.config,count,minutes,storageBytes}));return this.completion;}
    if(!this.runtime.ready)return Promise.reject(new FlowError('operation','Prepare the full model first'));
    this.plan=plan||new SessionPlan({config:this.config,count:Math.min(count,taskCount(this.catalog)),minutes,storageBytes});
    this.running=true;this.paused=false;this.pauseRequested=false;this.globalPause=false;this.pauseReason=null;this.catalogExhausted=false;this.task=task;this.allowRecompute=allowRecompute;this.options={feeLimit,maxPending};this.samples=[];this.sampleAt=this.clock();this.lastTotal={neurons:0,synapses:0};this.aggregate=null;this.meter.reset();this.meter.setStatus('running');
    this.pool.failedExpansion=false;this.pool.failure=null;
    for(const slot of this.pool.slots.values())if(!slot.execution&&slot.status!=='warming'){if(slot.runtime.ready)slot.status='idle';else if(slot.runtime!==this.runtime)this.pool.slots.delete(slot.id);}
    this.reservedBytes=0;this.inFlight.clear();this.tasksByExecution.clear();this.focusedExecutionId=null;
    const generation=++this.generation;
    this.completion=modelLock(async()=>{
      this.state.update('execution',{phase:'selecting',reason:null,telemetry:null});
      const finished=new Promise(resolve=>this.resolveSession=resolve);
      this.timer=setInterval(()=>{if(this.plan.limit==='time-limit'&&!this.globalPause)this.pauseNow('time-limit');this.sample();this.publish();},1000);
      this.pump();await finished;
    }).catch(e=>{this.pauseReason=errorCode(e);this.state.update('execution',{phase:'error',reason:this.pauseReason,detail:e.message});throw e;}).finally(()=>{
      clearInterval(this.timer);if(generation===this.generation){this.plan.suspend();this.plan.launchIntent=false;this.plan.remember();this.running=false;this.paused=false;this.pool.trim();this.aggregate=null;this.publish();}
    });return this.completion;
  }
  // Conservative reservation covers complete response, bounded trace and metadata.
  get resultReservation(){return (this.config.max_archive_bytes||128*1024*1024)+16*1024*1024+1024*1024;}
  async pump(){
    if(!this.running)return;if(this.scheduling){this.scheduleAgain=true;return;}this.scheduling=true;const generation=this.generation;
    try{
      do{
        this.scheduleAgain=false;
        if(this.globalPause){this.settlePause();break;}
        if(this.plan.limit==='time-limit'){this.pauseNow('time-limit');break;}
        let occupied=this.active.filter(e=>e.slot.status!=='parked').length;
        // FIFO restores shrink-paused sessions before any new task.
        for(const e of this.active.filter(e=>e.slot.status==='parked').sort((a,b)=>a.parkedAt-b.parkedAt))if(occupied<this.pool.requested){e.slot.status='resuming';e.pauseKind=null;e.slot.runtime.control('resume');occupied++;this.plan.activate();}
        if(this.pauseRequested||this.plan.limit||this.catalogExhausted){if(!this.active.length)this.finish();break;}
        const slots=[...this.pool.slots.values()].filter(s=>s.runtime.ready&&!s.execution&&s.status==='idle');
        for(const slot of slots){
          if(occupied>=this.pool.requested||this.globalPause||this.pauseRequested||this.plan.limit)break;
          if(this.plan.completed+this.inFlight.size>=this.plan.count)break;
          if(this.plan.savedBytes+this.reservedBytes+this.resultReservation>this.plan.storageBytes){if(!this.active.length){this.pauseReason='storage-limit';this.finish();}break;}
          const a=await this.activity(this.options);if(generation!==this.generation)return;if(this.globalPause||this.pauseRequested||!this.running)break;
          const reason=a&&sessionGuard({...a,pending:(a.pending||0)+this.inFlight.size,spent:(a.spent||0n)+(a.quote?.max||0n)*BigInt(this.inFlight.size)});if(reason){this.pauseReason=reason;this.pauseRequested=true;break;}
          const eligible=eligibleIndices(this.catalog,this.eligibility(a,{allowRecompute:!!this.task&&this.allowRecompute,preferred:this.task?.k,random:()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296}));
          if(!eligible.length){if(!this.inFlight.size){this.catalogExhausted=true;this.pauseReason=a?.snapshot?'queue-full':'catalog-complete';}break;}
          let k=eligible[0];if(this.task){k=this.task.k;if(!taskAvailability(this.catalog,k,this.eligibility(a,{allowRecompute:this.allowRecompute})).eligible)throw new FlowError('catalog-complete');}
          // Atomic before task hash, storage query or dispatch. Only this pump mutates it.
          this.inFlight.add(k);this.reservedBytes+=this.resultReservation;
          let selected,estimate;
          const explicit=this.task;this.task=null;
          try{selected=explicit||await taskForIndex(this.catalog,k);if(generation!==this.generation)return;estimate=await navigator.storage?.estimate?.();if(generation!==this.generation)return;}
          catch(e){if(generation!==this.generation)return;this.inFlight.delete(k);this.reservedBytes-=this.resultReservation;throw e;}
          const diskReserved=2*this.reservedBytes;
          if(this.globalPause||this.pauseRequested||this.plan.limit||estimate?.quota!=null&&estimate?.usage!=null&&estimate.quota-estimate.usage<diskReserved){this.inFlight.delete(k);this.reservedBytes-=this.resultReservation;if(!this.globalPause){this.pauseReason=this.plan.limit||'space';this.pauseRequested=true;}break;}
          this.dispatch(slot,selected,!!this.allowRecompute);occupied++;
        }
        // Sequential model preheating. Never re-download/build official input files.
        if(!this.globalPause&&!this.pauseRequested&&!this.catalogExhausted&&!this.plan.limit&&this.plan.savedBytes+this.reservedBytes+this.resultReservation<=this.plan.storageBytes&&this.plan.completed+this.inFlight.size<this.plan.count&&this.pool.slots.size<this.pool.requested&&!this.pool.failedExpansion){
          this.publish();const slot=await this.pool.warmOne(this.config,this.plan.sessionId);if(generation!==this.generation)return;if(slot)this.scheduleAgain=true;
        }
        this.pool.trim();this.publish();
        if(!this.active.length&&(this.pauseRequested||this.plan.limit||this.catalogExhausted))this.finish();
      }while(this.scheduleAgain&&this.running);
    }catch(e){this.pauseReason=errorCode(e);this.computation.append('error',{code:this.pauseReason,detail:e.message});this.pauseRequested=true;if(!this.active.length){this.state.update('execution',{phase:'error',reason:this.pauseReason,detail:e.message});this.finish();}}
    finally{this.scheduling=false;if(this.scheduleAgain&&this.running)queueMicrotask(()=>this.pump());}
  }
  dispatch(slot,task,recompute){
    const e={id:crypto.randomUUID(),operationId:crypto.randomUUID(),task:Object.freeze({...task,stimulus:Object.freeze({...task.stimulus})}),slot,started:this.clock(),telemetry:null,recompute,done:false,phase:'simulation'};
    this.tasksByExecution.set(e.id,e);slot.execution=e;slot.status='running';if(!this.focusedExecutionId||this.tasksByExecution.get(this.focusedExecutionId)?.done)this.focusedExecutionId=e.id;
    this.meter.register({networkId:'local-tools',sessionId:this.plan.sessionId,roundId:'',workerId:slot.id,executionId:e.id,operationId:e.operationId});const runtime=slot.runtime,accept=m=>this.running&&slot.execution===e&&!e.done&&m.workerId===slot.id&&m.sessionId===this.plan.sessionId&&m.executionId===e.id&&m.operationId===e.operationId&&m.taskId===task.taskId;
    runtime.onCompute=m=>{if(!accept(m))return;e.telemetry=m;if(!this.meter.merge(m))return;this.computation.append('progress',{workerId:slot.id,executionId:e.id,telemetry:m});if(['results','saving'].includes(m.stage))slot.status='saving';if(this.focusedExecutionId===e.id)this.onObservationProgress(e.observationScope,m);/* The shared 1 s timer publishes UI samples; every real message remains logged. */};
    runtime.onLive=m=>{if(accept(m))this.onSnapshot(m,runtime);};
    runtime.onControl=m=>{if(!accept(m))return;if(m.telemetry)this.meter.merge(m.telemetry);if(m.state==='paused'){e.telemetry=m.telemetry;slot.status='parked';e.parkedAt=this.clock();this.history.push({event:'paused',workerId:slot.id,executionId:e.id,at:this.clock(),step:m.telemetry.completedSteps});this.settlePause();}else{slot.status='running';this.paused=false;this.plan.activate();}if(this.focusedExecutionId===e.id)this.onObservationStage(e.observationScope,m.state==='paused'?'paused':'simulation');this.publish();this.pump();};
    this.computation.append('task',{workerId:slot.id,executionId:e.id,k:task.k,taskId:task.taskId,bodyId:String(task.bodyId),stimulusIndex:task.stimulusIndex,repeatIndex:task.repeatIndex,recompute});
    this.history.push({event:'start',workerId:slot.id,executionId:e.id,taskId:task.taskId,k:task.k,at:this.clock()});this.history=this.history.slice(-200);this.plan.activate();this.plan.remember();this.events.emit('first-compute');if(this.focusedExecutionId===e.id)this.observation.select(e);this.state.update('execution',{phase:'running',reason:null});this.publish();
    runtime.request('run',{task:e.task,config:this.config,sessionId:this.plan.sessionId,operationId:e.operationId,executionId:e.id,observationScope:e.observationScope,observe:this.observation.enabled&&this.focusedExecutionId===e.id},'result').then(result=>{
      if(e.done||slot.execution!==e)return;this.meter.retire(e.id,result.computation);
      slot.status='saving';if(this.focusedExecutionId===e.id)this.onObservationStage(e.observationScope,'saving');e.telemetry={...result.computation,stage:'saving'};this.publish();
      // Bounded by the slots/reservations. One writer at a time, separate execution paths.
      const saving=this.saveQueue.then(()=>this.complete(e,result));this.saveQueue=saving.catch(()=>{});return saving;
    }).catch(error=>this.fail(e,error));
  }
  async complete(e,result){
    let saved=true;const bytes=(result.responseBytes??result.archive?.byteLength??result.archive?.size??0)+(result.traceBytes?.byteLength||0)+65536;
    try{if(bytes>this.resultReservation||this.plan.savedBytes+bytes>this.plan.storageBytes)throw new FlowError('resource');await this.save(result);this.plan.savedBytes+=bytes;}
    catch(error){saved=false;result.saveError={code:errorCode(error),detail:error.message};this.computation.append('save-error',{workerId:e.slot.id,executionId:e.id,code:errorCode(error)});}
    this.plan.completed++;result.recompute=e.recompute;if(!saved)this.pendingResults.set(e.id,result);
    try{await this.onResult(result);}catch(error){result.displayError=String(error.message||error);this.computation.append('display-error',{executionId:e.id,detail:result.displayError,saved});}
    this.events.emit('first-compute','complete');
    if(saved&&result.temporary)try{await e.slot.runtime.request('release-output',{name:result.temporary},'output-released');}catch(error){this.computation.append('cleanup-error',{executionId:e.id,detail:error.message});}
    e.telemetry={...result.computation,stage:'complete',elapsedMs:this.clock()-e.started};e.resultHash=result.resultHash;e.slot.memory=result.memoryReport;
    this.computation.append('complete',{workerId:e.slot.id,executionId:e.id,telemetry:e.telemetry,saved,resultHash:result.resultHash,recompute:e.recompute});this.history.push({event:'complete',workerId:e.slot.id,executionId:e.id,taskId:e.task.taskId,resultHash:result.resultHash,at:this.clock(),counters:result.computation,memory:result.memoryReport});
    this.releaseReservation(e);this.plan.remember();if(!saved)this.pauseNow('space');if(this.globalPause)this.settlePause();this.publish();this.pump();
  }
  releaseReservation(e){if(e.done)return;e.done=true;this.meter.retire(e.id);this.pool.prune();this.inFlight.delete(e.task.k);this.reservedBytes-=this.resultReservation;e.slot.execution=null;e.slot.status=e.slot.runtime.ready?'idle':'failed';this.observation.complete(e);if(this.tasksByExecution.size>100)for(const [id,x]of this.tasksByExecution)if(x.done&&id!==this.focusedExecutionId){this.tasksByExecution.delete(id);break;}}
  fail(e,error){if(e.done)return;this.meter.retire(e.id,error.computation);this.computation.append(errorCode(error)==='paused'?'stopped':'error',{workerId:e.slot.id,executionId:e.id,code:errorCode(error)});this.history.push({event:'error',workerId:e.slot.id,executionId:e.id,at:this.clock(),code:errorCode(error)});e.telemetry=e.telemetry?{...e.telemetry,stage:'error'}:null;this.releaseReservation(e);
    if(errorCode(error)!=='paused'){e.slot.runtime.release();e.slot.status='failed';this.pool.failedExpansion=true;this.pool.failure=error.message;this.pool.requested=Math.max(1,[...this.pool.slots.values()].filter(s=>s.runtime.ready).length);this.pauseReason=errorCode(error);this.pauseRequested=true;}
    this.settlePause();this.publish();this.pump();
  }
  finish(){if(this.active.length)return;this.plan.suspend();this.plan.launchIntent=false;this.plan.remember();this.state.update('execution',{phase:this.pauseReason==='catalog-complete'||this.pauseReason==='queue-full'?'empty':this.pauseReason?'paused':'complete',reason:this.pauseReason||this.plan.limit,completed:this.plan.completed});this.resolveSession?.();this.resolveSession=null;}
  settlePause(){if(!this.globalPause)return;if(this.active.every(e=>e.slot.status==='parked')){this.paused=true;this.plan.suspend();this.aggregate=null;this.samples=[];this.state.update('execution',{phase:'paused',reason:this.pauseReason,session:this.plan.summary()});if(!this.active.length)this.finish();}}
  resume(plan){
    if(!this.running||!this.paused)return;if(plan.campaign!==this.plan.campaign||plan.profile!==this.plan.profile)throw new FlowError('version');
    this.plan.minutes=plan.minutes;this.plan.storageBytes=plan.storageBytes;
    this.globalPause=false;this.paused=false;this.pauseRequested=false;this.pauseReason=null;this.plan.launchIntent=true;this.resetSample();this.state.update('execution',{phase:'running',reason:null});this.pump();
  }
  setThreads(value){this.pool.setRequested(value);if(!this.running){this.pool.trim();this.publish();return;}let active=this.active.filter(e=>['running','resuming'].includes(e.slot.status));for(const e of active.slice(this.pool.requested).reverse()){e.pauseKind='shrink';e.slot.status='pausing';e.slot.runtime.control('pause');}this.resetSample();this.publish();this.pump();}
  pauseNow(reason='paused'){
    if(!this.running||this.globalPause)return;this.globalPause=true;this.pauseReason=reason;this.plan.launchIntent=false;this.plan.remember();this.aggregate=null;
    this.computation.append('pause-requested',{mode:'slice',scope:'pool'});this.state.update('execution',{phase:'pausing',reason});
    for(const e of this.active)if(['running','resuming'].includes(e.slot.status)){e.slot.status='pausing';e.pauseKind='global';e.slot.runtime.control('pause');}
    this.settlePause();this.publish();
  }
  pauseAfter(reason='paused'){this.pauseReason=reason;this.pauseRequested=true;if(this.plan){this.plan.launchIntent=false;this.plan.remember();}if(this.running){this.computation.append('pause-requested');this.state.update('execution',{phase:'pausing'});this.pump();}}
  stopNow(){this.pauseReason='paused';this.pauseRequested=true;this.globalPause=false;this.paused=false;this.plan.launchIntent=false;for(const e of this.active)if(e.slot.status!=='saving')e.slot.runtime.control('cancel');this.plan.remember();this.state.update('execution',{phase:'pausing'});this.pump();}
  visibility(){if(document.hidden&&this.running)this.pauseNow('hidden');}
  totals(){return {neurons:this.meter.total.neurons.toString(),synapses:this.meter.total.synapses.toString()};}
  resetSample(){this.meter.resetWindow();this.aggregate=null;}
  sample(){this.meter.setStatus(this.globalPause?'paused':this.running?'running':'stopped');this.aggregate=this.globalPause?null:this.meter.sample();}

  dispose(){if(this.running)this.stopNow();clearInterval(this.timer);this.pool.dispose();}
}
