import { decodeTraceRows, traceTransfers } from './propagation-trace.mjs';

export const LIVE_SCHEMA='flypow-live-observation-v1';
export const SCOPE_KEYS=['networkId','sessionId','workerId','operationId','executionId','roundId','goalId','candidateId','trialId','configKey','streamGeneration'];
export const sameScope=(a,b)=>!!a&&!!b&&SCOPE_KEYS.every(k=>(a[k]??null)===(b[k]??null));
export const epochNow=()=>performance.timeOrigin+performance.now();
export function completeWindowBoundary(completedSteps,selectedCells,windowSteps=6){
  if(!Number.isSafeInteger(completedSteps)||completedSteps<0||!Number.isSafeInteger(selectedCells)||selectedCells<1||selectedCells>64)throw new Error('Live complete-step boundary');
  const firstStep=Math.max(0,completedSteps-Math.max(1,Math.min(8,windowSteps))-1);
  return {firstStep,latestStep:completedSteps-1,offset:firstStep*selectedCells*2,availableRows:completedSteps*selectedCells*2,rows:(completedSteps-firstStep)*selectedCells*2};
}
// Credit is released at consumption, replacement or discard. It never gates
// simulation. Only a dirty boundary is retained, not a queue of snapshots.
export class LiveSnapshotSender {
  constructor({read,send,clock=epochNow,intervalMs=100}){Object.assign(this,{read,send,clock,intervalMs});this.sequence=0;this.inFlight=null;this.enabled=false;this.dirty=true;this.lastSent=-Infinity;this.coalesced=0;}
  subscribe(scope,enabled){if(!sameScope(scope,this.scope)){this.scope={...scope};this.inFlight=null;this.sequence=0;this.lastSent=-Infinity;}this.enabled=!!enabled;this.dirty=true;}
  changed(){if(this.dirty)this.coalesced++;this.dirty=true;}
  ack(scope,sequence){if(!sameScope(scope,this.scope)||this.inFlight!==sequence)return false;this.inFlight=null;return true;}
  publish(force=false){if(!this.enabled||!this.dirty||this.inFlight!==null||!force&&this.clock()-this.lastSent<this.intervalMs)return false;
    const m=this.read();if(!m)return false;this.dirty=false;this.lastSent=this.clock();this.inFlight=++this.sequence;
    this.send({...m,schema:LIVE_SCHEMA,version:1,scope:{...this.scope},snapshotSeq:this.inFlight,diagnostics:{...m.diagnostics,coalescedBoundaries:this.coalesced,workerSlots:1,unacknowledged:1}});return true;
  }
}
function validateSnapshot(m){
  if(m.metadata?.executionId!==m.scope?.executionId||m.metadata?.trialId!=null&&m.metadata.trialId!==m.scope.trialId)throw new Error('Live metadata scope');
  if(m.schema!==LIVE_SCHEMA||m.version!==1||!Number.isSafeInteger(m.snapshotSeq)||m.snapshotSeq<1||!Number.isSafeInteger(m.completedSteps)||m.completedSteps<0||m.latestStep!==m.completedSteps-1||!m.metadata||m.metadata.cells.length<1||m.metadata.cells.length>64||m.metadata.edges.length>256||!(m.rows instanceof ArrayBuffer))throw new Error('Live snapshot identity/bounds');
  const expected=(m.completedSteps-m.window.firstStep)*m.metadata.cells.length*2*72;
  if(m.window.firstStep<0||m.window.firstStep>m.completedSteps||m.completedSteps-m.window.firstStep>9||m.rows.byteLength!==expected||m.rows.byteLength>64*2*9*72)throw new Error('Live snapshot window bounds');
  const rows=decodeTraceRows(new Uint8Array(m.rows)),cells=[...m.metadata.cells].map(c=>c.index).sort((a,b)=>a-b);
  rows.forEach((r,i)=>{const step=m.window.firstStep+Math.floor(i/(cells.length*2)),cell=cells[Math.floor(i/2)%cells.length],lane=i%2;if(r[0]!==step||r[1]!==cell||r[2]!==lane)throw new Error('Live snapshot incomplete A/B step');});
  return rows;
}
// One pending latest slot, one presented bounded state. Scientific archives
// never pass through this controller. rAF does not advance model time.
export class LiveObservationController {
  constructor({onBarrier=()=>{},onDraw=()=>{},onAck=()=>{},onRequest=()=>{},clock=epochNow,maxTransportAgeMs=500}={}){Object.assign(this,{onBarrier,onDraw,onAck,onRequest,clock,maxTransportAgeMs});this.scope=null;this.enabled=true;this.pending=null;this.current=null;this.lastSequence=0;this.completedSteps=0;this.lastSnapshotSteps=0;this.renderedStep=-1;this.diagnostics={accepted:0,dropped:0,duplicates:0,overwritten:0,maxPendingSlots:0,latencies:[]};this.events=new Map();}
  barrier(scope){this.discardPending('identity-change');this.scope=scope?{...scope}:null;this.current=null;this.lastSequence=0;this.completedSteps=0;this.lastSnapshotSteps=0;this.renderedStep=-1;this.stage='waiting';this.heartbeatEpochMs=null;this.synchronizing=false;this.events.clear();this.onBarrier(this.scope);}
  setEnabled(enabled){if(this.enabled===!!enabled)return;this.enabled=!!enabled;if(!enabled){this.discardPending('display-off');this.events.clear();}else if(this.scope)this.onRequest(this.scope);}
  discardPending(reason){if(this.pending){this.onAck(this.pending.scope,this.pending.snapshotSeq,reason);this.pending=null;this.diagnostics.dropped++;}}
  progress(scope,m){if(!sameScope(scope,this.scope))return;this.completedSteps=Math.max(this.completedSteps,m.completedSteps||0);this.heartbeatEpochMs=this.clock();this.stage=m.stage;this.partialNeuronUpdates=m.partialNeuronUpdates||0;}
  receive(m){
    if(!sameScope(m.scope,this.scope)||!this.enabled){this.onAck(m.scope,m.snapshotSeq,'inactive-stream');this.diagnostics.dropped++;return false;}
    if(m.snapshotSeq<=this.lastSequence||m.completedSteps<this.lastSnapshotSteps){this.onAck(m.scope,m.snapshotSeq,'obsolete');this.diagnostics.duplicates++;return false;}
    const rows=validateSnapshot(m);this.lastSequence=m.snapshotSeq;this.lastSnapshotSteps=m.completedSteps;
    if(this.pending){this.onAck(this.pending.scope,this.pending.snapshotSeq,'replaced');this.diagnostics.overwritten++;}
    this.pending={...m,decodedRows:rows};this.completedSteps=Math.max(this.completedSteps,m.completedSteps);this.diagnostics.accepted++;this.diagnostics.maxPendingSlots=1;return true;
  }
  consume(mode='b',reduced=false){
    if(!this.enabled)return null;const now=this.clock();
    if(this.pending){const m=this.pending;this.pending=null;
      if(now-m.clock.producedEpochMs>this.maxTransportAgeMs){this.onAck(m.scope,m.snapshotSeq,'stale-transport');this.diagnostics.dropped++;this.synchronizing=true;this.onRequest(this.scope);return null;}
      this.synchronizing=false;this.current=m;if(!['paused','stopped','complete','saving','results'].includes(this.stage))this.stage=m.stage;this.partialNeuronUpdates=m.partialNeuronUpdates;
      const transfers=traceTransfers(m.metadata,m.decodedRows),items=[];
      for(const e of transfers){const phases=e[5]<=m.latestStep?['emit','arrival']:['emit'];for(const phase of phases){if(phase==='emit'&&e[4]<m.window.firstStep+(m.window.contextSteps||0))continue;items.push({key:[phase,e[0],e[1],e[4]].join('/'),event:e,phase});}}
      const currentIds=new Set(items.map(e=>e.key));for(const key of this.events.keys())if(!currentIds.has(key))this.events.delete(key);
      // Remember even faded events until they leave the finite window. An
      // overlapping snapshot must never restart an event's envelope.
      for(const item of items)if(!this.events.has(item.key)&&this.events.size<9216)this.events.set(item.key,{...item,bornEpochMs:now});
      this.onAck(m.scope,m.snapshotSeq,'consumed');
      this.diagnostics.latencies.push(Math.max(0,now-m.clock.producedEpochMs));this.diagnostics.latencies=this.diagnostics.latencies.slice(-256);
    }
    if(!this.current)return null;const m=this.current,lanes=mode==='a'?[0]:mode==='b'?[1]:[0,1],lookup=new Map(m.decodedRows.filter(r=>r[0]===m.latestStep).map(r=>[r[2]+'/'+r[1],r]));
    const activities=[];for(const event of [...this.events.values()].sort((a,b)=>b.event[4]-a.event[4])){const age=now-event.bornEpochMs;if(activities.length<96&&age<=300&&lanes.includes(event.event[0]))activities.push({...event,progress:reduced?.5:Math.min(1,age/180),strength:Math.max(0,1-age/300)});}
    const frame={scope:m.scope,step:m.latestStep,completedSteps:m.completedSteps,metadata:m.metadata,states:m.metadata.cells.map(cell=>({cell,lanes:lanes.map(lane=>({lane,row:lookup.get(lane+'/'+cell.index)||null}))})),activities,mode,reduced,stage:this.stage,partialNeuronUpdates:this.partialNeuronUpdates,window:m.window,clock:m.clock,snapshotSeq:m.snapshotSeq};
    this.renderedStep=m.latestStep;this.lastPresentedEpochMs=now;this.onDraw(frame);return frame;
  }
  snapshot(){return {scope:this.scope,latestSequence:this.lastSequence,latestCompletedStep:this.completedSteps-1,snapshotStep:this.current?.latestStep??-1,renderedStep:this.renderedStep,lagSteps:this.renderedStep<0?null:Math.max(0,this.completedSteps-1-this.renderedStep),snapshotAgeMs:this.current?Math.max(0,this.clock()-this.current.clock.producedEpochMs):null,completeStepAgeMs:this.current?.clock.completeStepEpochMs==null?null:Math.max(0,this.clock()-this.current.clock.completeStepEpochMs),heartbeatEpochMs:this.heartbeatEpochMs,stage:this.stage,partialNeuronUpdates:this.partialNeuronUpdates,pendingSlots:this.pending?1:0,events:this.events.size,synchronizing:!!this.synchronizing,...this.diagnostics};}
}
