// Persistent history remains authoritative after incremental events or paging.
import assert from 'node:assert/strict';
import { GoalMiningView } from '../web/goal-mining-view.mjs';
Object.defineProperty(globalThis,'navigator',{value:{storage:{}},configurable:true});
const round=(n,status='FINALIZED')=>({roundId:String(n).padStart(64,'0'),roundSequence:n,status});
const view={store:{list:async()=>[]},network:{networkId:'history-test'},client:{online:true,stats:async()=>({confirmedRounds:3}),history:async()=>({asOf:200,rounds:[round(4,'OPEN'),round(3)]})},historyBefore:2,roundHistory:{nextBefore:1,rounds:[round(3,'OPEN'),round(2),round(1)]},renderResults(){},render(){}};
await GoalMiningView.prototype.refresh.call(view,true);
assert.deepEqual(view.recentRounds,[round(4,'OPEN'),round(3)]);
assert.deepEqual(view.roundHistory.rounds,[round(4,'OPEN'),round(3),round(2),round(1)]);
assert.equal(view.roundHistory.nextBefore,1,'newest refresh retains older-page cursor');
assert.equal(view.roundHistory.asOf,200);
await GoalMiningView.prototype.refresh.call(view,true);
assert.equal(view.roundHistory.rounds.length,4,'poll and duplicated SSE-triggered refresh cannot duplicate a historical round');
console.log('Paged history refresh keeps older rows, updates latest outcomes and removes duplicate round identities.');
