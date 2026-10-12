// Controlled known-input selection for acceptance only, never discoveries.
// Reuses the local full model and per-round native files. Browser must still
// compute its own complete archives; this CLI does not submit or vote.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {verified,api,canonical} from '../tools/target_dev_identity.mjs';
import {hash} from '../web/target-protocol-v2.mjs';
const dir=resolve(process.argv[2]||'/workspace/.flypow-tools/live-current-v3-network'),base='http://127.0.0.1:8790',network=JSON.parse(await readFile(join(dir,'network-public.json'))),snapshot=await verified(network.authorityId,'authority-snapshot',await(await api(base,'rounds/current')).json()),r=snapshot.round;
assert(r&&r.pre.claimDeadline>snapshot.serverTime,'Need a real open round');
const root=resolve('data/prepared/live-current-v3/controlled-input',r.roundId);await mkdir(root,{recursive:true});await writeFile(join(root,'goal.json'),canonical(r.goal));await writeFile(join(root,'round.json'),canonical(r));
const candidates=[['16789',96,125],['87973',96,125],['87973',0,100],['16961',0,125],['16789',0,125],['18708',96,125]].map(([stimulatedBodyId,startStep,current])=>({stimulatedBodyId,startStep,endStep:startStep+1,current}));
const report={scope:'Known test-input selection only; not browser competition or new discovery',controlledKnownInput:true,roundId:r.roundId,goalId:r.pre.goalId,attempts:[],officialDownloads:0};
for(const [i,input]of candidates.entries()){
 const inputPath=join(root,'input-'+i+'.json');await writeFile(inputPath,canonical(input));const trials=[];
 for(let j=0;j<r.pre.requiredBackgrounds;j++){
  const file=join(root,`input-${i}-trial-${j}.bin`),meta=file+'.json';let m;
  try{m=JSON.parse(await readFile(meta));assert.equal(m.seedHex,r.seeds[j]);assert.equal(await hash(await readFile(file)),m.resultRoot);}catch(e){if(e.code!=='ENOENT')throw e;m=await new Promise((ok,bad)=>{const p=spawn('target/release/target_trial',['data/prepared/registry-male-cns-v1.0/graph-v1.bin','data/prepared/registry-male-cns-v1.0/model-v0.bin',join(root,'goal.json'),inputPath,r.seeds[j],file]);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',bad);p.on('close',code=>code?bad(new Error(err)):ok(JSON.parse(out)));});await writeFile(meta,canonical(m));}
  trials.push(m);console.log(JSON.stringify({input,background:j+1,passed:m.metrics.passed}));if(!m.metrics.passed)break;
 }
 report.attempts.push({input,trials});if(trials.length===r.pre.requiredBackgrounds&&trials.every(t=>t.metrics.passed)){report.selected=input;await writeFile(join(root,'selected-input.json'),canonical(input));}
 await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');if(report.selected){console.log(JSON.stringify({selectedInputFile:join(root,'selected-input.json'),roundId:r.roundId}));break;}
}
assert(report.selected,'No complete passing known-input test candidate found; do not alter frozen conditions');
