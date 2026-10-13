import assert from 'node:assert/strict';
import { deriveGoalUiState } from '../web/goal-ui-state.mjs';

const base={network:{enabled:true},online:true,snapshot:{state:'RESEARCH_STAGE_COMPLETE',round:null},serverNow:0,preparation:'needed',walletRequired:true,walletConnected:false,walletSignedIn:false};
assert.equal(deriveGoalUiState(base).action,'connect-wallet');
assert.equal(deriveGoalUiState(base).disabled,false);
assert.equal(deriveGoalUiState({...base,walletConnected:true}).action,'sign-in');
assert.equal(deriveGoalUiState({...base,walletConnected:true,walletSignedIn:true}).state,'waiting-next-goal');
assert.equal(deriveGoalUiState({...base,walletConnected:true,walletSignedIn:true}).disabled,true);
assert.equal(deriveGoalUiState({...base,pendingOutputs:1}).action,'retry-save');
assert.equal(deriveGoalUiState({...base,running:true,paused:false}).action,'pause');
assert.equal(deriveGoalUiState({...base,preparing:true}).action,'pause-preparation');
assert.equal(deriveGoalUiState({...base,walletRequired:false}).state,'waiting-next-goal');
console.log(JSON.stringify({passed:true,checks:9,transactions:0}));
