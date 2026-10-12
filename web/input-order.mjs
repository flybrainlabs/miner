// Mixed-radix traversal: constant memory, no materialized/sorted search space.
import { id } from './target-protocol-v2.mjs';
export function domainSize(goal){
  const d=goal.inputDomain,size=goal.stimulusSet.length*d.starts.length*d.durations.length*d.currents.length;
  if(!Number.isSafeInteger(size)||size<1||size>1000000)throw new Error('Input domain product bound');return size;
}
export function inputAt(goal,index){
  const size=domainSize(goal),d=goal.inputDomain;if(!Number.isSafeInteger(index)||index<0||index>=size)throw new Error('Input index range');
  const current=d.currents[index%d.currents.length];index=Math.floor(index/d.currents.length);
  const duration=d.durations[index%d.durations.length];index=Math.floor(index/d.durations.length);
  const startStep=d.starts[index%d.starts.length];index=Math.floor(index/d.starts.length);const endStep=startStep+duration;
  return endStep+goal.windows[1].endOffset<=goal.steps&&current*duration<=goal.maxStimulusCost?{stimulatedBodyId:goal.stimulusSet[index].bodyId,startStep,endStep,current}:null;
}
export function legalInputCount(goal){
  domainSize(goal);let n=0;const d=goal.inputDomain;
  for(const start of d.starts)for(const duration of d.durations)if(start+duration+goal.windows[1].endOffset<=goal.steps)for(const current of d.currents)if(current*duration<=goal.maxStimulusCost)n++;
  return n*goal.stimulusSet.length;
}
const gcd=(a,b)=>b?gcd(b,a%b):a;
export async function createInputOrder(goal,minerId,roundId){
  const size=domainSize(goal),key=await id('lazy-input-order',{version:'affine-v1',minerId,roundId});
  const offset=Number(BigInt('0x'+key.slice(0,16))%BigInt(size));let stride=Number(BigInt('0x'+key.slice(16,32))%BigInt(size))||1;
  while(gcd(stride,size)!==1)stride=stride%size+1;
  return {schema:'flypow-lazy-input-order-v1',size,offset,stride,at:index=>inputAt(goal,(offset+index*stride)%size)};
}
