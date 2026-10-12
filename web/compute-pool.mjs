import { ModelRuntime } from './preparation-controller.mjs';
// A preallocation policy, not a RAM measurement. deviceMemory is a coarse hint.
export function computePolicy({hardwareConcurrency=1,deviceMemory=null,mobile=false}={}){
  const logical=Math.max(1,Math.min(256,Math.floor(hardwareConcurrency)||1));
  const fixedMiB=256,perWorkerMiB=768,availableMiB=Number.isFinite(deviceMemory)&&deviceMemory>0?deviceMemory*1024*.6:null;
  const memorySlots=availableMiB===null?logical:Math.max(1,Math.floor((availableMiB-fixedMiB)/perWorkerMiB));
  // Hints set a preallocation budget. Every expansion still requires a real
  // sequential warmup. Touch and a missing memory hint never disable expansion.
  const max=Math.max(1,Math.min(16,Math.max(1,logical-1),memorySlots));
  return {logical,max,defaultThreads:mobile?1:max>=2?2:1,perWorkerMiB,fixedMiB,deviceMemoryHintGiB:deviceMemory,
    reason:availableMiB===null?'Memory hint unavailable; expand one Worker at a time':'Model-instance memory budget and logical-processor hint',scope:'Budget estimate, not available RAM, dedicated CPU cores or process RSS; compiled code reused, model instances separate'};
}
export class ComputePool {
  constructor(primary,{policy=computePolicy(navigator),createRuntime=id=>new ModelRuntime(()=>{},id),onChange=()=>{}}={}){
    Object.assign(this,{primary,policy,createRuntime,onChange});this.slots=new Map();this.requested=mobileDefault(policy);this.failedExpansion=false;this.events=[];this.revision=0;this.retries=[];
    this.slots.set(primary.workerId,{id:primary.workerId,runtime:primary,status:'idle',execution:null});
  }
  async warmOne(config,sessionId){
    this.prune();if(this.failedExpansion||this.slots.size>=this.requested)return null;const revision=this.revision;
    const id='compute-'+crypto.randomUUID(),runtime=this.createRuntime(id),slot={id,runtime,status:'warming',execution:null};this.slots.set(id,slot);this.onChange();
    try{await runtime.request('restore',{config,sessionId,wasmModule:this.primary.wasmModule},'ready');if(revision!==this.revision&&this.slots.size>this.requested){runtime.release();this.slots.delete(id);this.onChange();return null;}slot.status='idle';slot.memory=runtime.memoryReport||null;this.events.push({event:'warm',workerId:id,at:performance.now()});this.events=this.events.slice(-64);this.onChange();return slot;}
    catch(e){runtime.release();this.slots.delete(id);if(revision===this.revision){this.failedExpansion=true;this.failure=e.message;}this.onChange();return null;}
  }
  setRequested(value){const next=Math.max(1,Math.min(this.policy.max,Math.round(Number(value)||1)));if(next!==this.requested){this.revision++;this.requested=next;this.resetExpansion();}try{localStorage.setItem('flypow-compute-threads-v1',String(this.requested));}catch{}this.trim();this.onChange();}
  resetExpansion(){this.failedExpansion=false;this.failure=null;this.prune();}
  retryExpansion(){const at=performance.now();this.retries=this.retries.filter(x=>at-x<60000);if(this.retries.length>=3)return false;this.retries.push(at);this.resetExpansion();this.revision++;this.onChange();return true;}
  prune(){for(const s of this.slots.values())if(s.runtime!==this.primary&&!s.runtime.ready&&s.status!=='warming'&&!s.execution){s.runtime.release();this.slots.delete(s.id);}}
  snapshot(){const ready=[...this.slots.values()].filter(s=>s.runtime.ready);return {requested:this.requested,prepared:ready.length,effective:Math.min(this.requested,ready.length),busy:ready.filter(s=>['running','resuming','pausing'].includes(s.status)).length,parked:ready.filter(s=>s.status==='parked').length,warming:[...this.slots.values()].filter(s=>s.status==='warming').length,expansionFailed:this.failedExpansion,reason:this.failedExpansion?this.failure:this.policy.reason,policy:this.policy,workers:[...this.slots.values()].map(s=>({workerId:s.id,status:s.status,executionId:s.execution?.id,taskId:s.execution?.task?.taskId,memory:s.runtime.memoryReport||s.memory||null}))};}
  trim(){for(const s of [...this.slots.values()].reverse())if(s.runtime!==this.primary&&this.slots.size>this.requested&&s.status==='idle'&&!s.execution){s.runtime.release();this.slots.delete(s.id);}}
  dispose(){for(const s of this.slots.values())s.runtime.release();this.slots.clear();}
}
const mobileDefault=policy=>policy.defaultThreads;
