import {CandidateIndex} from './candidate-index.mjs';
import { canonical,hash,root,hex } from './target-protocol-v2.mjs';
import { jsonBytes,digest } from './response-record.mjs';
import { validateTargetRecord } from './target-response-record.mjs';
import { validateFactoryRecord } from './task-factory-result-v4.mjs';
import { factoryTrialTask } from './task-factory-v4-science.mjs';
const encoder=new TextEncoder();
async function write(d,name,data){const h=await d.getFileHandle(name,{create:true}),w=await h.createWritable();try{if(data instanceof Blob){for(let at=0;at<data.size;at+=4*1024*1024)await w.write(await data.slice(at,at+4*1024*1024).arrayBuffer());}else await w.write(data);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
export class CandidateStoreV2 {
  constructor(network){this.network=network;this.config=null;this.name=null;this.pending=new Map();this.v4=network.protocolVersion===4;this.index=new CandidateIndex(this);this.repaired=new Set();}
  async directory(create=true){this.name||=(this.v4?'flybrainlabs-candidates-v4-':'flypow-candidates-v2-')+await hash(encoder.encode(this.network.networkId+'\0'+(this.v4?this.network.campaignId:this.network.authorityId)));return(await navigator.storage.getDirectory()).getDirectoryHandle(this.name,{create});}
  async candidate(id,create=true){root(id);return(await this.directory(create)).getDirectoryHandle(id,{create});}
  async metadata(id){const d=await this.candidate(id,false),f=await(await d.getFileHandle('state.json')).getFile();if(f.size>1024*1024)throw new Error('Candidate metadata bound');const m=JSON.parse(await f.text());if(m.schema!==(this.v4?'flybrainlabs-candidate-state-v4':'flypow-candidate-state-v2')||m.candidateId!==id)throw new Error('Candidate state identity');return m;}
  async update(m){return this.index.mutate(m,async()=>write(await this.candidate(m.candidateId),'state.json',canonical(m)));}
  async begin(round,input,candidateId){if((round.pre.protocolVersion===4)!==this.v4)throw new Error('Candidate store protocol mismatch');try{return await this.metadata(candidateId);}catch(e){if(e.name!=='NotFoundError')throw e;}return this.update({schema:this.v4?'flybrainlabs-candidate-state-v4':'flypow-candidate-state-v2',candidateId,roundId:round.roundId,goalId:round.pre.goalId,input,round,phase:'computing',trials:[],partial:true,archiveSaved:false,independentlyReplayed:false,sciencePassed:false,won:false,createdAt:Date.now(),executionIds:[]});}
  async saveTrial(meta,r){
    const id=root(r.task.trialId),d=await(await this.candidate(meta.candidateId)).getDirectoryHandle(id,{create:true});this.pending.set(r.trace?.executionId||id,r);
    const t={trialId:id,repeatIndex:r.task.repeatIndex,seedHex:r.task.seed.toString(16).padStart(16,'0'),resultRoot:r.resultHash,bytes:r.responseBytes,metrics:r.goalMetrics};
    const record=(this.v4?validateFactoryRecord:validateTargetRecord)(r.record,meta,t,r.task),prior=meta.trials.find(x=>x.repeatIndex===t.repeatIndex);if(prior&&hex(canonical(prior))!==hex(canonical(t)))throw new Error('Immutable saved trial conflict');
    await write(d,'response.bin',r.archive);await write(d,'preview.json',r.previewBytes);await write(d,'record.json',jsonBytes(record));await write(d,'manifest.json',r.manifestBytes);
    if(r.traceBytes)try{await write(d,'trace.json',r.traceBytes);}catch(e){r.traceSaveError=e.message;}
    await write(d,'complete.json',canonical({version:1,candidateId:meta.candidateId,trial:t}));
    // Commit state.json last. A failed metadata write must not mutate the
    // runner's view of saved trials or turn retained staging into saved data.
    const next={...meta,trials:[...meta.trials],executionIds:[...new Set([...meta.executionIds,r.trace?.executionId||id])],archiveSaved:true,savedAt:Date.now()};if(!prior)next.trials.push(t);next.trials.sort((a,b)=>a.repeatIndex-b.repeatIndex);await this.update(next);Object.assign(meta,next);this.pending.delete(r.trace?.executionId||id);return t;
  }
  async archive(meta,j){const t=meta.trials[j];if(!t)throw new Error('Missing trial evidence');const d=await(await this.candidate(meta.candidateId,false)).getDirectoryHandle(t.trialId),f=await(await d.getFileHandle('response.bin')).getFile();if(f.size!==t.bytes||await hash(await f.arrayBuffer())!==t.resultRoot)throw new Error('Saved candidate artifact damaged');return f;}
  async bundle(meta,j=meta.trials.length-1){
    const t=meta.trials[j];if(!t||t.repeatIndex!==j)throw new Error('Incomplete ordered V2 history');
    const d=await(await this.candidate(meta.candidateId,false)).getDirectoryHandle(t.trialId),bytes=async name=>{const f=await(await d.getFileHandle(name)).getFile();if(f.size>16*1024*1024)throw new Error('V2 side file bound');return f.arrayBuffer();};
    const {trialTask}=await import('./target-protocol-v2.mjs');const task=await (this.v4?factoryTrialTask:trialTask)(meta.round,meta.input,j),record=(this.v4?validateFactoryRecord:validateTargetRecord)(JSON.parse(new TextDecoder().decode(await bytes('record.json'))),meta,t,task),previewBytes=await bytes('preview.json'),preview=JSON.parse(new TextDecoder().decode(previewBytes));
    if(await digest(previewBytes)!==record.preview_root||preview.task_id!==task.trialId||preview.result_root!==t.resultRoot||preview.seed_hex!==t.seedHex)throw new Error('Damaged V2 preview binding');
    let manifestBytes;try{manifestBytes=await bytes('manifest.json');}catch(e){if(e.name!=='NotFoundError')throw e;if(this.v4)throw new Error('V4 trial manifest is unavailable; original archive retained');const legacy=record.compatibility==='nested-development-v2';manifestBytes=jsonBytes(legacy?{schema:'flypow-archive-manifest-v1',task_id:task.trialId,result_root:t.resultRoot,preview_root:record.preview_root,files:[{name:'response.bin',bytes:t.bytes,sha256:t.resultRoot},{name:'preview.json',bytes:previewBytes.byteLength,sha256:record.preview_root}]}:{schema:'flypow-target-trial-archive-v2',protocolVersion:2,roundId:record.roundId,goalId:record.goalId,candidateId:record.candidateId,trialId:record.trialId,repeatIndex:j,seedHex:t.seedHex,input:meta.input,parameterProfileHash:record.parameterProfileHash,resultRoot:t.resultRoot,previewRoot:record.preview_root,files:[{name:'response.bin',bytes:t.bytes,sha256:t.resultRoot},{name:'preview.json',bytes:previewBytes.byteLength,sha256:record.preview_root}]}).buffer;}
    if(await digest(manifestBytes)!==record.archive_manifest_hash)throw new Error('Damaged V2 trial manifest');
    let trace=null;try{trace=JSON.parse(new TextDecoder().decode(await bytes('trace.json')));}catch(e){if(e.name!=='NotFoundError')throw e;}
    return {task,config:this.config,record,preview,trace,resultHash:t.resultRoot,responseBytes:t.bytes,archive:await this.archive(meta,j),goalMetrics:t.metrics,candidateState:meta,previewBytes,manifestBytes};
  }
  async repair(meta){
    if(this.repaired.has(meta.candidateId)||!meta.partial)return meta;
    const dir=await this.candidate(meta.candidateId,false);let changed=false;const completed=[];
    for await(const [id,h]of dir.entries())if(h.kind==='directory'&&/^[0-9a-f]{64}$/.test(id)&&!meta.trials.some(t=>t.trialId===id)){
      try{
        const f=await(await h.getFileHandle('complete.json')).getFile();if(f.size>65536)throw new Error('Trial completion bound');const receipt=JSON.parse(await f.text()),t=receipt.trial;
        if(receipt.version!==1||receipt.candidateId!==meta.candidateId||t.trialId!==id||!Number.isSafeInteger(t.repeatIndex)||t.repeatIndex<0||t.repeatIndex>=meta.round.pre.requiredBackgrounds)continue;completed.push(t);
      }catch(error){if(error.name!=='NotFoundError')this.repairError=error.message;}
    }
    // OPFS directory order is unspecified. Recover only the complete ordered
    // prefix, even when more than one durable trial descriptor survived.
    for(const t of completed.sort((a,b)=>a.repeatIndex-b.repeatIndex))try{
        if(t.repeatIndex!==meta.trials.length)continue;
        const next={...meta,trials:[...meta.trials,t]};const bundle=await this.bundle(next,t.repeatIndex);
        const {evaluate}=await import('./target-protocol-v2.mjs');t.metrics=await evaluate(meta.round.goal,meta.input,new Uint8Array(await bundle.archive.arrayBuffer()));
        meta.trials.push(t);meta.archiveSaved=true;meta.savedAt=Date.now();changed=true;
      }catch(error){if(error.name!=='NotFoundError')this.repairError=error.message;}
    if(changed||meta.partial&&(meta.trials.length===meta.round.pre.requiredBackgrounds||meta.trials.some(t=>!t.metrics.passed))){const failed=meta.trials.some(t=>!t.metrics.passed);meta.partial=!failed&&meta.trials.length<meta.round.pre.requiredBackgrounds;meta.sciencePassed=!failed&&!meta.partial;meta.searchComplete=failed||!meta.partial;meta.phase=failed?'candidate-failed-science':meta.partial?'partial-trial-interrupted':'candidate-saved-passing-awaiting-submit';await this.update(meta);}
    this.repaired.add(meta.candidateId);return meta;
  }
  async list(options){try{await this.directory(false);}catch(e){if(e.name==='NotFoundError')return [];throw e;}const page=await this.index.select(options);this.historyPage=page;const rows=[];for(const id of page.ids)rows.push(await this.repair(await this.metadata(id)));return rows.sort((a,b)=>(b.savedAt||b.createdAt)-(a.savedAt||a.createdAt));}
  async usage(){try{return await this.index.select({limit:1,includeActive:false});}catch(e){if(e.name==='NotFoundError')return {bytes:0,total:0,active:0};throw e;}}
  async exportFiles(meta){
    const files=[],safe={schema:this.v4?'flybrainlabs-candidate-export-v4':'flypow-candidate-export-v2',candidateId:meta.candidateId,roundId:meta.roundId,goalId:meta.goalId,input:meta.input,round:meta.round,trials:meta.trials,partial:meta.partial,completedBackgrounds:meta.trials.map(t=>t.repeatIndex),requiredBackgrounds:meta.round.pre.requiredBackgrounds,sciencePassed:meta.sciencePassed,won:meta.won,receipt:meta.receipt||null,authorityWinner:meta.authorityWinner||null,displayTrace:'Sampled observation only; independent of full scientific response.bin'};
    files.push({name:'candidate.json',data:new Blob([jsonBytes(safe)])});if(meta.manifest)files.push({name:'manifest.json',data:new Blob([jsonBytes(meta.manifest)])});
    for(let j=0;j<meta.trials.length;j++){const t=meta.trials[j],dir=await(await this.candidate(meta.candidateId,false)).getDirectoryHandle(t.trialId);files.push({name:`background-${j+1}/response.bin`,data:await this.archive(meta,j)});for(const name of ['record.json','preview.json','manifest.json','trace.json'])try{const f=await(await dir.getFileHandle(name)).getFile();files.push({name:`background-${j+1}/${name}`,data:f});}catch(e){if(e.name!=='NotFoundError')throw e;}}
    return files;
  }
  async cursor(roundId,minerId){try{const d=await this.directory(),f=await(await d.getFileHandle('cursor-'+roundId+'-'+minerId+'.json')).getFile();return JSON.parse(await f.text());}catch{return {visited:[],cursor:0};}}
  async saveCursor(roundId,minerId,state){await write(await this.directory(),'cursor-'+roundId+'-'+minerId+'.json',canonical(state));}
}
