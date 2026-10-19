import { setMiningButtonLabel,showMiningButtonBusy,showMiningProgress,MiningLogBackdrop } from './mining-presentation.mjs?v=mining-depth-20261014-v2';
import { validateDeployment } from './mining-deployment.mjs';
import { miningWorkflow,showMiningStage } from './mining-workflow.mjs?v=mining-session-20261013-v1';
import { GoalMiningView } from './goal-mining-view.mjs?v=continuous-task-supply-20261014-v1';
import { taskForIndex } from './catalog-task.mjs';
import { createMinerState, FlowEvents, FlowError, ERROR_TEXT, errorCode, deriveActions } from './miner-state.mjs?v=mining-start-20261013-v1';
import { ModelRuntime, PreparationController } from './preparation-controller.mjs?v=mining-product-20261011-r7';
import { inspectStorage, storageBudget } from './model-storage.mjs';
import { SessionPlan } from './session-plan.mjs';
import { ResearchProfiles } from './research-profiles.mjs';
import { TaskRunner } from './task-runner.mjs';
import { compactNumber } from './metric-format.mjs';
import { computePolicy } from './compute-pool.mjs';
import { ComputationView } from './computation.mjs';
import { ResponseView } from './response-view.mjs';
import { ContributionView, entitlementFunds, formatAtoms, parseSOL } from './contribution-view.mjs';
import { ResearchTools } from './research-tools.mjs';
import { SubmissionController } from './submission-controller.mjs';
import { saveLocalResponse, listLocalResponses, loadLocalResponse, loadLocalPreview, loadArchivedResponse } from './response-store.mjs';

const $=id=>document.getElementById(id),t=(s,v={})=>window.FlyI18n?.t(s,v)||s;
const state=createMinerState(),events=new FlowEvents();
const logBackdrop=new MiningLogBackdrop($('miner-log-backdrop'),{t});
let config,manifest,catalog,profiles,profileId,prep,runtime,runner,computationView,responseView,contributionView,tools,chain=null,sdk=null,wallet=null,submission=null,snapshot=null;
let local=[],pending=[],latest=null,selectedBundle=null,chainRefresh=null,lastRefresh=0,quote=null,fundRow=null,unsubscribeWallet=null,lastWalletAddress=null;
let actionBusy=false,initialised=false,sessionFeeLimit=null,hiddenAt=null,serviceCheckAt=0,serviceAvailable=false,prepPlan=null,viewOperation=0,newResults=0;
let historyProfile=null,historyLocal=[];
let lastExecutionRows=null,legacyRunner=null,goalView=null;
const targetMode=()=>['target-v2','contract-v4'].includes(goalView?.network.execution);
const calculation=()=>legacyRunner?.running?legacyRunner:runner;
const sessionMinutes=()=>$("miner-limit-minutes").value.trim()===''?null:Number($("miner-limit-minutes").value);
const sourceDOM=new Map(),stageDOM=new Map();let lastImportRows=null,chainFailure=null;
const phaseText={checking:'Checking this browser…',needed:'Ready to prepare this device',files:'Import missing official files',fetching:'Getting data','checking-files':'Checking files',building:'Building the complete model',loading:'Loading the checked model',ready:'Full model ready',paused:'Preparation paused',space:'More browser storage is needed',unsupported:'This browser cannot run the complete model',error:'Preparation needs attention'};
const submissionText={unsubmitted:'Ready to submit a test result',signature:'Please confirm this step in your wallet',sending:'Sending the signed transaction',unknown:'Confirmation is unknown. Reconcile before retrying.',committed:'Result committed','waiting-reveal':'Waiting for the required reveal slots','reveal-authorization':'Reveal needs your signature',revealed:'Result verified; archive or confirm the task',archiving:'Archiving the exact response',verifying:'Waiting for independent verification',accepted:'Contribution confirmed on chain',lost:'Another candidate won',rejected:'Result rejected',timeout:'The submission deadline expired',refundable:'Refund eligible'};
const activeChain=()=>null;
const actions=()=>deriveActions({ready:runtime?.ready,preparing:prep?.busy,running:calculation()?.running,paused:calculation()?.paused,initialised,unsupported:state.value.preparation.phase==='unsupported',opfs:prep?.inventory?.opfs,actionBusy});
function showError(e){if(e?.name==='AbortError')return;const code=errorCode(e);$('miner-error').hidden=false;$('miner-error').textContent=t(ERROR_TEXT[code]||ERROR_TEXT.operation);$('miner-diagnostics').hidden=false;$('miner-error-detail').textContent=e.message||String(e);if(chain)$('miner-submission-error').textContent=t(ERROR_TEXT[code]||ERROR_TEXT.operation);}
function clearError(){$('miner-error').hidden=true;$('miner-diagnostics').hidden=true;$('miner-submission-error').textContent='';}
async function act(fn){if(actionBusy)return;actionBusy=true;clearError();render();try{await fn();}catch(e){showError(e);}finally{actionBusy=false;render();}}
const context=()=>({config,catalog,local,snapshot:activeChain()?snapshot:null,pending,address:wallet?.account.address,sdk,runtime,runner:state.value.view==='tools'?legacyRunner:runner,prep,actions:actions(),chain:activeChain(),wallet,bundle:selectedBundle,loadRow});
function invalidatePreparation(reason){if(prepPlan){prepPlan.invalidate(reason);prepPlan=null;}}
async function loadRow(row){if(row.page?.archived)return loadArchivedResponse(chain,row.page,row.ent,config);const p=row.historyProfile||{catalog,config};return loadLocalPreview(p.catalog,p.config,await taskForIndex(p.catalog,row.k));}
async function openRow(row){const generation=++viewOperation;const bundle=await loadRow(row);if(generation!==viewOperation)return;navigate('contributions');await responseView.render(bundle);}
async function onResult(result){
  latest=result;
  if(!result.saveError){const record={...result.record,verification:'LOCAL_UNVERIFIED'};for(const list of [result.config.campaign===config.campaign?local:null,result.config.campaign===historyProfile?.config.campaign?historyLocal:null].filter(Boolean)){const i=list.findIndex(r=>r.task_id===result.task.taskId);if(i<0)list.push(record);else list[i]=record;}}
  tools.render();contributionView.render();
  newResults++;$('miner-new-result').hidden=false;
  if(result.saveError){$('miner-new-result').hidden=false;$('miner-show-result').textContent=t('Completed result could not save. Open it to export.');showError(new FlowError(result.saveError.code,result.saveError.detail));}
  else $('miner-show-result').textContent=t('New saved results are available. View latest');
}
async function refreshStorage(){const inventory=await inspectStorage(config,manifest);prep.inventory=inventory;state.update('preparation',{inventory,budget:storageBudget(config,manifest,inventory)});}
function route(){const view=new URL(location.href).searchParams.get('view')||'experience';state.view(view);if(view==='settings'&&prep)refreshStorage().catch(showError);}
function navigate(view){invalidatePreparation('navigation');viewOperation++;const u=new URL(location.href);if(view==='experience')u.searchParams.delete('view');else u.searchParams.set('view',view);history.pushState({},'',u);state.view(view);if(view==='settings')refreshStorage().catch(showError);if(view!=='experience')responseView?.hide();else responseView?.show();tools?.render();contributionView?.render();}
function setCatalogControls(){const c=catalog.campaign,max=c.targets.length*c.stimuli.length*c.repeats;$('miner-limit-count').max=max;$('miner-limit-count').value=Math.min(Number($('miner-limit-count').value),max);$('research-stimulus-index').max=c.stimuli.length-1;document.querySelector('[for="research-stimulus-index"]').textContent=t('Standard input (0–{max})',{max:c.stimuli.length-1});$('miner-goal-detail').textContent=t('First batch: {targets} exact target cells × {inputs} stimulus conditions × {repeats} seed samples = {tasks} unique experiments. Each runs complete A/B for {steps} model steps across {neurons} neurons and {edges} connections.',{targets:c.targets.length,inputs:c.stimuli.length,repeats:c.repeats,tasks:max,steps:config.steps,neurons:config.neuron_count.toLocaleString(),edges:config.directed_connection_count.toLocaleString()});}
async function selectHistory(id){historyProfile=await profiles.get(id);historyLocal=await listLocalResponses(historyProfile.catalog,historyProfile.config);contributionView.page=0;contributionView.render();}
async function recomputeHistory(){if(!selectedBundle||runner.running||legacyRunner.running||!runtime.ready)return;const bundle=selectedBundle,p=await profiles.get(bundle.config.profile_id||'quick32');if(!p.entry.enabled)throw new FlowError('version');const old={config:legacyRunner.config,catalog:legacyRunner.catalog};try{legacyRunner.config=p.config;legacyRunner.catalog=p.catalog;await legacyRunner.start({task:bundle.task,count:1,allowRecompute:true});}finally{Object.assign(legacyRunner,old);render();}}
function makePlan(single){return new SessionPlan({config,count:single?1:Number($('miner-limit-count').value),minutes:sessionMinutes(),storageBytes:Number($('miner-limit-storage').value)*1024*1024,mode:single?'single':'explore'});}
async function launch(single=false){
  if(targetMode()){await launchGoal();return;}
  if(!initialised||prep.busy||runner.running&&!runner.paused)return;
  invalidatePreparation('replaced');const plan=makePlan(single);prepPlan=plan;const generation=plan.generation;
  events.session=plan.sessionId;events.started=performance.now();events.seen.clear();events.emit('start');
  if(runner.paused){prepPlan=null;runner.start({plan}).catch(showError);return;}
  const ready=runtime.ready||await prep.start(plan);if(!plan.accepts(plan.operationId,generation)||document.hidden)return;
  if(!ready){plan.awaitingFiles=true;plan.remember();render();return;}
  dispatch(plan);
}
function dispatch(plan){if(plan.mode==='target-v2'){prepPlan=null;startGoal(plan).catch(showError);return;}if(!plan.launchIntent||plan.cancelled||document.hidden)return;prepPlan=null;const options={plan};legacyRunner.start(options).catch(showError);render();}
async function prepareDevice(){
  invalidatePreparation('replaced');
  const plan=new SessionPlan({config,count:1,mode:'prepare-only'});prepPlan=plan;
  const generation=plan.generation,ready=await prep.start(plan);
  if(!plan.accepts(plan.operationId,generation)||document.hidden)return;
  if(ready){prepPlan=null;render();}else{plan.awaitingFiles=true;plan.remember();render();}
}
async function importFiles(files){
  const plan=prepPlan,generation=plan?.generation;await prep.importFiles(files);
  if(plan?.awaitingFiles&&plan.accepts(plan.operationId,generation)&&!document.hidden){plan.awaitingFiles=false;const ready=await prep.start(plan);if(plan.accepts(plan.operationId,generation)){if(ready){if(plan.mode==='prepare-only'){prepPlan=null;render();}else dispatch(plan);}else plan.awaitingFiles=true;}}
}
function requireMiningWallet(){goalView?.adapter?.rpc.assertReady();if(goalView?.financial&&!goalView.financial.account)throw new Error('Connect your wallet before mining');if(goalView?.financial&&!goalView.financial.login)throw new Error('Sign in before mining');}
async function startGoal(plan){requireMiningWallet();if(!plan.launchIntent||document.hidden)return;const active=goalView.runner;await active.start({minutes:plan.minutes,storageBytes:plan.storageBytes});active.completion?.catch(showError);}
async function launchGoal(){
  requireMiningWallet();
   if(legacyRunner?.running)throw new FlowError('operation','Stop the advanced calculation before starting mining');
  if(prep.busy||runner.running&&!runner.paused)return;
  if(goalView.pending.length)throw new FlowError('operation','Recover pending artifacts before continuing mining');
  await goalView.prepareMiningSession?.();
  if(runner.paused){await runner.resume({minutes:sessionMinutes(),storageBytes:Number($('miner-limit-storage').value)*1048576});return;}
  await goalView.client.sync();const eligibility=goalView.ui(),waitingFactory=goalView.network.execution==='contract-v4'&&eligibility.state==='contract-empty-window';if((!['open','waiting-next-goal'].includes(eligibility.state)&&!waitingFactory)||eligibility.action!=='start')throw new Error('Mining entry is unavailable: '+eligibility.state);
  invalidatePreparation('replaced');const plan=new SessionPlan({config,count:1,mode:'target-v2',minutes:sessionMinutes(),storageBytes:Number($('miner-limit-storage').value)*1048576});prepPlan=plan;const generation=plan.generation;const ready=runtime.ready||await prep.start(plan);
  if(!plan.accepts(plan.operationId,generation)||document.hidden)return;
  if(!ready){plan.awaitingFiles=true;plan.remember();return;}prepPlan=null;await startGoal(plan);
}
function initPreparationDOM(){
  for(const source of manifest.sources){const el=document.createElement('div'),a=document.createElement('a'),status=document.createElement('span'),bar=document.createElement('progress');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';bar.max=source.bytes;el.dataset.source=source.id;el.append(a,status,bar);$('miner-download-list').append(el);sourceDOM.set(source.id,{a,status,bar});}
  for(const id of ['inspect','inputs','verify','construct','load','ready']){const li=document.createElement('li');li.dataset.stage=id;$('miner-stage-list').append(li);stageDOM.set(id,li);}
}
const formatBytes=b=>(b/1e6).toLocaleString(window.FlyI18n.language,{maximumFractionDigits:1})+' MB';
function renderPreparation(p){
  $('miner-preparation').hidden=!initialised||p.phase==='unsupported';$('research-state').textContent=t(phaseText[p.phase]);
  const current=p.progress,done=current?.done,total=current?.total;
  if(total>0){$('research-progress').max=total;$('research-progress').value=done;$('research-percent').textContent=(100*done/total).toFixed(1)+'%';$('research-detail').textContent=t('{done} / {total} · current real stage',{done:current.unit==='bytes'?formatBytes(done):done,total:current.unit==='bytes'?formatBytes(total):total});}
  else {if(prep.busy)$('research-progress').removeAttribute('value');else{$('research-progress').max=1;$('research-progress').value=0;}$('research-percent').textContent='';$('research-detail').textContent='';}
  const sources=p.sourceProgress||{},complete=Object.values(p.stages?.sources||{}).filter(s=>s.stages?.staged?.status==='completed'||s.stages?.checked?.status==='completed').length;
  $('miner-preparation-summary').textContent=t(runtime.ready?'Checked complete model cached on this device':prep.busy?'3 data files · {done} staged or checked; current stage is shown above.':'Saved model and input blocks are checked only after an explicit start.',{seconds:((p.elapsedMs||0)/1000).toFixed(1),done:complete});
  $('research-progress').hidden=runtime.ready;$('research-percent').hidden=runtime.ready;$('research-detail').hidden=runtime.ready;
  $('miner-build-summary').textContent=t(runtime.ready?'Full model ready':p.inventory?.model?'Reusing the saved model; integrity checking and loading run after your start.':'Official data is ready for integrity checking, construction and loading.');
  for(const [id,node]of stageDOM){const status=p.stages?.parents?.[id]?.status||(runtime.ready?'skipped':'pending');node.dataset.status=status;node.hidden=['inspect','inputs','ready'].includes(id);node.textContent=t({inspect:'Inspect cache',inputs:'Stage inputs',verify:'Verify inputs once',construct:'Construct model',load:'Load verified model',ready:'Ready'}[id])+' · '+t(status);}
  for(const source of manifest.sources){
    const node=sourceDOM.get(source.id),cached=p.inventory?.inputs.find(i=>i.id===source.id),current=sources[source.id];
    node.a.textContent=t({annotation:'Official annotations',weights:'Official connections',transmitter:'Official neurotransmitters'}[source.id])+' · '+formatBytes(source.bytes)+' ↗';
    const label=current?{downloading:'Downloading',caching:'Saving durable blocks',restoring:'Reusing checked blocks',staged:'Saved · awaiting final check',checking:'Checking files',checked:'Checked and cached'}[current.stage]:prep.files[source.id]?'Selected · awaiting final check':cached?.checkedBytes?'Cached blocks; validation occurs during preparation':'Ready for official download';
    node.status.textContent=t(label||'Getting data')+' · '+formatBytes(current?.loaded??cached?.checkedBytes??0)+' / '+formatBytes(source.bytes)+(current?.retryCount?' · '+t('Retry {count}',{count:current.retryCount}):'');
    node.bar.value=current?.loaded??cached?.checkedBytes??0;node.bar.setAttribute('aria-label',node.a.textContent);
  }
  if(lastImportRows!==prep.rows){lastImportRows=prep.rows;$('miner-import-status').replaceChildren(...prep.rows.map(r=>{const li=document.createElement('li');li.textContent=t('File {file}: {status}',{file:r.index+1,status:t({selected:'Selected · awaiting final check',unknown:'Unknown size or version',duplicate:'Duplicate file'}[r.status])});return li;}));}
  $('miner-import-explanation').hidden=!p.readRestriction;
  if(p.phase==='files'&&p.readRestriction){$('miner-preparation-details').open=true;$('miner-import-fallback').open=true;}
  $('research-cache-note').textContent=t(p.saved?'Saved on this device. Browser or user removal is still possible.':'Only durable checkpoints can be recovered after refreshing. Simulation state is memory only.');
  const budget=p.budget;if(budget){
    $('miner-storage-note').textContent=t('Version data {total}; estimated new transfer {new}; additional browser disk {space}. Storage quota is not RAM.',{total:formatBytes(budget.download),new:formatBytes(budget.newDownload),space:formatBytes(budget.extra)});
    $('miner-settings-storage').textContent=t('Model cache: {model} MB. Official input cache: {inputs} MB. Results and submission secrets are not included or deleted.',{model:Math.round((p.inventory?.modelBytes||0)/1e6),inputs:Math.round((p.inventory?.inputs||[]).reduce((n,i)=>n+i.bytes,0)/1e6)});
  }
  $('research-tools-state').textContent=t(phaseText[p.phase]);$('research-tools-cache-note').textContent=$('research-cache-note').textContent;
}
function render(){
  const s=state.value,p=s.preparation,e=s.execution,a=actions();Object.assign(document.querySelector('.research-app').dataset,{preparation:p.phase,execution:e.phase,submission:s.submission.phase});
  for(const view of ['experience','contributions','tools','settings'])$('miner-view-'+view).hidden=s.view!==view;
  for(const link of document.querySelectorAll('[data-miner-view]'))link.setAttribute('aria-current',link.dataset.minerView===s.view?'page':'false');
  $('miner-mode').textContent=t('Verifiable computation using the complete MaleCNS model.');
  const working=calculation()?.running,paused=calculation()?.paused,preparing=prep?.busy;
  const workflow=miningWorkflow(p,{ready:runtime?.ready,running:working,pendingOutputs:goalView?.pending.length||0});
  showMiningStage(document,workflow);
  $('miner-step-note').textContent=t(workflow.reused&&workflow.step!=='mining'?'Saved data is reused. Integrity checking still runs before mining.':workflow.step==='download'?'Download progress shows actual official file bytes.':workflow.step==='build'?'Checking data, building the full model and loading it on this device.':'Model ready. Mining starts only when you choose Start mining.');
  $('miner-step-note').hidden=!!working||!!goalView?.pending.length;
  setMiningButtonLabel($('miner-primary'),t(paused?'Continue mining':working?'Pause mining':workflow.step==='download'?'Download brain data':workflow.step==='build'?'Build brain model':'Start mining'));
  $('miner-primary').disabled=preparing?true:working?!paused&&e.phase==='pausing':!a.start;$('miner-single').disabled=!a.start||!!working;
  for(const id of ['miner-limit-count','miner-limit-minutes','miner-limit-storage'])$(id).disabled=!!preparing||!!working&&!paused;
  $('miner-pause-now').hidden=!working||paused;$('miner-pause-now').disabled=e.phase==='pausing';$('miner-run-actions').hidden=!working;$('miner-prepare-pause').hidden=!preparing;
  $('miner-files').disabled=!a.import;$('research-run').disabled=!a.run;$('research-prepare').disabled=!a.prepare;
  $('research-restore').hidden=!prep?.inventory?.model;$('research-restore').disabled=!!working||!!preparing||runtime?.ready;$('miner-release').disabled=!a.release;for(const id of ['miner-clear-model','miner-clear-inputs'])$(id).disabled=!a.clear;
  const status=preparing?phaseText[p.phase]:paused?'Task paused in memory; continue explicitly':working?'Computing the complete model':runtime?.ready?'Full model ready':phaseText[p.phase];
  $('miner-status').textContent=t(status);
  const reason=e.reason,reasonText={'time-limit':'Active time limit reached. The current task is held in memory; continue explicitly.','task-limit':'The chosen task limit was reached.','storage-limit':'The chosen result storage limit was reached.'}[reason];
  $('miner-guidance').textContent=t(paused?'The current simulation is held in memory. Continue explicitly; the latest neural state remains static.':reasonText||ERROR_TEXT[reason]||(p.repairReason?'A damaged model is being rebuilt using the existing official inputs.':prepPlan?.awaitingFiles?'Import the missing files; this explicit plan will continue automatically.':working?'Running inputs are frozen. Viewing a saved result does not change this task.':workflow.step==='mining'?'Start mining to compute distinct candidates.':'Prepare the data and model first. Then choose Start mining.'));
  const session=e.session;$('miner-session-count').textContent=t('{count} saved results',{count:local.length});
  $('miner-session-budget').textContent=session?t('{done}/{count} tasks · {seconds} s active of {minutes} min · {bytes} new result data',{done:session.completed,count:session.count,seconds:(session.elapsedMs/1000).toFixed(1),minutes:session.minutes,bytes:formatBytes(session.savedBytes)}):'';
  const b=p.budget;$('miner-start-estimate').hidden=!!working||!!preparing;
  $('miner-start-estimate').textContent=b?t('New download {download} · additional browser disk {space}.',{download:runtime?.ready?'0 MB':formatBytes(b.newDownload),space:runtime?.ready?'0 MB':formatBytes(b.extra),count:$('miner-limit-count').value,minutes:$('miner-limit-minutes').value}):'';
  $('miner-profile-note').textContent=config?t('Complete A/B · {steps} steps · first batch {tasks} experiments',{steps:config.steps,tasks:catalog.campaign.targets.length*catalog.campaign.stimuli.length*catalog.campaign.repeats}):'';
  const pool=calculation()?.pool.snapshot();if(pool){$('miner-thread-retry').hidden=!pool.expansionFailed;$('miner-thread-requested').textContent=$('miner-threads').value;$('miner-thread-state').textContent=t('Requested {requested} · prepared {prepared} · computing {busy} · parked {parked}',pool);$('miner-thread-reason').textContent=t(pool.policy.reason)+(pool.reason!==pool.policy.reason?' · '+pool.reason:'')+' · '+t('Parked workers retain model and simulation memory.');const nodes=e.tasksByExecution||[],key=JSON.stringify(nodes.map(x=>[x.executionId,x.status,x.telemetry?.completedSteps]));if(lastExecutionRows!==key){lastExecutionRows=key;$('miner-execution-list').replaceChildren(...nodes.map(x=>{const b=document.createElement('button');b.className='button button-ghost';b.textContent=t('Candidate {task} · background {background}/{required} · {state} · step {step}',{task:x.k,background:x.background||1,required:x.required||1,state:t(x.status),step:x.telemetry?.completedSteps||0})+' · '+compactNumber(x.telemetry?.recentNeuronUpdatesPerSecond??0).text+' '+t('neuron updates/s');b.title=x.workerId+' / '+x.executionId;b.onclick=()=>{calculation().focus(x.executionId);};return b;}));}}
  $('research-recompute-viewed').disabled=!a.run||!selectedBundle;
  for(const id of ['miner-guidance','miner-session-budget','miner-start-estimate','research-detail','miner-result-summary'])if($(id))$(id).hidden=!$(id).textContent;
  $('miner-fee-limit-field').hidden=true;
  $('miner-task').hidden=!e.task;if(e.task){$('miner-task-title').textContent=t('Task {task} · cell {body}',{task:e.task.k,body:e.task.bodyId});$('miner-task-description').textContent=t('Input {input} · repeat {repeat} · TaskID {id}',{input:e.task.stimulusIndex,repeat:e.task.repeatIndex,id:e.task.taskId});$('miner-task-progress').textContent=t('In-memory pause preserves this task. Refresh or Worker termination requires recomputation.');}
  $('miner-model-time').textContent=e.telemetry?t('Model time: {time} ms',{time:e.telemetry.modelTimeMs||0}):'';
  if(computationView&&calculation())computationView.log=calculation().computation;computationView?.render(e,working&&!paused,s.view==='experience');if(prep)renderPreparation(p);
  // Observation lifecycle is per Worker. Pool/global render must not overwrite
  // the focused execution's saving/complete state with another Worker's run.
  if(activeChain())renderSubmission();else $('miner-submission').hidden=true;
  if(goalView){goalView.preparing=preparing;goalView.actionBusy=actionBusy||!!legacyRunner?.running;goalView.render();}
  const preparingLabel=t(phaseText[p.phase]||'Preparing…'),busy=!!preparing||actionBusy||!initialised;
  showMiningButtonBusy($('miner-primary'),busy,preparing?preparingLabel:t(initialised?'Processing…':'Checking this browser…'));
  setMiningButtonLabel($('research-prepare'),t('Check and load in browser →'));setMiningButtonLabel($('research-restore'),t('Use cached model'));
  for(const id of ['research-prepare','research-restore'])showMiningButtonBusy($(id),!!preparing,preparingLabel);
  for(const progress of document.querySelectorAll('.research-app progress'))showMiningProgress(progress,progress.id==='miner-compute-progress'?!!working&&!paused:!!preparing);
  logBackdrop.update({preparation:p.phase,progress:p.progress,phaseLabel:preparingLabel,logRows:calculation()?.computation.rows||[],candidates:goalView?.rows||[],visible:s.view==='experience'&&responseView?.propagation.graphicsEnabled!==false,anatomy:responseView?.propagation.scene});
}
async function initialiseChain(chainConfig,deployment){
  const quick=await profiles.get('quick32');sdk=await import('/assets/vendor/generated/solana-client.mjs');const client=new sdk.CampaignClient(chainConfig,deployment);await client.load();client.assertCatalog(quick.catalog);const snap=await client.snapshot();chain=client;snapshot=snap;
  submission=new SubmissionController({client:chain,catalog:quick.catalog,config:quick.config,wallet:()=>wallet,loadBundle:task=>loadLocalResponse(quick.catalog,quick.config,task),saveBundle:b=>saveLocalResponse(b,quick.catalog),state,events,onChange:render});submission.sdk=sdk;submission.upload=(await import('/assets/archive-upload.mjs')).uploadArchive;
  tools.render();contributionView.render();render();
}
async function setup(){
  await window.FlyI18n.ready;profiles=await ResearchProfiles.load();const profile=await profiles.mining();profileId=profile.entry.id;config=profile.config;catalog=profile.catalog;
  const getJSON=async path=>{const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw new FlowError('version',path+' unavailable');return r.json();};[manifest]=await Promise.all([getJSON('/assets/data/official-inputs.json')]);const chainConfig=await getJSON('/assets/data/chain-config.json');
  const deployment=validateDeployment(await getJSON('/assets/data/mining-deployment-v1.json'),config);if(manifest.registry_sha256!==deployment.model.registryRoot||config.allow_payment||config.allow_rewards)throw new FlowError('version','Model and deployment capabilities differ');
  $('miner-history-profile').replaceChildren(...profiles.index.profiles.map(p=>new Option(t(p.label),p.id)));$('miner-history-profile').value=profileId;setCatalogControls();
  events.context.mode='experience';runtime=new ModelRuntime();prep=new PreparationController({config,manifest,runtime,state,events});initPreparationDOM();local=await listLocalResponses(catalog,config);events.context.returning=local.length>0;historyProfile=profile;historyLocal=local;
  responseView=new ResponseView(config,{loadFull:async task=>{const current=responseView.bundle?.config||config;const matching=profiles.index.profiles.find(p=>p.config_path===(current.profile_id?'/assets/data/research-profiles/'+current.profile_id+'/config.json':'/assets/data/research-config.json'));const p=await profiles.get(matching.id);return loadLocalResponse(p.catalog,p.config,task);},onSubscribe:enabled=>calculation()?.observation?.setEnabled(enabled),onAck:(scope,seq)=>calculation()?.pool.slots.get(scope?.workerId)?.runtime.acknowledge(scope,seq),onRequest:scope=>calculation()?.observation?.request(scope),onError:showError,onSelect:bundle=>{selectedBundle=bundle;fundRow=null;state.update('execution',{viewedResultId:bundle?.resultHash||null});}});
  runner=new TaskRunner({runtime,state,catalog,config,records:c=>c.campaign===config.campaign?local:historyLocal,save:r=>saveLocalResponse(r,legacyRunner.catalog),onResult,onFocus:(scope,task)=>responseView.barrier(scope,{...task,viewWorkerNumber:[...runner.pool.slots.keys()].indexOf(scope.workerId)+1}),onSnapshot:m=>responseView.receive(m),onObservationProgress:(scope,m)=>responseView.propagation.progress(scope,m),onObservationStage:(scope,stage)=>responseView.propagation.stage(scope,stage),activity,events});
  legacyRunner=runner;
  const policy=computePolicy({hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,mobile:matchMedia('(pointer:coarse)').matches||/Android|iPhone|iPad/.test(navigator.userAgent)});runner.pool.policy=policy;let preference;try{preference=Number(localStorage.getItem('flypow-compute-threads-v1'));}catch{}runner.pool.setRequested(preference>0?preference:policy.defaultThreads);$('miner-threads').max=policy.max;$('miner-threads').value=runner.pool.requested;

  computationView=new ComputationView(runner.computation,{t,locale:()=>window.FlyI18n.language});
  const historyContext=()=>({...context(),catalog:historyProfile?.catalog||catalog,config:historyProfile?.config||config,local:historyLocal,snapshot:historyProfile?.entry.id==='quick32'?snapshot:null});
  contributionView=new ContributionView({context:historyContext,open:r=>openRow({...r,historyProfile}).catch(showError),onSubmission:(p,r)=>reviewSubmission(p,r).catch(showError)});
  tools=new ResearchTools({context,run:task=>{if(goalView?.runner.running||legacyRunner.running)throw new FlowError('operation','Pause and stop mining before using advanced tools');return legacyRunner.start({task,count:1,minutes:sessionMinutes(),storageBytes:Number($('miner-limit-storage').value)*1024*1024,allowRecompute:true});},prepare:()=>{invalidatePreparation('manual-model');return prep.preparedFiles($('research-graph').files?.[0],$('research-model').files?.[0]);},open:openRow,connect,controller:()=>submission,refresh,onError:showError});
  const network=deployment;
  let financial=null;if(deployment.walletMining){financial=await globalThis.flybrainlabsWalletReady;const pinned=deployment.walletMining;const matches=financial&&['schema','cluster','genesisHash','programId','mint','policyHash'].every(k=>financial.config[k]===pinned[k])&&(deployment.execution==='contract-v4'||financial.config.authorityId===network.authorityId)&&financial.config.apiBase===network.apiBase;
    if(!matches){financial={requireFunding:async()=>{throw new FlowError('services','Wallet service unavailable; saved model and artifacts remain usable');},acceptCandidate:async()=>{throw new FlowError('services','Original wallet authorization is unavailable');}};}
  }


  let GoalView=GoalMiningView,factory=null;if(deployment.execution==='contract-v4'){factory=await getJSON(deployment.taskFactoryV4.configuration);if(factory.enabled!==true||factory.factory!==deployment.campaignId||factory.genesisHash!==deployment.networkId||factory.programId!==deployment.walletMining.programId||factory.policyHash!==deployment.walletMining.policyHash)throw new Error('Factory deployment differs from the published network');GoalView=(await import('./factory-mining-view-v4.mjs')).FactoryMiningViewV4;}
  goalView=new GoalView({network,factory,financial,runtime,pool:legacyRunner.pool,config,state,onFocus:(scope,task)=>responseView.barrier(scope,{...task,viewWorkerNumber:[...runner.pool.slots.keys()].indexOf(scope.workerId)+1}),onSnapshot:m=>responseView.receive(m),onObservationProgress:(scope,m)=>responseView.propagation.progress(scope,m),onObservationStage:(scope,stage)=>responseView.propagation.stage(scope,stage),onResult:async(r,m)=>{latest=r;newResults++;$('miner-new-result').hidden=false;},onOpen:async b=>{navigate('contributions');await responseView.render(b);},onError:showError,onChange:render});
  runner=goalView.runner;runner.pool.onChange=()=>{const active=calculation();active.publish();if(active.running)active.pump();};computationView.log=runner.computation;
  await goalView.initialize();
  $('miner-v1-results').hidden=true;runner.observation.setEnabled(responseView.propagation.controller.enabled);
  $('research-stimulus-index').value=31;await prep.check();events.context.returning=!!(local.length||runner.returning||prep.inventory.model);events.emit('enter');initialised=true;route();tools.render();contributionView.render();$('miner-events').checked=events.enabled;
  $('research-capabilities').textContent=t('Browser storage quota is disk capacity, not available RAM. Only saved blocks and results survive refresh.');$('research-connect').disabled=true;$('research-chain-state').textContent=t('This deployment uses a signed computation node.');
  window.flypowComputation={snapshot:()=>runner.computation.summary()};window.flypowDiagnostics={summary:()=>events.summary()};
  window.flypowWorkspace={snapshot:()=>({profileId,preparation:state.value.preparation.phase,preparationBusy:prep.busy,actionBusy,execution:state.value.execution.phase,running:runner.running,paused:runner.paused,ready:runtime.ready,cacheModel:!!prep.inventory?.model,preparationSource:state.value.preparation.source,graphicsEnabled:responseView.propagation.graphicsEnabled,runningTaskId:state.value.execution.runningTaskId,viewedResultId:state.value.execution.viewedResultId,saved:local.map(r=>({taskId:r.task_id,k:r.global_task_index})),session:runner.plan?.summary(),plan:prepPlan?.summary(),chainAvailable:!!chain,chainFailure,pool:runner.pool.snapshot(),executions:state.value.execution.tasksByExecution,aggregate:runner.aggregate,poolHistory:runner.history,target:goalView?.runner.snapshot(),networkState:goalView?.snapshot?.state,authorityOnline:goalView?.client.online,authorityError:goalView?.client.lastError,goalResults:goalView?.rows.map(m=>({candidateId:m.candidateId,roundId:m.roundId,phase:m.phase,sciencePassed:m.sciencePassed,won:m.won,trials:m.trials.length})),viewDiagnostics:{...responseView.propagation.snapshot(),source:'current-computation',viewingExecutionId:responseView.live?.executionId,graphicsEnabled:responseView.propagation.graphicsEnabled,visible:responseView.propagation.visible},anatomy:responseView.propagation.scene?.snapshot()||{mode:'2d'},goalUi:goalView?.ui(),miningWallet:goalView?.walletSetup?.state(),artifactSelection:responseView.bundle?.task.taskId})};

  render();if(!deployment.walletMining&&deployment.capabilities.solana&&chainConfig.enabled)initialiseChain(chainConfig,deployment).catch(e=>{chainFailure=e.message;showError(new FlowError('services',e.message));});
}
state.subscribe(render);
$('miner-graphics').addEventListener('change',()=>queueMicrotask(render));
$('anatomy-outline').addEventListener('change',()=>queueMicrotask(render));
$('miner-primary').onclick=()=>{if(prep?.busy||actionBusy)return;if(goalView?.ui().action==='pause'||runner?.running&&!runner.paused)runner.pauseNow();else if(goalView?.ui().action==='configure-mining-wallet')goalView.walletSetup.focus();else if(goalView?.ui().action==='configure-rpc')goalView.rpcSettings.focus();else if(goalView?.ui().action==='connect-wallet')act(()=>goalView.financial.requestConnection());else if(goalView?.ui().action==='sign-in')act(()=>goalView.financial.signIn());else if(goalView?.ui().action==='review-funding')act(()=>goalView.financial.requestFunding());else if(goalView?.ui().action==='sync-wallet')act(()=>goalView.financial.refresh());else if(goalView?.ui().action==='recover-contract-task')act(()=>goalView.recoverContractTask());else if(goalView?.ui().action==='retry-save')act(()=>goalView.retryPendingOutputs());else if(goalView?.ui().action==='sync'&&runtime?.ready)act(()=>goalView.client.poll().then(()=>goalView.refresh(true)));else if(goalView?.ui().action==='none')return;else if(!runtime?.ready)act(prepareDevice);else act(()=>launch(false));};$('miner-single').onclick=()=>act(()=>launch(true));
$('miner-files').onchange=()=>act(()=>importFiles($('miner-files').files));$('miner-drop').ondragover=e=>e.preventDefault();$('miner-drop').ondrop=e=>{e.preventDefault();if(actions().import)act(()=>importFiles(e.dataTransfer.files));};
$('miner-prepare-pause').onclick=()=>{invalidatePreparation('paused');prep.pause();};$('miner-pause-now').onclick=()=>{invalidatePreparation('paused');runner.pauseNow();};$('miner-pause-after').onclick=()=>runner.pauseAfter();
$('miner-stop').onclick=()=>{if(confirm(t('Discard only the unfinished task? In-memory simulation state is lost. Completed results finish saving.')))runner.stopNow();};
$('research-restore').onclick=()=>act(async()=>{if(calculation().running||prep.busy)return;invalidatePreparation('restore-model');await prep.start();});
$('research-cancel').onclick=()=>calculation().running?calculation().stopNow():prep.pause();
$('miner-history-profile').onchange=()=>act(()=>selectHistory($('miner-history-profile').value));
$('research-recompute-viewed').onclick=()=>act(recomputeHistory);
let threadTimer;const applyThreads=()=>{clearTimeout(threadTimer);calculation()?.setThreads(Number($('miner-threads').value));};$('miner-threads').oninput=()=>{$('miner-thread-requested').textContent=$('miner-threads').value;clearTimeout(threadTimer);threadTimer=setTimeout(applyThreads,150);};$('miner-threads').onchange=applyThreads;$('miner-thread-retry').onclick=()=>{if(calculation()?.pool.retryExpansion())calculation().pump();};
$('miner-show-result').onclick=()=>act(async()=>{if(!latest)return;navigate('contributions');$('miner-new-result').hidden=true;newResults=0;await responseView.render(latest);});
$('miner-release').onclick=()=>{if(!actions().release)return;invalidatePreparation('released');runner.pool.dispose();runtime.release();runner.pool.slots.set(runtime.workerId,{id:runtime.workerId,runtime,status:"idle",execution:null});state.update('preparation',{phase:'paused',saved:state.value.preparation.saved});};
for(const [id,type]of [['miner-clear-model','model'],['miner-clear-inputs','inputs']])$(id).onclick=()=>{if(!actions().clear)return;if(confirm(t(type==='model'?'Delete the saved model? Results and reveal secrets are kept. You will need to load or build the model again.':'Delete official input blocks? Preparation progress is lost. Results, model cache and reveal secrets are kept.')))act(()=>{invalidatePreparation('cache-change');return prep.clear(type);});};
$('miner-events').onchange=()=>events.setEnabled($('miner-events').checked);
$('miner-export-diagnostics').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(events.summary(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='flybrain-local-flow-summary.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('miner-connect').onclick=()=>act(()=>connect($('miner-wallet').value));$('miner-submit').onclick=()=>act(advanceSubmission);$('miner-reconcile').onclick=()=>act(async()=>{if(submission?.current){await submission.reconcile(submission.current.record);submission.watch(submission.current.record);}await submission.reconcileFunds();await refresh();});$('miner-close').onclick=()=>act(async()=>{await submission.close();await refresh();});
for(const [id,kind]of [['miner-refund','refund'],['miner-claim','claim']])$(id).onclick=()=>act(async()=>{const ent=submission.current?.ent||fundRow?.ent;if(!ent)throw new FlowError('operation');await submission.funds(kind,ent);await refresh();});
document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a||e.ctrlKey||e.metaKey||e.shiftKey||e.button)return;const u=new URL(a.href,location.href);if(u.origin===location.origin&&/^\/mining\/?$/.test(u.pathname)){e.preventDefault();navigate(u.searchParams.get('view')||'experience');}});
window.addEventListener('popstate',()=>{invalidatePreparation('navigation');viewOperation++;route();if(state.value.view==='experience')responseView?.show();else responseView?.hide();});
document.addEventListener('flypow:language',()=>{if(!initialised)return;setCatalogControls();for(const option of $('miner-history-profile').options)option.textContent=t(profiles.index.profiles.find(p=>p.id===option.value).label);render();tools.render();contributionView.render();responseView.translate();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){hiddenAt=Date.now();invalidatePreparation('hidden');if(prep?.busy)prep.pause();calculation()?.visibility();responseView?.propagation.setVisible(false);if(submission){submission.generation++;clearTimeout(submission.pollTimer);}}else if(hiddenAt){hiddenAt=null;refresh().catch(showError);if(submission?.current)submission.watch(submission.current.record);responseView?.propagation.setVisible(state.value.view==='experience');render();}});
window.addEventListener('pagehide',event=>{if(event.persisted){invalidatePreparation('hidden');if(prep?.busy)prep.pause();calculation()?.pauseNow('hidden');responseView?.hide();return;}invalidatePreparation('refresh');goalView?.dispose();legacyRunner?.dispose();runtime?.release();computationView?.dispose();responseView?.dispose();submission?.dispose();unsubscribeWallet?.();});
window.addEventListener('pageshow',event=>{if(event.persisted){goalView?.client.poll().then(()=>goalView.refresh(true)).catch(showError);if(state.value.view==='experience')responseView?.show();render();}});
setup().catch(showError);

async function refresh({force=true}={}){
  if(!chain)return;
  if(chainRefresh)return chainRefresh;
  if(!force&&performance.now()-lastRefresh<5000)return snapshot;
  chainRefresh=(async()=>{
    snapshot=await chain.snapshot();lastRefresh=performance.now();
    const address=wallet?.account.address;
    const saved=address?await submission.store(address).list():[];
    pending=wallet?.account.address===address?saved:[];
    for(const p of pending){const e=snapshot.entitlements.find(e=>sdk.pk(e.submission).toBase58()===p.submission),page=snapshot.pages.find(p2=>p2.task.taskId===p.taskId),candidate=page?.queue.find(q=>sdk.pk(q.submission).toBase58()===p.submission);
      p.phase=e?.closed?e.accepted?'accepted':'timeout':page?.complete?sdk.pk(page.winner).toBase58()===p.submission?'accepted':'lost':candidate?.status===3?'rejected':candidate?.status===0&&snapshot.clock.unixTimestamp>candidate.revealDeadline?'timeout':'processing';}
    $('research-chain-state').textContent=t('{network} test activity · {status}',{network:chain.config.network,status:['DRAFT','RUNNING','SUCCESS','FAILED'][snapshot.state.state]});
    tools?.render();contributionView?.render();render();return snapshot;
  })();try{return await chainRefresh;}finally{chainRefresh=null;}
}
async function activity({feeLimit=sessionFeeLimit,maxPending=1}={}){
  if(true)return null;
  if(!activeChain())throw new FlowError('services');await refresh({force:false});
  if(performance.now()-serviceCheckAt>15000||!serviceCheckAt){
    serviceCheckAt=performance.now();serviceAvailable=false;
    for(const origin of chain.config.archives){const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),5000);try{const r=await fetch(origin.replace(/\/$/,'')+'/v1/health',{signal:abort.signal,credentials:'omit',cache:'no-store'});if(r.ok){const h=await r.json();if(h.schema==='flypow-archive-health-v1'&&h.campaign===chain.campaign.toBase58()&&h.program===chain.program.toBase58()&&h.accepting){serviceAvailable=true;break;}}}catch{}finally{clearTimeout(timer);}}
  }
  const owned=wallet?snapshot.entitlements.filter(e=>sdk.pk(e.miner).toBase58()===wallet.account.address&&!e.closed):[];
  const accepted=new Set(snapshot.pages.filter(p=>p.complete).map(p=>p.task.taskId));
  const unsigned=local.filter(r=>!accepted.has(r.task_id)&&!owned.some(e=>sdk.hex(e.taskId)===r.task_id)).length;
  return {snapshot,rules:chain.rules,pending:owned.length+unsigned,pendingRecords:pending,maxPending,quote,feeLimit,spent:submission?.spent||0n,hasServices:serviceAvailable&&chain.rules.verifiers.every(x=>x.some(v=>v!==0))};
}
function renderSubmission(){
  const phase=state.value.submission.phase,c=submission?.current,ent=c?.ent||fundRow?.ent;
  $('miner-submission').hidden=!selectedBundle&&!c&&!fundRow;
  $('miner-wallet-picker').hidden=!!wallet;
  $('miner-submission-state').textContent=t(submissionText[phase]);
  $('miner-submit').textContent=t(!wallet?'Connect wallet to review submission':phase==='unsubmitted'?'Submit result':phase==='waiting-reveal'?'Reconcile reveal readiness':phase==='reveal-authorization'?'Reveal result in wallet':phase==='verifying'&&!c?.record.archived?'Authorize archive upload':phase==='revealed'&&!c?.record.archived?'Authorize archive upload':phase==='revealed'?'Confirm verified contribution':'Reconcile submission');
  $('miner-submit').disabled=actionBusy||submission?.running||['sending','signature','archiving'].includes(phase)&&submission?.running;
  if(wallet&&quote){$('miner-beneficiary').textContent=t('Network {network} · beneficiary and refund address: {address}',{network:chain.config.network,address:wallet.account.address});$('miner-funding-quote').textContent=t('Storage principal {principal} SOL · refundable advance {advance} SOL · nonrefundable queue service fee {fee} SOL · account funding cap {cap} SOL. The wallet quotes additional transaction fees before signing.',{principal:formatAtoms(quote.principal),advance:formatAtoms(quote.advance),fee:formatAtoms(quote.queueFee),cap:formatAtoms(quote.max)});}
  else{$('miner-beneficiary').textContent='';$('miner-funding-quote').textContent=t('Connect a compatible wallet to review exact test network fees before submitting.');}
  const funds=ent&&wallet?entitlementFunds(ent,snapshot,wallet.account.address,sdk):null;
  $('miner-refund').hidden=!funds?.refundable;$('miner-claim').hidden=!funds?.claimable;
  $('miner-close').hidden=!c?.receipt||!['accepted','lost','rejected','timeout'].includes(c.phase);
  if(!wallet){const options=sdk.standardWallets().map(w=>new Option(w.name,w.name));$('miner-wallet').replaceChildren(...options);$('miner-connect').disabled=!options.length;if(!options.length)$('miner-submission-error').textContent=t('No compatible wallet found. Install or unlock one, or continue browsing local results.');}
}
async function connect(name){
  unsubscribeWallet?.();wallet=await sdk.connectStandardWallet(name);lastWalletAddress=wallet.account.address;submission.walletChanged();quote=await chain.quote();
  const q=t('1024-byte principal {principal} lamports; refundable advance {advance}; declared queue fee {fee}; account funding cap {cap}. The wallet separately quotes transaction fees.',{principal:quote.principal,advance:quote.advance,fee:quote.queueFee,cap:quote.max});$('research-chain-quote').textContent=q;
  unsubscribeWallet=wallet.wallet.features['standard:events']?.on('change',({accounts})=>{if(!accounts)return;if(accounts[0]?.address!==lastWalletAddress){wallet=null;lastWalletAddress=null;pending=[];fundRow=null;submission.walletChanged();runner.pauseAfter();refresh().catch(showError);render();}});
  await refresh();const saved=await submission.store().list();if(saved.length){await submission.reconcile(saved.at(-1));submission.watch(saved.at(-1));events.emit('submission-restore','complete');}await submission.reconcileFunds();render();
}
async function reviewSubmission(record,row=null){fundRow=row;if(record){await submission.reconcile(record);submission.watch(record);}else state.update('submission',{phase:'unsubmitted'});$('miner-submission').hidden=false;$('miner-submission').scrollIntoView({block:'nearest'});render();}
async function advanceSubmission(){
  if(!wallet){await connect($('miner-wallet').value);return;}
  const current=submission.current;
  if(!current||current.phase==='unsubmitted'||current.record.taskId!==selectedBundle?.task.taskId&&selectedBundle&&!fundRow){const b=await responseView.full();if(!b)throw new FlowError('damaged');sessionFeeLimit=parseSOL($('miner-fee-limit').value);await submission.commit(b,{fundingLimit:sessionFeeLimit});}
  else if(current.phase==='reveal-authorization'||current.phase==='waiting-reveal')await submission.continue();
  else if(['verifying','revealed'].includes(current.phase)&&!current.record.archived)await submission.archive();
  else if(current.phase==='revealed')await submission.finalize();
  else await submission.reconcile(current.record);
  await refresh();render();
}

window.addEventListener('pagehide',event=>{if(!event.persisted)logBackdrop.dispose();});
