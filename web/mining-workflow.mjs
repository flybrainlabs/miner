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
