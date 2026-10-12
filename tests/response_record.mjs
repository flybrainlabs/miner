import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildRecord,replayFrame,digest } from '../web/response-record.mjs';
import { decodeSubmissionV1,encodeSubmissionV1 } from '../web/receipt-v1.mjs';
import { taskForIndex } from '../web/catalog-task.mjs';
import { merkle,hex,wholeAllocation } from '../web/campaign-codec.mjs';
import { CampaignClient } from '../web/solana-client.mjs';
const golden=new Uint8Array(await readFile('tests/fixtures/submission-v1.bin')),s=decodeSubmissionV1(golden);
assert.deepEqual(encodeSubmissionV1(s),golden);s.funding.storagePrincipalLamports=(1n<<64n)-1n;assert.equal(decodeSubmissionV1(encodeSubmissionV1(s)).funding.storagePrincipalLamports,s.funding.storagePrincipalLamports);
s.funding.storagePrincipalLamports=1n<<64n;assert.throws(()=>encodeSubmissionV1(s));s.funding.storagePrincipalLamports=1n;s.header.flags=1n<<32n;assert.throws(()=>encodeSubmissionV1(s));
const catalog=JSON.parse(await readFile('web/data/task-catalog-dev.json')),tasks=await Promise.all(Array.from({length:1024},(_,k)=>taskForIndex(catalog,k)));assert.equal(hex(merkle(tasks).root),hex(catalog.task_manifest_root));assert.equal(Array.from({length:1024},(_,k)=>wholeAllocation(k,1024,224519936)).reduce((a,b)=>a+b,0n),224519936n);
const client=Object.create(CampaignClient.prototype);client.rules={advance:5n,queue_fee:2n};for(const rent of [1234,9876]){client.connection={getMinimumBalanceForRentExemption:async n=>{assert.equal(n,1024);return rent;}};assert.equal((await client.quote()).max,BigInt(rent)+7n);}
const cfg={neuron_count:3,steps:32,time_step_us:1000,registry_sha256:'11'.repeat(32),model_root_sha256:'22'.repeat(32)},task={k:0,bodyId:42,targetIndex:0,taskId:'33'.repeat(32),seed:7n,stimulus:{start_step:0,end_step:2,current:100}};
const bytes=new Uint8Array(496),v=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode('FBRP1\0\0\0'));v.setUint32(8,3,true);v.setUint32(16,32,true);bytes[20]=1;v.setBigUint64(24,1n,true);v.setBigUint64(32,1n,true);v.setBigUint64(40,1n,true);v.setBigUint64(48,1n,true);v.setBigUint64(56,1n,true);v.setBigUint64(64,1n,true);v.setInt32(216,-1,true);v.setInt32(220,1,true);v.setBigUint64(344,42n,true);v.setUint32(472,1,true);v.setUint32(476,1,true);v.setUint32(480,0,true);v.setUint32(488,1,true);
const bundle=await buildRecord(bytes,cfg,task,body=>body===42n?0:-1);assert.equal(bundle.resultRoot,await digest(bytes));assert.equal(bundle.preview.spikes_a[0][0],0);assert.equal(bundle.preview.spikes_b[0][0],1);assert.equal(replayFrame(bundle.preview,'42',0,'difference').color,'#ff8f88');assert.equal(replayFrame(bundle.preview,'42',1,'b').active,true);assert.throws(()=>replayFrame(bundle.preview,'43',1,'b'));assert.throws(()=>replayFrame(bundle.preview,'42',32,'b'));
const damaged=bytes.slice();new DataView(damaged.buffer).setUint32(484,3,true);await assert.rejects(()=>buildRecord(damaged,cfg,task,()=>0));
console.log('Receipt writes, full-catalog Merkle root, integer budget, changing rent quote and actual spike replay passed');
