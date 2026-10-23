import assert from 'node:assert/strict';
import {taskSupplySampleV4} from '../web/task-supply-status-v4.mjs';

const sample={schema:'flybrainlabs-factory-health-v4',businessReady:true,discoveryAgeMs:100,
 inventory:{scheduledAndOpenTasks:30,actualOpen:0},verifier:{supply:{code:'POOL_REWARD_AUTHORIZATION_EXHAUSTED'}}};
assert.deepEqual(taskSupplySampleV4(sample,1000),{remaining:30,open:0,ready:true,budgetExhausted:true,checkedAt:1000});
for(const invalid of [null,{}, {...sample,discoveryAgeMs:60001},{...sample,discoveryAgeMs:-1},
 {...sample,inventory:{scheduledAndOpenTasks:'30',actualOpen:0}},
 {...sample,inventory:{scheduledAndOpenTasks:0,actualOpen:1}},
 {...sample,inventory:{scheduledAndOpenTasks:Infinity,actualOpen:0}}])assert.throws(()=>taskSupplySampleV4(invalid));
assert.equal(taskSupplySampleV4({...sample,businessReady:false}).ready,false);
assert.equal(taskSupplySampleV4({...sample,verifier:{supply:null}}).budgetExhausted,false);
console.log('Supply samples retain funded inventory without claiming open work; stale, malformed and inconsistent observations rejected.');
