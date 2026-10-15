// A completed staging file outlives UI/save errors and browser refresh.
// Unique execution metadata is written before notification. No latest-only pointer.
import { jsonBytes,digest } from './response-record.mjs';
const NAME='flypow-result-staging-v1';
const safe=name=>typeof name==='string'&&/^[a-zA-Z0-9-]{8,128}\.bin$/.test(name);
async function dir(create=false){return(await navigator.storage.getDirectory()).getDirectoryHandle(NAME,{create});}
async function write(d,name,bytes){const f=await d.getFileHandle(name,{create:true}),w=await f.createWritable();try{await w.write(bytes);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
export async function retainOutput(r,identity={}){
  if(!safe(r.temporary)||!navigator.storage?.getDirectory)return;
  const d=await dir(true),metadata={schema:'flypow-retained-output-v1',temporary:r.temporary,resultHash:r.resultHash,responseBytes:r.responseBytes,task:r.task,config:r.config,record:r.record,preview:r.preview,manifest:JSON.parse(new TextDecoder().decode(r.manifestBytes)),computation:r.computation,goalMetrics:r.goalMetrics||null,networkId:identity.round?.pre?.networkId||null,authorityId:identity.round?.pre?.authorityId||null,executionId:identity.executionId,operationId:identity.operationId,workerId:identity.workerId,sessionId:identity.sessionId,saved:false};
  if(r.traceBytes)try{if(r.traceBytes.byteLength>16*1024*1024)throw new Error('Display trace recovery bound');await write(d,r.temporary+'.trace.json',r.traceBytes);metadata.traceRoot=await digest(r.traceBytes);metadata.traceBytes=r.traceBytes.byteLength;}catch(error){metadata.traceRecoveryError=error.message;}
  await write(d,r.temporary+'.json',jsonBytes(metadata));
}
export async function releaseOutput(name){if(!safe(name))throw new Error('Staging output identity');const d=await dir();await d.removeEntry(name);for(const suffix of ['.json','.trace.json'])await d.removeEntry(name+suffix).catch(e=>{if(e.name!=='NotFoundError')throw e;});}
export async function rememberOutputSaveError(r,error){
  // Best effort only. An exhausted quota must not overwrite or remove the
  // completed archive when the small diagnostic write also fails.
  if(!safe(r.temporary))return;
  const d=await dir(),f=await(await d.getFileHandle(r.temporary+'.json')).getFile();
  if(f.size>1024*1024)throw new Error('Retained output metadata bound');
  const m=JSON.parse(await f.text());if(m.schema!=='flypow-retained-output-v1'||m.temporary!==r.temporary||m.resultHash!==r.resultHash)throw new Error('Retained output diagnostic identity');
  m.saveError={code:r.saveError?.code||'operation',name:error.name||'Error',detail:String(error.message||error).slice(0,2048)};await write(d,r.temporary+'.json',jsonBytes(m));
}
export async function retainedOutputs(){let d;try{d=await dir();}catch{return [];}const out=[];for await(const [name,h]of d.entries())if(name.endsWith('.bin.json')&&h.kind==='file')try{const f=await h.getFile();if(f.size>1024*1024)continue;const m=JSON.parse(await f.text());if(m.schema!=='flypow-retained-output-v1'||!safe(m.temporary))continue;const archive=await(await d.getFileHandle(m.temporary)).getFile();if(archive.size!==m.responseBytes)continue;let trace=null,traceBytes; if(m.traceRoot)try{const f=await(await d.getFileHandle(m.temporary+'.trace.json')).getFile();if(f.size!==m.traceBytes||f.size>16*1024*1024)throw new Error('Retained display trace length');traceBytes=await f.arrayBuffer();if(await digest(traceBytes)!==m.traceRoot)throw new Error('Retained display trace hash');trace=JSON.parse(new TextDecoder().decode(traceBytes));}catch(e){traceBytes=undefined;m.traceRecoveryError=e.message;}out.push({...m,archive,task:{...m.task,seed:BigInt(m.task.seed)},previewBytes:jsonBytes(m.preview).buffer,manifestBytes:jsonBytes(m.manifest).buffer,trace,traceBytes,saveError:m.saveError||{code:'operation',detail:null}});}catch{/* An interrupted metadata write never marks a partial archive complete. */}return out;}
export async function retainedCandidateOutputs(network,store){
  const selected=[];
  for(const r of await retainedOutputs()){
    if(r.task?.protocolVersion!==(network.protocolVersion===4?4:2)||r.networkId&&r.networkId!==network.networkId||r.authorityId&&r.authorityId!==network.authorityId)continue;
    // Older metadata lacked the namespace. Require its existing candidate's
    // frozen round to match; unrelated outputs remain on disk, never deleted.
    let m;try{m=await store.metadata(r.task.candidateId);}catch(e){if(e.name==='NotFoundError')continue;throw e;}
    if(m.round?.pre?.networkId===network.networkId&&(network.protocolVersion===4?m.round.pre.factoryAddress===network.campaignId:m.round.pre.authorityId===network.authorityId)&&m.roundId===r.task.roundId&&m.goalId===r.task.goalId)selected.push(r);
  }
  return selected;
}
