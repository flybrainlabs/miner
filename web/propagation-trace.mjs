import { jsonBytes, digest } from './response-record.mjs';
export const TRACE_VERSION='flypow-propagation-trace-v1';
export const TRACE_MAX_BYTES=16*1024*1024;
// Stable breadth-first selection of actual CSR neighbors. Never joins hidden nodes.
export function selectSubnetwork(graph,model,n,target,{cells=32,edges=128}={}){
  if(!Number.isInteger(cells)||cells<1||cells>64||!Number.isInteger(edges)||edges<1||edges>256)throw new Error('Trace visual budget');
  const offsets=52+n*8,edgeStart=offsets+(n+1)*8,offset=i=>Number(graph.getBigUint64(offsets+i*8,true));
  const selected=[target],seen=new Set(selected),tree=[];
  for(let at=0;at<selected.length&&selected.length<cells;at++){
    const source=selected[at];
    for(let edgeId=offset(source);edgeId<offset(source+1)&&selected.length<cells;edgeId++){
      const to=graph.getUint32(edgeStart+edgeId*8,true);
      if(!seen.has(to)){seen.add(to);selected.push(to);tree.push(edgeId);}
    }
  }
  const selectedEdges=new Set(tree.slice(0,edges));let outgoing=0;
  for(const source of selected){outgoing+=offset(source+1)-offset(source);for(let id=offset(source);id<offset(source+1)&&selectedEdges.size<edges;id++)if(seen.has(graph.getUint32(edgeStart+id*8,true)))selectedEdges.add(id);}
  const connection=id=>{
    let lo=0,hi=n;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(offset(mid+1)<=id)lo=mid+1;else hi=mid;}
    const sourceIndex=lo,targetIndex=graph.getUint32(edgeStart+id*8,true),sign=model.getInt8(44+lo);
    return {edgeId:id,sourceIndex,targetIndex,signedCurrent:String(BigInt(graph.getUint32(edgeStart+id*8+4,true))*BigInt(sign))};
  };
  return {cells:selected.map((index,i)=>({index,bodyId:graph.getBigUint64(52+index*8,true).toString(),depth:i===0?0:null,stimulus:index===target,sign:model.getInt8(44+index)})),edges:[...selectedEdges].sort((a,b)=>a-b).map(connection),selection:selected.sort((a,b)=>a-b),omittedOutgoingEdges:outgoing-selectedEdges.size};
}
export function traceIdentity(config,task,executionId,subnet){
  return {schema:TRACE_VERSION,traceVersion:1,executionId,taskId:task.taskId,resultRoot:null,
    ...(task.protocolVersion===2?{protocolVersion:2,roundId:task.roundId,goalHash:task.goalId,candidateId:task.candidateId,trialId:task.trialId}:{}),
    registryRoot:config.registry_sha256,graphRoot:config.graph_sha256,modelRoot:config.model_root_sha256,
    parameterVersion:config.parameter_version||'lif-point-v0-dev',timeStepUs:config.time_step_us,observeStart:config.observe_start||0,steps:config.steps,stimulus:task.stimulus,seedHex:task.seed.toString(16).padStart(16,'0'),
    selectionPolicy:'csr-bfs-target-ascending-neighbor-v1; spanning edges first, then actual induced CSR edges',
    coverage:{cells:subnet.cells.length,edges:subnet.edges.length,firstStep:0,lastStep:-1,complete:false,pointNeurons:true,geometry:'schematic cell-to-cell connections; no synapse spatial trajectories'},
    omittedCounts:{cells:config.neuron_count-subnet.cells.length,modelEdges:config.directed_connection_count-subnet.edges.length,outgoingEdges:subnet.omittedOutgoingEdges},truncationReason:'visual budget only; full scientific events retained',
    verification:'LOCAL_CORE_OBSERVATION_NOT_INDEPENDENTLY_VERIFIED',cells:subnet.cells,edges:subnet.edges,states:[],transfers:[]};
}
// Immutable messages -> independent viewing buffers. Sequence gaps stay gaps.
export class TraceInbox {
  constructor({maxBytes=32*1024*1024,maxExecutions=8}={}){Object.assign(this,{maxBytes,maxExecutions});this.entries=new Map();this.bytes=0;}
  receive(m){
    if(typeof m.executionId!=='string'||!Number.isInteger(m.sequence)||m.sequence<0||m.sequence>65536||!(m.rows instanceof ArrayBuffer)||m.rows.byteLength>2048*72||m.rows.byteLength%72)throw new Error('Bounded trace batch identity');
    let e=this.entries.get(m.executionId);if(!e){e={executionId:m.executionId,taskId:m.taskId,trace:null,nextSequence:0,pending:new Map(),accepted:new Map(),bytes:0,lastReceivedAt:performance.now(),gap:false};this.entries.set(m.executionId,e);}
    if(e.taskId!==m.taskId)throw new Error('Trace execution/task mismatch');
    const old=e.accepted.get(m.sequence)||e.pending.get(m.sequence);if(old){const a=new Uint8Array(old.rows),b=new Uint8Array(m.rows);if(a.length!==b.length||a.some((x,i)=>x!==b[i]))throw new Error('Conflicting duplicate trace batch');return e;}
    if(e.pending.size>=64||e.bytes+m.rows.byteLength>TRACE_MAX_BYTES)throw new Error('Trace gap/cache budget');
    e.pending.set(m.sequence,m);e.bytes+=m.rows.byteLength;this.bytes+=m.rows.byteLength;e.lastReceivedAt=performance.now();
    if(m.identity){if(m.sequence!==0||m.identity.executionId!==m.executionId||m.identity.taskId!==m.taskId)throw new Error('Trace first batch identity');if(!e.trace)e.trace=structuredClone(m.identity);}
    while(e.trace&&e.pending.has(e.nextSequence)){const msg=e.pending.get(e.nextSequence),rows=decodeTraceRows(new Uint8Array(msg.rows));e.pending.delete(e.nextSequence);e.accepted.set(e.nextSequence,msg);e.nextSequence++;e.trace.states.push(...rows);e.trace.transfers.push(...traceTransfers(e.trace,rows));e.trace.coverage.lastStep=Math.floor(e.trace.states.length/(e.trace.cells.length*2))-1;if(e.trace.coverage.lastStep!==msg.lastStep)throw new Error('Non-contiguous recorded steps');}
    e.gap=e.pending.size>0;this.trim(m.executionId);return e;
  }
  trim(keep){for(const [id,e]of this.entries){if(this.bytes<=this.maxBytes&&this.entries.size<=this.maxExecutions)break;if(id!==keep){this.entries.delete(id);this.bytes-=e.bytes;}}}
  snapshot(id){const e=this.entries.get(id);return e?{executionId:id,nextSequence:e.nextSequence,continuousSteps:(e.trace?.coverage.lastStep??-1)+1,gap:e.gap,pendingBatches:e.pending.size,bytes:e.bytes,lastReceivedAt:e.lastReceivedAt,cacheBytes:this.bytes}:null;}
}
export function decodeTraceRows(bytes){
  if(bytes.byteLength%72)throw new Error('Trace row length');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),rows=[];
  for(let at=0;at<bytes.byteLength;at+=72){const row=[v.getUint32(at,true),v.getUint32(at+4,true),v.getUint8(at+8),!!v.getUint8(at+9),v.getUint8(at+10),v.getUint8(at+11)];for(let i=0;i<7;i++)row.push(v.getBigInt64(at+12+i*8,true).toString());rows.push(row);}
  return rows;
}
export function traceTransfers(trace,states=trace.states){
  const outgoing=new Map();for(const e of trace.edges){if(!outgoing.has(e.sourceIndex))outgoing.set(e.sourceIndex,[]);outgoing.get(e.sourceIndex).push(e);}
  const transfers=[];for(const row of states)if(row[3])for(const e of outgoing.get(row[1])||[])transfers.push([row[2],e.edgeId,e.sourceIndex,e.targetIndex,row[0],row[0]+1,e.signedCurrent]);return transfers;
}
export function validateTrace(trace,config,task,resultRoot,{temporary=false}={}){
  if(trace.schema!==TRACE_VERSION||trace.taskId!==task.taskId||trace.registryRoot!==config.registry_sha256||trace.graphRoot!==config.graph_sha256||trace.modelRoot!==config.model_root_sha256||trace.timeStepUs!==config.time_step_us||trace.steps!==config.steps||trace.observeStart!==(config.observe_start||0)||trace.parameterVersion!==(config.parameter_version||'lif-point-v0-dev')
    ||(!temporary&&(!trace.coverage?.complete||trace.resultRoot!==resultRoot))||(temporary&&trace.resultRoot!==null))throw new Error('Trace identity mismatch');
  if(trace.cells?.length<1||trace.cells.length>64||trace.edges?.length>256||trace.states?.length>trace.cells.length*trace.steps*2)throw new Error('Trace scope bound');
  const cells=new Set(),edges=new Set(),fired=new Set();for(const c of trace.cells){if(!Number.isInteger(c.index)||c.index<0||c.index>=config.neuron_count||cells.has(c.index)||!/^\d+$/.test(c.bodyId))throw new Error('Trace cells');cells.add(c.index);}
  if(!trace.cells.some(c=>c.index===task.targetIndex&&c.bodyId===String(task.bodyId)))throw new Error('Trace target mismatch');
  for(const e of trace.edges){if(!Number.isInteger(e.edgeId)||e.edgeId<0||e.edgeId>=config.directed_connection_count||edges.has(e.edgeId)||!cells.has(e.sourceIndex)||!cells.has(e.targetIndex)||BigInt(e.signedCurrent)===0n)throw new Error('Trace edge');edges.add(e.edgeId);}
  let prior=-1;for(const r of trace.states){const key=(r[0]*config.neuron_count+r[1])*2+r[2];if(r.length!==13||!Number.isInteger(r[0])||r[0]<0||r[0]>=trace.steps||!cells.has(r[1])||![0,1].includes(r[2])||key<=prior||typeof r[3]!=='boolean'||r.slice(4,6).some(x=>!Number.isInteger(x)||x<0||x>32))throw new Error('Trace state order');for(const v of r.slice(6))if(!/^-?\d+$/.test(v)||BigInt(v)<-0x8000000000000000n||BigInt(v)>0x7fffffffffffffffn)throw new Error('Trace model unit');prior=key;if(r[3])fired.add(`${r[2]}/${r[0]}/${r[1]}`);}
  if(!temporary&&trace.states.length!==trace.cells.length*trace.steps*2)throw new Error('Incomplete trace states');
  const actual=traceTransfers(trace);if(JSON.stringify(actual)!==JSON.stringify(trace.transfers))throw new Error('Trace transfer/spike/edge disagreement');
  return trace;
}
export async function traceSideFile(trace){
  const bytes=jsonBytes(trace);if(bytes.length>TRACE_MAX_BYTES)throw new Error('Trace side file exceeds visual budget');
  const manifest={schema:'flypow-trace-side-file-v1',taskId:trace.taskId,resultRoot:trace.resultRoot,sha256:await digest(bytes),bytes:bytes.length,verification:trace.verification,archiveMembership:false};
  return {bytes,manifestBytes:jsonBytes(manifest)};
}
// Index once. Frame lookup touches only a bounded subnet at a single model time.
export class TraceIndex {
  constructor(trace){this.states=new Map();this.sent=new Map();this.stateAt=0;this.transferAt=0;this.append(trace);}
  append(trace){this.trace=trace;for(;this.stateAt<trace.states.length;this.stateAt++){const r=trace.states[this.stateAt];this.states.set(`${r[2]}/${r[0]}/${r[1]}`,r);}for(;this.transferAt<trace.transfers.length;this.transferAt++){const e=trace.transfers[this.transferAt],key=e[0]+'/'+e[4];if(!this.sent.has(key))this.sent.set(key,[]);this.sent.get(key).push(e);}}
  frame(time,mode='b'){
    const step=Math.floor(time),fraction=time-step,lanes=mode==='a'?[0]:mode==='b'?[1]:[0,1];
    const states=this.trace.cells.map(c=>({cell:c,lanes:lanes.map(lane=>({lane,row:this.states.get(`${lane}/${step}/${c.index}`)||null}))}));
    const moving=lanes.flatMap(lane=>this.sent.get(lane+'/'+step)||[]);
    return {step,fraction,states,moving,arrived:lanes.flatMap(lane=>this.sent.get(lane+'/'+(step-1))||[]),outside:moving.some(e=>e[5]>=this.trace.steps)};
  }
}
