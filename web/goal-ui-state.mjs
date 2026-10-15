export function goalAvailability({network,online,snapshot,serverNow}){
  if(!network.enabled)return 'network-unconfigured';
  if(!online)return 'authority-disconnected';
  if(snapshot?.state==='CALIBRATION_REQUIRED')return 'calibration-required';
  if(snapshot?.state==='RESEARCH_STAGE_COMPLETE')return 'research-stage-complete';
  if(!snapshot?.round)return 'waiting-next-goal';
  if(serverNow>=snapshot.round.pre.claimDeadline)return 'new-claims-closed';
  return 'open';
}
export function deriveGoalUiState({network,online,snapshot,serverNow,preparation,modelReady,preparing=false,running=false,paused=false,reason=null,actionBusy=false,pendingOutputs=0,walletRequired=false,walletConnected=true,walletSignedIn=true,walletRestoring=false,fundingGate=null}){
  const result=(state,button,disabled=false,action='start')=>({state,button,disabled,action,pendingOutputs});
  if(preparing)return result('preparing:'+preparation,'pause-preparation',false,'pause-preparation');
  if(running&&!paused)return result(snapshot?.round?'running':'waiting-next-goal','pause-mining',false,'pause');
  if(running&&paused&&['authority-disconnected','network'].includes(reason))return result('waiting-connection','pause-mining',false,'pause');
  // Local artifacts remain recoverable without a model, an open round or a
  // connection. Resolving them never grants permission to start computation.
  if(pendingOutputs)return result('save-failed','retry-saving',actionBusy,'retry-save');
  if(walletRequired&&walletRestoring)return result('wallet-restoring','wallet-restoring',true,'none');
  if(walletRequired&&!walletConnected)return result('wallet-required','connect-wallet',actionBusy,'connect-wallet');
  if(walletRequired&&!walletSignedIn)return result('wallet-login-required','sign-in',actionBusy,'sign-in');
  if(preparation==='unsupported')return result('unsupported','unsupported',true,'none');
  // Preparing a local model neither enters a round nor authorizes computation.
  if(modelReady===false)return result('preparation-required','prepare-model',actionBusy,'prepare');
  if(!network.enabled)return result('network-unconfigured','network-unconfigured',true,'configure');
  if(!online)return result('authority-disconnected','retry-network',actionBusy,'sync');
  if(snapshot?.state==='CALIBRATION_REQUIRED')return result('calibration-required','calibration-required',true,'sync');
  if(!snapshot?.round&&preparation==='ready')return result('waiting-next-goal',paused?'continue-mining':'wait-for-tasks',actionBusy,paused?'resume':'start');
  if(snapshot?.state==='RESEARCH_STAGE_COMPLETE')return result('research-stage-complete','check-new-tasks',actionBusy,'sync');
  if(!snapshot?.round)return result('waiting-next-goal','check-new-tasks',actionBusy,'sync');
  if(serverNow>=snapshot.round.pre.claimDeadline)return result('new-claims-closed','new-claims-closed',true,'sync');
  if(fundingGate==='wallet-login-required')return result('wallet-login-required','sign-in',actionBusy,'sign-in');
  if(fundingGate==='funding-check-required')return result(fundingGate,'check-wallet-state',actionBusy,'sync-wallet');
  if(fundingGate==='funding-unavailable')return result(fundingGate,'check-new-tasks',actionBusy,'sync');
  if(['funding-required','funding-insufficient','funding-device-required'].includes(fundingGate))return result(fundingGate,fundingGate==='funding-device-required'?'renew-device-grant':'review-funding',actionBusy,'review-funding');
  if(paused&&reason==='input-domain-exhausted')return result('input-domain-exhausted','input-domain-exhausted',true,'sync');
  if(paused)return result(reason||'paused','continue-mining',actionBusy,'resume');
  return result('open','start-mining',actionBusy,'start');
}
