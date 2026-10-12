import { targetRecord } from './target-response-record.mjs';
import { buildOfficial, createHasher, hex } from '/assets/vendor/generated/official-builder.mjs?v=mining-workbench-v1';
import { stageSource, markSourceChecked, saveArtifact, inputDirectoryName } from '/assets/chunk-store.mjs?v=mining-workbench-v1';
import { buildRecord, buildRecordFile, jsonBytes } from '/assets/response-record.mjs';
import { modelDirectoryName } from './model-storage.mjs';
import { ComputationMeter } from './computation.mjs';
import { validateDeployment } from './mining-deployment.mjs';
import { preparationEvent } from './preparation-progress.mjs';
import { checkCatalog, taskForIndex } from './catalog-task.mjs';
import { selectSubnetwork, traceIdentity, decodeTraceRows, traceTransfers, traceSideFile } from './propagation-trace.mjs';
import { validateRound, trialTask, evaluate as evaluateGoal } from './target-protocol-v2.mjs';
import { retainOutput, releaseOutput } from './pending-output.mjs';
import { LiveSnapshotSender, completeWindowBoundary, epochNow } from './live-observation.mjs';
let instance = null;
let wasmModule = null;
let graph = null;
let model = null;
let busy = false;
let computation = null;
let handle = 0;
let loadedIdentity = null;
let operation = null;
let runControl = null;
let lastCompute = 0;
let liveSender=null,lastCompleteStepEpochMs=null,progressInFlight=null,progressLatest=null,progressSequence=0;
function computeProgress(m){progressLatest=m;if(progressInFlight!==null)return;progressInFlight=++progressSequence;post({...progressLatest,progressSeq:progressInFlight});progressLatest=null;}
const catalogs = new Map();
const post=(m,transfer)=>self.postMessage({...m,networkId:m.networkId||operation?.networkId||'local-tools',roundId:m.roundId||operation?.task?.roundId||operation?.round?.roundId||'',taskId:m.taskId||operation?.task?.taskId,workerId:operation?.workerId,sessionId:operation?.sessionId,executionId:operation?.executionId,configKey:operation?.configKey,operationId:operation?.operationId,generation:operation?.generation},transfer);
const channel = new MessageChannel();
const yieldTask = () => new Promise(resolve=>{channel.port1.onmessage=resolve;channel.port2.postMessage(0);});
const progress = (stageId,label,loaded,total,detail={}) => post({type:'progress',label,loaded,...preparationEvent(operation.operationId,stageId,loaded,total,{elapsedMs:performance.now()-operation.started,...detail})});

const wasmUrl = '/assets/wasm/flypow_sim_core.wasm';
const cacheName = modelDirectoryName;

async function cacheDirectory(config, create) {
  if (!navigator.storage?.getDirectory) throw new Error('OPFS is unavailable in this browser');
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(cacheName(config), { create });
}

async function boot() {
  if (instance) return instance;
  wasmModule=operation?.wasmModule||wasmModule;
  if(!wasmModule){const response=await fetch(wasmUrl,{cache:'no-store'});if(!response.ok)throw new Error('WASM core unavailable');wasmModule=await WebAssembly.compileStreaming(response);}
  instance = await WebAssembly.instantiate(wasmModule, {flypow:{progress:(...counts)=>{
    if(computation){const before=computation.counters.completedSteps,value=computation.step(...counts);if(value.completedSteps>before)lastCompleteStepEpochMs=epochNow();const now=performance.now();if(now-lastCompute>=100||value.completedSteps===0||value.completedSteps===value.totalSteps){lastCompute=now;computeProgress(value);}}
  }}});
  return instance;
}

function digestHex(pointer, length) {
  const { memory, flypow_alloc, flypow_free, flypow_sha256 } = instance.exports;
  const output = flypow_alloc(32);
  if (!output) throw new Error('Unable to allocate digest buffer');
  try {
    if (flypow_sha256(pointer, length, output) !== 1) throw new Error('SHA-256 failed');
    return Array.from(new Uint8Array(memory.buffer, output, 32), value => value.toString(16).padStart(2, '0')).join('');
  } finally { flypow_free(output, 32); }
}

async function loadFile(file, expectedLength, expectedHash, label) {
  if (file.size !== expectedLength) throw new Error(`${label} length differs from frozen version`);
  const { memory, flypow_alloc, flypow_free } = instance.exports;
  const pointer = flypow_alloc(expectedLength);
  if (!pointer) throw new Error(`Not enough memory to load ${label}`);
  let offset = 0;
  try {
    const reader = file.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expectedLength) throw new Error(`${label} grew while reading`);
      new Uint8Array(memory.buffer, pointer + offset, value.byteLength).set(value);
      offset += value.byteLength;
      progress('load',label,offset,expectedLength,{status:'active'});
    }
    if (offset !== expectedLength) throw new Error(`${label} ended early`);
    if (digestHex(pointer, expectedLength) !== expectedHash) throw new Error(`${label} SHA-256 mismatch`);
    return { pointer, length: expectedLength };
  } catch (error) {
    flypow_free(pointer, expectedLength);
    throw error;
  }
}

async function prepare(message) {
  await boot();
  const { flypow_free } = instance.exports;
  if (handle){if(instance.exports.flypow_model_close(handle)!==1)throw new Error('Cannot replace a model with a live task');handle=0;}
  loadedIdentity=null;
  if (graph) { flypow_free(graph.pointer, graph.length); graph = null; }
  if (model) { flypow_free(model.pointer, model.length); model = null; }
  const { config } = message;
  graph = await loadFile(message.graphFile, config.graph_bytes, config.graph_sha256, 'Graph');
  try {
    model = await loadFile(message.modelFile, config.model_bytes, config.model_sha256, 'Model');
  } catch (error) {
    flypow_free(graph.pointer, graph.length);
    graph = null;
    throw error;
  }
  handle=instance.exports.flypow_model_open(graph.pointer,graph.length,model.pointer,model.length);
  if(!handle)throw new Error('Full graph/model structure rejected');
  loadedIdentity={graph:config.graph_sha256,model:config.model_sha256};
  progress('load','Verified model handle opened',1,1,{unit:'models',status:'completed'});
  if(!message.silent)post({ type: 'ready', wasmModule,neuronCount: config.neuron_count,
    directedConnections: config.directed_connection_count });
}

async function saveBuffer(directory, name, allocation) {
  const file = await directory.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  try {
    for (let offset = 0; offset < allocation.length; offset += 4 * 1024 * 1024) {
      const count = Math.min(4 * 1024 * 1024, allocation.length - offset);
      await writer.write(new Uint8Array(instance.exports.memory.buffer, allocation.pointer + offset, count));
      progress('load',`Saving ${name}`,offset+count,allocation.length);
    }
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

async function saveCache(config) {
  if (!graph || !model) throw new Error('Load and verify the full model before saving it');
  const estimate = await navigator.storage?.estimate?.();
  const directory = await cacheDirectory(config, true);
  const existing=async(name)=>{try{return(await(await directory.getFileHandle(name)).getFile()).size;}catch{return 0;}};
  const required = Math.max(0,graph.length-await existing('graph-v1.bin'))+Math.max(0,model.length-await existing('model-v0.bin'))+16*1024*1024;
  if (estimate?.quota && estimate?.usage != null && estimate.quota - estimate.usage < required)
    throw new Error('Not enough OPFS quota for the checked full model');
  await saveBuffer(directory, 'graph-v1.bin', graph);
  await saveBuffer(directory, 'model-v0.bin', model);
  const manifest = await directory.getFileHandle('identity.json', { create: true });
  const writer = await manifest.createWritable();
  await writer.write(JSON.stringify({ graph_sha256: config.graph_sha256, model_sha256: config.model_sha256,
    graph_bytes: config.graph_bytes, model_bytes: config.model_bytes }));
  await writer.close();
  post({ type: 'cached', bytes: graph.length + model.length });
}

async function restoreCache(config,silent=false) {
  const directory = await cacheDirectory(config, false);
  const manifest = JSON.parse(await (await directory.getFileHandle('identity.json')).getFile().then(file => file.text()));
  if (manifest.graph_sha256 !== config.graph_sha256 || manifest.model_sha256 !== config.model_sha256
    || manifest.graph_bytes !== config.graph_bytes || manifest.model_bytes !== config.model_bytes)
    throw new Error('Cached model version differs from the checked configuration');
  const graphFile = await (await directory.getFileHandle('graph-v1.bin')).getFile();
  const modelFile = await (await directory.getFileHandle('model-v0.bin')).getFile();
  await prepare({ graphFile, modelFile, config,silent }); // exact length and SHA-256 are checked again
}

async function clearCache(config) {
  if (!navigator.storage?.getDirectory) throw new Error('OPFS is unavailable in this browser');
  await (await navigator.storage.getDirectory()).removeEntry(cacheName(config), { recursive: true });
  post({ type: 'cache-cleared' });
}

async function buildInputs(message) {
  if (!navigator.storage?.getDirectory) throw new Error('Browser construction requires OPFS; use a browser with persistent file storage');
  const { config, manifest } = message;
  const root = await navigator.storage.getDirectory();
  const sources = await root.getDirectoryHandle(inputDirectoryName(manifest),{create:true});
  const directory=await cacheDirectory(config,true);
  const existing=async(d,name)=>{try{return(await(await d.getFileHandle(name)).getFile()).size;}catch{return 0;}};
  let needed=16*1024*1024;
  for(const s of manifest.sources)needed+=Math.max(0,s.bytes-await existing(sources,s.id+'.feather'));
  for(const [name,bytes] of [['graph-v1.bin',config.graph_bytes],['model-v0.bin',config.model_bytes]])needed+=Math.max(0,bytes-await existing(directory,name));
  const estimate = await navigator.storage.estimate();
  if (estimate.quota!=null && estimate.usage!=null && estimate.quota-estimate.usage < needed) throw new Error(`Preparation needs up to ${needed.toLocaleString()} additional bytes; available quota is ${(estimate.quota-estimate.usage).toLocaleString()}`);
  const buildProgress = (label,loaded,total,detail={}) => {
    const substage=detail.sourceStage;
    const stageId=detail.stageId||(substage ? (['checking','checked'].includes(substage)?'verify':'inputs') : 'construct');
    const status=detail.status || (['checked','staged'].includes(substage)?'completed':'active');
    progress(stageId,label,loaded,total,{unit:detail.unit||'records',...detail,substage,status});
  };
  const files={};
  for(const source of manifest.sources) files[source.id]=await stageSource(sources,source,message.files?.[source.id],buildProgress,!!message.offline);
  progress('inputs','All inputs staged',manifest.sources.length,manifest.sources.length,{unit:'files',status:'completed'});
  let report;
  try {
    report=await buildOfficial(files,manifest,config,(name,bytes)=>saveArtifact(directory,name,bytes,buildProgress),buildProgress,
      source=>markSourceChecked(sources,source));
  } catch(error) {
    // A wrong local import can have internally consistent block hashes. Remove
    // only its checkpoint so a correct retry replaces those bytes, not reuses them.
    if(error.sourceId)await sources.removeEntry(error.sourceId+'-chunks.json').catch(()=>{});
    throw error;
  }
  await saveArtifact(directory,'build-report.json',jsonBytes(report));
  await saveArtifact(directory,'identity.json',jsonBytes({graph_sha256:config.graph_sha256,model_sha256:config.model_sha256,graph_bytes:config.graph_bytes,model_bytes:config.model_bytes}));
  progress('construct','Model built',1,1,{unit:'models',status:'completed'});
  post({type:'build-report',report});
  await restoreCache(config,true);
  post({type:'memory-report',wasm_bytes:instance.exports.memory.buffer.byteLength,storage:await navigator.storage.estimate()});
  post({type:'ready',wasmModule,neuronCount:config.neuron_count,directedConnections:config.directed_connection_count});
}

async function clearInputs(message) {
  const root=await navigator.storage.getDirectory();
  await root.removeEntry(inputDirectoryName(message.manifest),{recursive:true});
  post({type:'inputs-cleared'});
}

async function identifyFiles(message){
  const rows=[],seen=new Set();
  for(const [index,file]of message.files.entries()){
    const matches=message.manifest.sources.filter(s=>s.bytes===file.size);
    // A size match selects a candidate, never a verified input. The single
    // final source check runs after every download/import has been staged.
    if(matches.length!==1){rows.push({index,status:'unknown'});continue;}
    const source=matches[0];
    if(seen.has(source.id)){rows.push({index,status:'duplicate',id:source.id});continue;}
    seen.add(source.id);rows.push({index,status:'selected',id:source.id});
  }
  post({type:'identified',rows});
}

async function validateRun(config,task){
  if(loadedIdentity?.graph!==config.graph_sha256||loadedIdentity?.model!==config.model_sha256||config.time_step_us!==1000||(config.observe_start||0)!==0||(config.parameter_version||'lif-point-v0-dev')!=='lif-point-v0-dev')throw new Error('Unknown frozen scientific configuration');
  if(task.protocolVersion===2){
    const response=await fetch('/assets/data/mining-deployment-v1.json',{cache:'no-store'});if(!response.ok)throw new Error('Mining deployment configuration unavailable');const network=validateDeployment(await response.json(),config);
    const round=await validateRound(operation.round,{networkId:network.networkId,authorityId:network.authorityId}),g=round.goal;
    if(config.steps!==g.steps||config.neuron_count!==g.neuronCount||config.graph_sha256!==g.graphRoot||config.model_root_sha256!==g.modelRoot||config.model_sha256!==g.modelDataRoot||config.registry_sha256!==g.registryRoot)throw new Error('V2 science differs from the loaded complete model');
    const view=new DataView(instance.exports.memory.buffer,graph.pointer,graph.length);for(const set of [g.stimulusSet,g.responseSet,g.offTargetSet])for(const m of set)if(view.getBigUint64(52+m.modelIndex*8,true)!==BigInt(m.bodyId))throw new Error('V2 set membership differs from full registry');
    const expected=await trialTask(round,task.input,task.repeatIndex);for(const k of ['taskId','trialId','roundId','goalId','candidateId','bodyId','targetIndex','repeatIndex','seed'])if(task[k]!==expected[k])throw new Error('V2 trial identity mismatch: '+k);
    if(JSON.stringify(task.stimulus)!==JSON.stringify(expected.stimulus))throw new Error('V2 stimulus mismatch');return;
  }
  let saved=catalogs.get(config.task_catalog_sha256);
  if(saved&&saved.identity!==JSON.stringify(config))throw new Error('Configuration differs from the verified catalog lifecycle');
  let catalog=saved?.catalog;
  if(!catalog){const path=config.catalog_path||'/assets/data/task-catalog-dev.json';if(!path.startsWith('/assets/data/'))throw new Error('Unknown catalog source');const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw new Error('Frozen task catalog unavailable');catalog=await checkCatalog(new Uint8Array(await response.arrayBuffer()),config);catalogs.set(config.task_catalog_sha256,{catalog,identity:JSON.stringify(config)});}
  const frozen=await taskForIndex(catalog,task.k);
  if(frozen.taskId!==task.taskId||frozen.seed!==task.seed||frozen.bodyId!==task.bodyId||frozen.targetIndex!==task.targetIndex||JSON.stringify(frozen.stimulus)!==JSON.stringify(task.stimulus))throw new Error('Task differs from its frozen catalog');
}
async function run(message) {
  if(!handle||!graph||!model)throw new Error('Verified full graph and model files are required');
  const {config,task}=message;runControl={paused:false,cancelled:false,stage:'simulation',wake:null,taskId:task.taskId};await validateRun(config,task);
  const core=instance.exports,started=performance.now();
  computation=new ComputationMeter(task,config,()=>performance.now(),{networkId:message.networkId||'local-tools',sessionId:message.sessionId||'',roundId:task.roundId||'',workerId:message.workerId,executionId:message.executionId,operationId:message.operationId});lastCompute=0;lastCompleteStepEpochMs=null;progressInFlight=null;progressLatest=null;progressSequence=0;computeProgress(computation.snapshot('validating'));
  const graphView=()=>new DataView(core.memory.buffer,graph.pointer,graph.length),modelView=()=>new DataView(core.memory.buffer,model.pointer,model.length);
  const subnet=selectSubnetwork(graphView(),modelView(),config.neuron_count,task.targetIndex,message.traceBudget||{});
  const trace=traceIdentity(config,task,message.executionId||message.operationId,subnet);
  let session=0,chunk=0,selection=0,tracePointer=0,traceAt=0,sequence=0,lastTrace=0,livePointer=0;
  const traceRows=2048;
  try {
    selection=core.flypow_alloc(subnet.selection.length*4);if(!selection)throw new Error('Trace selection allocation failed');
    new Uint32Array(core.memory.buffer,selection,subnet.selection.length).set(subnet.selection);
    session=core.flypow_session_begin(handle,BigInt(task.bodyId),config.steps,config.observe_start||0,1,task.stimulus.start_step,task.stimulus.end_step,BigInt(task.stimulus.current),task.seed,config.max_archive_bytes||128*1024*1024,selection,subnet.selection.length);
    core.flypow_free(selection,subnet.selection.length*4);selection=0;
    if(!session)throw new Error('Full-network WASM session rejected its frozen inputs');
    tracePointer=core.flypow_alloc(traceRows*72);if(!tracePointer)throw new Error('Trace buffer allocation failed');
    const liveBytes=9*subnet.selection.length*2*72;livePointer=core.flypow_alloc(liveBytes);if(!livePointer)throw new Error('Live buffer allocation failed');
    liveSender=new LiveSnapshotSender({read:()=>{
      const completedSteps=computation.counters.completedSteps,boundary=completeWindowBoundary(completedSteps,subnet.selection.length),n=boundary.rows?core.flypow_session_read_trace(session,boundary.offset,livePointer,boundary.rows):0;
      if(n!==boundary.rows)throw new Error('Missing complete live boundary');
      const rows=new Uint8Array(core.memory.buffer,livePointer,n*72).slice(),producedEpochMs=epochNow();
      return {type:'live-snapshot',completedSteps,latestStep:completedSteps-1,stage:runControl.paused?'paused':runControl.stage,partialNeuronUpdates:core.flypow_session_partial(session),counters:{...computation.counters},clock:{workerTimeOrigin:performance.timeOrigin,producedEpochMs,completeStepEpochMs:lastCompleteStepEpochMs,mapping:'timeOrigin-plus-now shared epoch; no subtraction of unrelated now values',resolutionReportedMs:null},window:{firstStep:boundary.firstStep,latestStep:boundary.latestStep,contextSteps:boundary.firstStep>0?1:0,maximumSteps:8},selectionKey:config.graph_sha256+'/'+subnet.selection.join(','),geometryKey:config.graph_sha256+'/'+task.targetIndex,metadata:{...trace,states:[],transfers:[],coverage:{...trace.coverage,lastStep:completedSteps-1,complete:false}},rows:rows.buffer,diagnostics:{completeBoundaryRows:boundary.availableRows,readRows:n,omittedIntermediateSteps:Math.max(0,completedSteps-9),scienceTruncated:false}};
    },send:m=>post(m,[m.rows])});
    if(message.observationScope)liveSender.subscribe(message.observationScope,!!message.observe);
    liveSender.publish(true);
    const publishTrace=force=>{
      const now=performance.now();if(!force&&now-lastTrace<100)return;lastTrace=now;
      const available=computation.counters.completedSteps*subnet.selection.length*2;
      while(traceAt<available){
        const count=core.flypow_session_read_trace(session,traceAt,tracePointer,Math.min(traceRows,available-traceAt));if(!count)throw new Error('Missing core trace rows');
        const bytes=new Uint8Array(core.memory.buffer,tracePointer,count*72).slice();const rows=decodeTraceRows(bytes);trace.states.push(...rows);traceAt+=count;
        trace.coverage.lastStep=computation.counters.completedSteps-1;
        if(message.legacyTraceMessages)post({type:'trace-batch',taskId:task.taskId,executionId:trace.executionId,sequence:sequence++,identity:sequence===1?{...trace,states:[],transfers:[]}:null,lastStep:Math.floor(traceAt/(subnet.selection.length*2))-1,rows:bytes.buffer},[bytes.buffer]);
      }
    };
    while(true){
      if(runControl.cancelled){const e=new Error('Task cancelled; no persistent execution checkpoint');e.code='paused';throw e;}
      if(runControl.paused){computation.pause();liveSender.changed();liveSender.publish(true);post({type:'control-state',taskId:task.taskId,state:'paused',telemetry:computation.snapshot('paused')});await new Promise(resolve=>{runControl.wake=resolve;});runControl.wake=null;if(!runControl.cancelled){computation.resume();post({type:'control-state',taskId:task.taskId,state:'running'});}continue;}
      const status=core.flypow_session_advance(session,message.sliceBudget||32768);
      computation.partial(core.flypow_session_partial(session),status===2?computation.counters.synapseTransmissions:core.flypow_session_work_synapses(session));
      if(status===0){const e=new Error(core.flypow_session_error(session)===1?'Scientific output exceeds the frozen resource cap; no events were truncated':'Deterministic simulation failed');e.code=core.flypow_session_error(session)===1?'resource':'operation';throw e;}
      publishTrace(status===2);
      liveSender.changed();liveSender.publish(status===2);
      if(status===2)break;
      if(performance.now()-lastCompute>=100){lastCompute=performance.now();computeProgress(computation.snapshot('simulation'));}
      await yieldTask();
    }
    runControl.stage='results';liveSender.changed();liveSender.publish(true);computeProgress(computation.snapshot('results'));
    const length=core.flypow_session_output_length(session);if(length<480||length>(config.max_archive_bytes||128*1024*1024))throw new Error('Scientific archive resource bound');
    const chunkBytes=4*1024*1024;chunk=core.flypow_alloc(chunkBytes);if(!chunk)throw new Error('Unable to allocate response chunk');
    const hash=createHasher();let archive,temporary=null;
    if(navigator.storage?.getDirectory){
      const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('flypow-result-staging-v1',{create:true}),file=await dir.getFileHandle(message.operationId+'.bin',{create:true});
      const writer=await file.createWritable();
      try{for(let at=0;at<length;at+=chunkBytes){const n=core.flypow_session_read_output(session,at,chunk,Math.min(chunkBytes,length-at));if(!n)throw new Error('Response stream ended early');const bytes=new Uint8Array(core.memory.buffer,chunk,n);hash.update(bytes);await writer.write(bytes);await yieldTask();}await writer.close();}catch(e){await writer.abort().catch(()=>{});throw e;}
      archive=await file.getFile();temporary=message.operationId+'.bin';
    }else{
      archive=new Uint8Array(length);for(let at=0;at<length;at+=chunkBytes){const n=core.flypow_session_read_output(session,at,chunk,Math.min(chunkBytes,length-at));if(!n)throw new Error('Response stream ended early');const bytes=new Uint8Array(core.memory.buffer,chunk,n);hash.update(bytes);archive.set(bytes,at);await yieldTask();}archive=archive.buffer;
    }
    const resultHash=hex(hash.digest());
    const bodyIndex=body=>{const view=graphView();let low=0,high=config.neuron_count;while(low<high){const mid=Math.floor((low+high)/2);if(view.getBigUint64(52+mid*8,true)<body)low=mid+1;else high=mid;}return low<config.neuron_count&&view.getBigUint64(52+low*8,true)===body?low:-1;};
    let bundle=archive instanceof Blob?await buildRecordFile(archive,config,task,bodyIndex,resultHash):await buildRecord(archive,config,task,bodyIndex,resultHash);
    if(task.protocolVersion===2)bundle=await targetRecord(bundle,task,operation.round);
    trace.resultRoot=resultHash;trace.coverage.complete=true;trace.coverage.lastStep=config.steps-1;trace.transfers=traceTransfers(trace);
    const side=await traceSideFile(trace);
    const transfers=[bundle.previewBytes.buffer,bundle.manifestBytes.buffer,side.bytes.buffer,side.manifestBytes.buffer];if(archive instanceof ArrayBuffer)transfers.push(archive);
    const result={type:'result',bodyId:task.bodyId,task,config,record:bundle.record,preview:bundle.preview,previewBytes:bundle.previewBytes.buffer,manifestBytes:bundle.manifestBytes.buffer,previewRoot:bundle.previewRoot,archiveRoot:bundle.archiveRoot,
      archive,responseBytes:length,temporary,trace,traceBytes:side.bytes.buffer,traceManifestBytes:side.manifestBytes.buffer,resultHash,elapsedMs:Math.round(performance.now()-started),computation:computation.snapshot('results'),memoryReport:{wasmCapacityBytes:core.memory.buffer.byteLength,scope:'linear memory capacity, not peak process RSS'}};
    if(task.protocolVersion===2)result.goalMetrics=await evaluateGoal(operation.round.goal,task.input,archive);
    try{await retainOutput(result,operation);}catch(error){result.stagingMetadataError=error.message;}
    post(result,transfers);
  } catch(error) {
    // Preserve the last actual core counts when cancellation falls between
    // progress packets. This observation is not a complete scientific result.
    if(computation)error.computation=computation.snapshot(error.code==='paused'?'stopped':'failed');
    throw error;
  } finally {
    liveSender=null;progressLatest=null;progressInFlight=null;computation=null;runControl=null;if(session)core.flypow_session_free(session);if(chunk)core.flypow_free(chunk,4*1024*1024);if(tracePointer)core.flypow_free(tracePointer,traceRows*72);if(livePointer)core.flypow_free(livePointer,9*subnet.selection.length*2*72);if(selection)core.flypow_free(selection,subnet.selection.length*4);
  }
}

self.onmessage=async({data:message})=>{
  if(message.type==='live-ack'){if(liveSender?.ack(message.scope,message.snapshotSeq))liveSender.publish();return;}
  if(message.type==='live-subscribe'){
    const s=message.scope;if(liveSender&&s?.executionId===operation?.executionId&&s.operationId===operation?.operationId&&s.workerId===operation?.workerId&&s.sessionId===operation?.sessionId&&s.configKey===operation?.configKey){liveSender.subscribe(s,message.enabled);liveSender.publish(true);}return;
  }
  if(message.type==='progress-ack'){if(operation&&message.operationId===operation.operationId&&message.executionId===operation.executionId&&message.progressSeq===progressInFlight){progressInFlight=null;if(progressLatest)computeProgress(progressLatest);}return;}
  if(message.type==='control'){
    if(!runControl||message.workerId!==operation?.workerId||message.sessionId!==operation?.sessionId||message.executionId!==operation?.executionId||message.configKey!==operation?.configKey||message.operationId!==operation?.operationId||message.generation!==operation?.generation||message.taskId!==runControl.taskId)return;
    if(message.action==='pause'&&runControl.stage==='simulation')runControl.paused=true;
    if(message.action==='resume'){runControl.paused=false;runControl.wake?.();}
    if(message.action==='cancel'&&runControl.stage==='simulation'){runControl.cancelled=true;runControl.wake?.();}
    return;
  }
  if(busy){self.postMessage({...message,type:'error',message:'Worker is already busy'});return;}
  busy=true;operation={...message,started:performance.now()};
  try{
    if(message.type==='prepare')await prepare(message);
    else if(message.type==='identify')await identifyFiles(message);
    else if(message.type==='build-inputs')await buildInputs(message);
    else if(message.type==='clear-inputs')await clearInputs(message);
    else if(message.type==='cache')await saveCache(message.config);
    else if(message.type==='restore')await restoreCache(message.config);
    else if(message.type==='clear-cache')await clearCache(message.config);
    else if(message.type==='run')await run(message);
    else if(message.type==='release-output'){await releaseOutput(message.name);post({type:'output-released'});}
    else throw new Error('Unknown Worker operation');
  }catch(error){computation=null;runControl=null;post({type:'error',message:String(error.message||error),code:error.code,sourceId:error.sourceId,computation:error.computation||null});}
  finally{busy=false;operation=null;}
};
