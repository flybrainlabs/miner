import assert from 'node:assert/strict';
import { deriveGoalUiState,goalAvailability } from '../web/goal-ui-state.mjs';

const base={network:{enabled:true},online:true,snapshot:{state:'RESEARCH_STAGE_COMPLETE',round:null},serverNow:0,preparation:'needed',walletRequired:true,walletConnected:false,walletSignedIn:false};
assert.equal(deriveGoalUiState(base).action,'connect-wallet');
assert.equal(deriveGoalUiState(base).disabled,false);
assert.equal(deriveGoalUiState({...base,walletConnected:true}).action,'sign-in');
assert.equal(deriveGoalUiState({...base,walletConnected:true,walletSignedIn:true}).state,'research-stage-complete');
assert.equal(deriveGoalUiState({...base,walletConnected:true,walletSignedIn:true}).disabled,false);
assert.equal(deriveGoalUiState({...base,pendingOutputs:1}).action,'retry-save');
assert.equal(deriveGoalUiState({...base,running:true,paused:false}).action,'pause');
assert.equal(deriveGoalUiState({...base,preparing:true}).action,'pause-preparation');
assert.equal(deriveGoalUiState({...base,walletRequired:false}).state,'research-stage-complete');
assert.equal(deriveGoalUiState({...base,walletRestoring:true}).state,'wallet-restoring');
assert.equal(deriveGoalUiState({...base,walletRestoring:true}).disabled,true);
assert.equal(deriveGoalUiState({...base,walletConnected:true,walletSignedIn:true}).action,'sync');
assert.equal(deriveGoalUiState({...base,walletConnected:true,walletSignedIn:true,actionBusy:true}).disabled,true);
assert.equal(goalAvailability(base),'research-stage-complete');
assert.equal(goalAvailability({...base,online:false}),'authority-disconnected');
assert.equal(goalAvailability({...base,snapshot:{state:'CALIBRATION_REQUIRED'}}),'calibration-required');
assert.equal(goalAvailability({...base,snapshot:{round:{pre:{claimDeadline:10}}}}),'open');
const open={...base,snapshot:{round:{pre:{claimDeadline:10}}},preparation:'ready',walletConnected:true,walletSignedIn:true};
for(const gate of ['funding-required','funding-insufficient','funding-device-required']){
  const ui=deriveGoalUiState({...open,fundingGate:gate});assert.equal(ui.state,gate);assert.equal(ui.action,'review-funding');assert.equal(ui.disabled,false);
}
assert.equal(deriveGoalUiState({...open,fundingGate:'funding-check-required'}).action,'sync-wallet');
assert.equal(deriveGoalUiState({...open,fundingGate:'wallet-login-required'}).action,'sign-in');
assert.equal(deriveGoalUiState({...open,fundingGate:'funding-unavailable'}).action,'sync');
assert.equal(deriveGoalUiState({...open,fundingGate:null}).action,'start');
assert.equal(deriveGoalUiState({...open,pendingOutputs:1,fundingGate:'funding-required'}).action,'retry-save');
assert.equal(deriveGoalUiState({...open,running:true,paused:false,fundingGate:'funding-required'}).action,'pause');
assert.equal(deriveGoalUiState({...open,serverNow:11,fundingGate:'funding-required'}).state,'new-claims-closed');
assert.equal(deriveGoalUiState({...open,actionBusy:true,fundingGate:'funding-required'}).disabled,true);
console.log(JSON.stringify({passed:true,checks:28,transactions:0}));
