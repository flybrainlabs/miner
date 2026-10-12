// Local results are explicitly unverified. Public response cards are rebuilt from owned
// ResultPage + Entitlement accounts and content-addressed archives, never a server balance.
import { digest, jsonBytes, decodeResponse } from './response-record.mjs';
import { taskForIndex } from './catalog-task.mjs';
import { validateTrace, TRACE_MAX_BYTES } from './propagation-trace.mjs';
const MAX_RESPONSE=128*1024*1024,MAX_PREVIEW=4*1024*1024;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const validHash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const safeBody=s=>typeof s==='string'&&/^[1-9][0-9]*$/.test(s)&&BigInt(s)<=0xffffffffffffffffn;
const namespace=catalog=>'flypow-responses-v1-'+hex(catalog.campaign.campaign_id);
async function directory(catalog,create=false){if(!navigator.storage?.getDirectory)throw new Error('Local response storage requires OPFS');return(await navigator.storage.getDirectory()).getDirectoryHandle(namespace(catalog),{create});}
async function write(dir,name,bytes){const f=await dir.getFileHandle(name,{create:true}),w=await f.createWritable();try{if(bytes instanceof Blob){for(let at=0;at<bytes.size;at+=4*1024*1024)await w.write(await bytes.slice(at,at+4*1024*1024).arrayBuffer());}else await w.write(bytes);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
async function read(dir,name,max){const f=await(await dir.getFileHandle(name)).getFile();if(f.size>max)throw new Error('Response file exceeds format limit');return new Uint8Array(await f.arrayBuffer());}
const parse=b=>JSON.parse(new TextDecoder().decode(b));

export function validatePreview(p,config,task,roots){
  if(p.schema!=='flypow-preview-v1'||p.task_id!==task.taskId||p.body_id!==String(task.bodyId)||p.target_index!==task.targetIndex||p.registry_root!==config.registry_sha256||p.model_root!==config.model_root_sha256||p.result_root!==roots.resultRoot||p.steps!==config.steps||p.time_step_us!==config.time_step_us||p.seed_hex!==task.seed.toString(16).padStart(16,'0'))throw new Error('Preview identity differs from the frozen task');
  if(p.stimulus.start_step!==task.stimulus.start_step||p.stimulus.end_step!==task.stimulus.end_step||BigInt(p.stimulus.current)!==BigInt(task.stimulus.current))throw new Error('Preview stimulus mismatch');
  if(!Array.isArray(p.cells)||p.cells.length<1||p.cells.length>9||p.cells.some((c,i)=>!safeBody(c.body_id)||!Number.isInteger(c.model_index)||c.model_index<0||c.model_index>=config.neuron_count||p.cells.slice(0,i).some(x=>x.body_id===c.body_id||x.model_index===c.model_index))||!p.cells.some(c=>c.body_id===p.body_id&&c.model_index===task.targetIndex))throw new Error('Preview cell mapping mismatch');
  for(const events of [p.spikes_a,p.spikes_b]){
    if(!Array.isArray(events)||events.length>p.steps*p.cells.length)throw new Error('Preview event bound');
    let step=-1,index=-1;
    for(const e of events){const cell=p.cells.find(c=>c.body_id===e[1]);if(e.length!==2||!cell||!Number.isInteger(e[0])||e[0]<0||e[0]>=p.steps||e[0]<step||(e[0]===step&&cell.model_index<=index))throw new Error('Preview spike order/identity');step=e[0];index=cell.model_index;}
  }
  if(p.global?.length!==8||p.roi?.length!==16||p.population_delta_by_bin?.length!==32||p.top?.length!==8||!Number.isInteger(p.top_count)||p.top_count<0||p.top_count>8)throw new Error('Preview summary dimensions');
  return p;
}
function validateManifest(m,task,roots){
  if(m.schema!=='flypow-archive-manifest-v1'||m.task_id!==task.taskId||m.result_root!==roots.resultRoot||m.preview_root!==roots.previewRoot||m.files?.length!==2)throw new Error('Archive manifest does not match chain roots');
  for(const [i,name,max,root]of [[0,'response.bin',MAX_RESPONSE,roots.resultRoot],[1,'preview.json',MAX_PREVIEW,roots.previewRoot]]){const f=m.files[i];if(f.name!==name||f.sha256!==root||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>max)throw new Error('Archive file declaration');}
  return m;
}

export async function saveLocalResponse(message,catalog){
  if(!validHash(message.task.taskId))throw new Error('Response task identity');
  const estimate=await navigator.storage.estimate(),need=(message.archive.byteLength??message.archive.size)+message.previewBytes.byteLength+message.manifestBytes.byteLength+(message.traceBytes?.byteLength||0)+65536;
  if(estimate.quota!=null&&estimate.usage!=null&&estimate.quota-estimate.usage<need)throw new Error('Not enough storage to save response; export the bundle instead');
  return navigator.locks.request(namespace(catalog),async()=>{
    const dir=await(await directory(catalog,true)).getDirectoryHandle(message.task.taskId,{create:true});
    await write(dir,'response.bin',message.archive);await write(dir,'preview.json',message.previewBytes);await write(dir,'manifest.json',message.manifestBytes);
    if(message.traceBytes&&message.traceManifestBytes)try{await write(dir,'trace.json',message.traceBytes);await write(dir,'trace-manifest.json',message.traceManifestBytes);}catch(error){message.traceSaveError=String(error.message||error);}
    // Record is written last. A stopped write cannot produce a complete response card.
    await write(dir,'record.json',jsonBytes(message.record));
  });
}
async function localTrace(dir,config,task,resultRoot){
  try{
    const m=parse(await read(dir,'trace-manifest.json',65536)),bytes=await read(dir,'trace.json',TRACE_MAX_BYTES);
    if(m.schema!=='flypow-trace-side-file-v1'||m.taskId!==task.taskId||m.resultRoot!==resultRoot||m.archiveMembership!==false||m.bytes!==bytes.length||await digest(bytes)!==m.sha256)throw new Error('Trace side file identity/hash mismatch');
    return {trace:validateTrace(parse(bytes),config,task,resultRoot),traceBytes:bytes.buffer,traceManifest:m,traceStatus:'local-core-observation'};
  }catch(error){return {trace:null,traceStatus:error.name==='NotFoundError'?'missing':'unavailable-or-damaged'};}
}
export async function listLocalResponses(catalog,config=null){
  let d;try{d=await directory(catalog);}catch{return [];}
  const out=[];
  for await(const [name,entry]of d.entries())if(validHash(name)&&entry.kind==='directory'){
    try{
      const r=parse(await read(entry,'record.json',65536)),task=await taskForIndex(catalog,Number(r.global_task_index));
      if(r.schema!=='flypow-response-record-v1'||r.task_id!==name||name!==task.taskId||r.body_id!==String(task.bodyId)||r.target_index!==task.targetIndex)continue;
      const roots={resultRoot:r.result_root,previewRoot:r.preview_root,archiveRoot:r.archive_manifest_hash},mBytes=await read(entry,'manifest.json',65536),pBytes=await read(entry,'preview.json',MAX_PREVIEW);
      if(await digest(mBytes)!==roots.archiveRoot||await digest(pBytes)!==roots.previewRoot)continue;
      const m=validateManifest(parse(mBytes),task,roots);if((await(await entry.getFileHandle('response.bin')).getFile()).size!==m.files[0].bytes||pBytes.length!==m.files[1].bytes)continue;
      if(config)validatePreview(parse(pBytes),config,task,roots);
      out.push({...r,verification:'LOCAL_UNVERIFIED'});
    }catch{/* Evicted, damaged or interrupted entry; never count it as a result. */}
  }
  return out.sort((a,b)=>Number(BigInt(a.global_task_index)-BigInt(b.global_task_index)));
}
export async function loadLocalPreview(catalog,config,task){
  const d=await(await directory(catalog)).getDirectoryHandle(task.taskId),record=parse(await read(d,'record.json',65536)),manifestBytes=await read(d,'manifest.json',65536),previewBytes=await read(d,'preview.json',MAX_PREVIEW);
  const roots={resultRoot:record.result_root,previewRoot:record.preview_root,archiveRoot:record.archive_manifest_hash};
  if(await digest(manifestBytes)!==roots.archiveRoot||await digest(previewBytes)!==roots.previewRoot)throw new Error('Saved preview is damaged');
  const m=validateManifest(parse(manifestBytes),task,roots),preview=validatePreview(parse(previewBytes),config,task,roots);
  return {task,config,bodyId:task.bodyId,archive:null,localArchive:true,responseBytes:m.files[0].bytes,record:{...record,verification:'LOCAL_UNVERIFIED'},preview,previewBytes:previewBytes.buffer,manifestBytes:manifestBytes.buffer,...roots,resultHash:roots.resultRoot,...await localTrace(d,config,task,roots.resultRoot)};
}
export async function loadLocalResponse(catalog,config,task){
  const d=await(await directory(catalog)).getDirectoryHandle(task.taskId);
  const record=parse(await read(d,'record.json',65536)),manifestBytes=await read(d,'manifest.json',65536),previewBytes=await read(d,'preview.json',MAX_PREVIEW),archive=await read(d,'response.bin',MAX_RESPONSE);
  const roots={resultRoot:record.result_root,previewRoot:record.preview_root,archiveRoot:record.archive_manifest_hash};
  if(await digest(manifestBytes)!==roots.archiveRoot||await digest(previewBytes)!==roots.previewRoot||await digest(archive)!==roots.resultRoot)throw new Error('Saved response is damaged or evicted');
  const manifest=validateManifest(parse(manifestBytes),task,roots),preview=validatePreview(parse(previewBytes),config,task,roots);
  if(manifest.files[0].bytes!==archive.length||manifest.files[1].bytes!==previewBytes.length)throw new Error('Saved response size mismatch');decodeResponse(archive,config,task);
  return {task,config,bodyId:task.bodyId,archive:archive.buffer,record,preview,previewBytes:previewBytes.buffer,manifestBytes:manifestBytes.buffer,...roots,resultHash:roots.resultRoot,elapsedMs:null,...await localTrace(d,config,task,roots.resultRoot)};
}
async function fetchBounded(url,max,signal){
  const res=await fetch(url,{signal,credentials:'omit'});if(!res.ok||!res.body)throw new Error('Archive unavailable');
  if(Number(res.headers.get('content-length'))>max)throw new Error('Archive response exceeds declared size');
  const reader=res.body.getReader(),parts=[];let n=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>max)throw new Error('Archive response exceeds format limit');parts.push(value);}const out=new Uint8Array(n);let at=0;for(const b of parts){out.set(b,at);at+=b.length;}return out;}
  finally{await reader.cancel().catch(()=>{});}
}
export async function loadArchivedResponse(chain,page,entitlement,config,signal){
  if(!page.complete||!page.archived)throw new Error('Task has no archived chain result');
  const roots={resultRoot:hex(page.resultRoot),previewRoot:hex(page.previewRoot),archiveRoot:hex(page.archiveRoot)};let lastError;
  for(const origin of chain.config.archives){
    try{
      const base=origin.replace(/\/$/,'')+'/v1/archive/'+roots.archiveRoot+'/';
      const manifestBytes=await fetchBounded(base+'manifest.json',65536,signal);if(await digest(manifestBytes)!==roots.archiveRoot)throw new Error('Public archive manifest hash mismatch');
      const m=validateManifest(parse(manifestBytes),page.task,roots),previewBytes=await fetchBounded(base+'preview.json',m.files[1].bytes,signal);
      if(previewBytes.length!==m.files[1].bytes||await digest(previewBytes)!==roots.previewRoot)throw new Error('Public preview hash mismatch');
      const preview=validatePreview(parse(previewBytes),config,page.task,roots);
      // Viewing only downloads the lightweight replay. Full spikes are separately available.
      const record={schema:'flypow-response-record-v1',task_id:page.task.taskId,global_task_index:String(page.k),body_id:String(page.task.bodyId),target_index:page.task.targetIndex,verification:'CHAIN_ARCHIVED',contributor:entitlement?hex(entitlement.miner):null,chain:{campaign:chain.campaign.toBase58(),result_page:page.address.toBase58(),submission:hex(page.winner)},claim_atoms:entitlement?String(entitlement.minerWhole*100000000n-entitlement.minerClaimed):'0',...{result_root:roots.resultRoot,preview_root:roots.previewRoot,archive_manifest_hash:roots.archiveRoot},summary:{global:preview.global,roi:preview.roi,time:preview.population_delta_by_bin,top:preview.top.slice(0,preview.top_count)}};
      return {record,preview,manifestBytes:manifestBytes.buffer,previewBytes:previewBytes.buffer,...roots,resultHash:roots.resultRoot,task:page.task,bodyId:page.task.bodyId,archive:null,archiveUrl:base+'response.bin',responseBytes:m.files[0].bytes,elapsedMs:null};
    }catch(error){if(signal?.aborted)throw error;lastError=error;}
  }
  throw lastError||new Error('No archive provider configured; chain roots remain available');
}
