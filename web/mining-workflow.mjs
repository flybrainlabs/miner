// Presentation follows real preparation phases; it never starts a Worker.
export const MINING_STEPS=['download','build','mining'];
const phaseStep={checking:'download',needed:'download',files:'download',fetching:'download','checking-files':'build',building:'build',loading:'build',ready:'mining'};
export function miningWorkflow(preparation={}, {ready=false,running=false,pendingOutputs=0}={}) {
  const phase=preparation.phase||'checking';
  let step=phaseStep[phase]||phaseStep[preparation.resumePhase]||'download';
  // Inventory is a lightweight hint, not proof that model validation ran.
  if(phase==='needed'&&preparation.inventory?.model)step='build';
  if(step==='mining'&&!ready&&!running)step='build';
  if(ready||running||pendingOutputs)step='mining';
  const interrupted=['paused','space','unsupported','error'].includes(phase)&&!ready&&!running;
  return {step,index:MINING_STEPS.indexOf(step),interrupted,
    reused:!!preparation.inventory?.model||preparation.source==='restored',
    states:MINING_STEPS.map((name,index)=>index<MINING_STEPS.indexOf(step)?'complete':name===step?(interrupted||pendingOutputs?'attention':'current'):'pending')};
}
export function showMiningStage(document,workflow){
  document.querySelector('.miner-primary-panel').dataset.stage=workflow.step;
  for(const [index,step]of MINING_STEPS.entries()){
    const active=step===workflow.step,tab=document.getElementById('miner-step-'+step),panel=document.getElementById('miner-stage-'+step);
    tab.hidden=!active;tab.setAttribute('aria-selected',String(active));tab.setAttribute('aria-current',active?'step':'false');tab.disabled=!active;tab.tabIndex=active?0:-1;tab.dataset.status=workflow.states[index];panel.hidden=!active;
  }
  document.getElementById('miner-preparation-progress').hidden=workflow.step==='mining';document.getElementById('miner-live-progress').hidden=workflow.step!=='mining';
}
