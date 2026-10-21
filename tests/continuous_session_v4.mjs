import assert from 'node:assert/strict';
import {MiningSessionController} from '../web/mining-session-controller.mjs';
const deferred=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return {promise,resolve};};
const tick=()=>new Promise(setImmediate);
{
  const model=deferred(),events=[];let identity='wallet:rpc:1';
  const controller=new MiningSessionController({identity:()=>identity,prepareModel:async()=>{events.push('model');await model.promise;},prepareSession:async({activate})=>events.push(activate?'open':'read'),dispatch:async()=>events.push('compute')});
  const first=controller.start(),second=controller.start();assert.equal(first,second);await tick();assert.deepEqual(events,['model','read']);
  model.resolve();await first;assert.deepEqual(events,['model','read','open','compute']);assert.equal(controller.state,'running');
}
{
  const model=deferred(),events=[];let identity='original';
  const controller=new MiningSessionController({identity:()=>identity,prepareModel:()=>model.promise,prepareSession:async({activate})=>{if(activate)events.push('open');},dispatch:async()=>events.push('compute')});
  const work=controller.start();await tick();identity='different-rpc';model.resolve();await work;assert.deepEqual(events,[]);
}
{
  const model=deferred(),events=[];
  const controller=new MiningSessionController({identity:()=>1,prepareModel:()=>model.promise,prepareSession:async({activate})=>{if(activate)events.push('open');},dispatch:async()=>events.push('compute')});
  const work=controller.start();controller.cancel();model.resolve();await work;assert.deepEqual(events,[]);assert(!controller.intent);assert.equal(controller.state,'paused-by-user');
}
{
  const events=[];let failures=1;
  const controller=new MiningSessionController({identity:()=>1,prepareModel:async()=>{},prepareSession:async({activate})=>{if(activate&&failures-- >0)throw Object.assign(new Error('Temporary outage'),{code:'RPC_UNAVAILABLE'});},dispatch:async()=>events.push('compute'),retryable:e=>e.code==='RPC_UNAVAILABLE'});
  const work=controller.start();await tick();assert.equal(controller.state,'recovering-network');controller.retryResolve();await work;assert.deepEqual(events,['compute']);assert(controller.intent);
  controller.cancel();await tick();assert(!controller.intent);
}
console.log(JSON.stringify({passed:true,scope:'Actual startup controller with delayed model, cancellation, identity changes and recoverable RPC; no chain I/O',cases:4}));
