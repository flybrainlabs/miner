// Observational work only. Never included in a scientific hash or a receipt.
export const WORK_SCHEMA='flypow-work-observation-v1';
export const scopeKeys=['networkId','sessionId','roundId','workerId','executionId','operationId'];
const integer=v=>{if(typeof v==='bigint'&&v>=0n)return v;if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)return BigInt(v);if(typeof v==='string'&&/^(0|[1-9][0-9]{0,39})$/.test(v))return BigInt(v);throw new Error('Invalid work integer');};
export function workCounts(m){return {neurons:integer(m.workNeuronUpdates??(BigInt(m.neuronUpdates||0)+BigInt(m.partialNeuronUpdates||0)).toString()),synapses:integer(m.workSynapseAdditions??m.synapseTransmissions??0)};}
const same=(a,b)=>scopeKeys.every(k=>a[k]===b[k]);
export class WorkMeter {
  constructor({clock=()=>performance.now(),minimumSampleMs=5000}={}){this.clock=clock;this.minimumSampleMs=minimumSampleMs;this.reset();}
  reset(){this.inflight=new Map();this.total={neurons:0n,synapses:0n};this.samples=[];this.started=this.clock();this.pausedAt=null;this.pausedMs=0;this.status='idle';this.resetWindow();}
  resetWindow(){const at=this.clock();this.samples=[{at,...this.total}];this.windowStarted=at;}
  register(scope){if(!scopeKeys.every(k=>typeof scope[k]==='string')||this.inflight.has(scope.executionId))throw new Error('Invalid or duplicate work execution');this.inflight.set(scope.executionId,{scope:{...scope},sequence:-1,producedAt:0,neurons:0n,synapses:0n});}
  merge(m){const row=this.inflight.get(m.executionId);if(!row||!same(row.scope,m)||!Number.isSafeInteger(m.sequence)||m.sequence<=row.sequence||!Number.isFinite(m.producedAt)||m.producedAt<row.producedAt)return false;
    let c;try{c=workCounts(m);}catch{return false;}if(c.neurons<row.neurons||c.synapses<row.synapses)return false;
    this.total.neurons+=c.neurons-row.neurons;this.total.synapses+=c.synapses-row.synapses;Object.assign(row,c,{sequence:m.sequence,producedAt:m.producedAt,stage:m.stage});return true;}
  // Merge a final/pause packet even if its last progress packet was lost.
  retire(executionId,final){if(final?.executionId===executionId)this.merge(final);return this.inflight.delete(executionId);}
  setStatus(status){if(status===this.status)return;const now=this.clock(),stopped=['paused','stopped','idle'].includes(status);if(stopped&&this.pausedAt===null)this.pausedAt=now;if(!stopped&&this.pausedAt!==null){this.pausedMs+=now-this.pausedAt;this.pausedAt=null;this.resetWindow();}this.status=status;}
  sample(){const now=this.clock(),last=this.samples.at(-1);if(now>last.at)this.samples.push({at:now,...this.total});else Object.assign(last,this.total);
    // One left anchor is kept for exact time clipping/interpolation.
    while(this.samples.length>2&&this.samples[1].at<=now-30000)this.samples.shift();return this.snapshot();}
  window(ms){const now=this.clock(),from=Math.max(this.windowStarted,now-ms),duration=now-from;if(duration<=0)return {windowMs:0,neurons:0n,synapses:0n};
    let left=this.samples[0],right=left;for(const s of this.samples){if(s.at<=from)left=s;else{right=s;break;}}if(right.at<=left.at)right=left;
    const interpolate=k=>left[k]+(right.at>left.at?(right[k]-left[k])*BigInt(Math.round((from-left.at)*1000))/BigInt(Math.round((right.at-left.at)*1000)):0n);
    return {windowMs:duration,neurons:this.total.neurons-interpolate('neurons'),synapses:this.total.synapses-interpolate('synapses')};}
  snapshot(){const now=this.clock(),w=this.window(30000),recent=this.window(5000),paused=this.pausedMs+(this.pausedAt===null?0:now-this.pausedAt),elapsedMs=Math.max(0,now-this.started-paused),stopped=['paused','stopped','idle'].includes(this.status);
    const rate=(v,ms)=>ms>0?Number(v)*1000/ms:null,wire=x=>({windowMs:Math.round(x.windowMs),neuronUpdates:x.neurons.toString(),synapseAdditions:x.synapses.toString()});
    return {schema:WORK_SCHEMA,status:this.status,sampledMs:Math.round(w.windowMs),windowMs:Math.round(w.windowMs),measuring:w.windowMs<this.minimumSampleMs,current:wire(w),recent:wire(recent),totalNeuronUpdates:this.total.neurons.toString(),totalSynapseAdditions:this.total.synapses.toString(),inflight:this.inflight.size,retainedSamples:this.samples.length,sessionElapsedMs:Math.round(elapsedMs),
      neuronUpdatesPerSecond:stopped||w.windowMs<this.minimumSampleMs?null:rate(w.neurons,w.windowMs),synapseAdditionsPerSecond:stopped||w.windowMs<this.minimumSampleMs?null:rate(w.synapses,w.windowMs),recentNeuronUpdatesPerSecond:stopped?null:rate(recent.neurons,recent.windowMs),sessionNeuronUpdatesPerSecond:rate(this.total.neurons,elapsedMs),sessionSynapseAdditionsPerSecond:rate(this.total.synapses,elapsedMs),scope:'Actual cumulative work over a common, time-clipped 30 s wall-clock window; waiting/saving include zero increments; pause resets current window; cached artifacts excluded'};}
  report(scope,sequence,phase){return {schema:'flypow-session-work-report-v1',...scope,sequence,producedAt:Date.now(),phase,neuronUpdates:this.total.neurons.toString(),synapseAdditions:this.total.synapses.toString()};}
}
