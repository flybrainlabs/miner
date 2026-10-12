import assert from 'node:assert/strict';
import {PreparationController} from '../web/preparation-controller.mjs';
import {createMinerState,FlowError} from '../web/miner-state.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
for(const cancelAt of ['permission','cache']){
  const gate=deferred(),state=createMinerState(),events=[];let cacheCalls=0;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_,__,f)=>f({})},storage:{getDirectory:()=>{},persist:()=>cancelAt==='permission'?gate.promise:Promise.resolve(true)}}});
  const runtime={ready:false,request:async type=>{if(type==='prepare'){runtime.ready=true;return;}if(type==='cache'){cacheCalls++;return gate.promise;}throw new Error(type);},release:()=>{runtime.ready=false;if(cancelAt==='cache')gate.reject(new FlowError('paused'));}};
  const p=new PreparationController({config:{},manifest:{sources:[]},runtime,state,events:{emit:(...x)=>events.push(x)}}),done=p.preparedFiles({},{});
  await new Promise(r=>setTimeout(r,0));assert(p.busy);assert(runtime.ready);p.pause();if(cancelAt==='permission')gate.resolve(true);
  await assert.rejects(done,e=>e.name==='AbortError'||e.code==='paused');assert.equal(state.value.preparation.phase,'paused');assert.equal(p.busy,false);assert.equal(runtime.ready,false);assert(!events.some(x=>x[0]==='prepare'&&x[1]==='complete'));assert.equal(cacheCalls,cancelAt==='cache'?1:0);
}
console.log(JSON.stringify({passed:2,checks:['Cancel after model ready but before persistence never starts cache','Cancel during cache remains paused instead of announcing released model ready']}));
