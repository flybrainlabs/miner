// Durable V5 miner orchestration. Trial execution, personal RPC and the wallet
// are injected by the browser view; no scientific outcome is fabricated here.
import {inputs,canonical} from './target-protocol-v2.mjs';
import {hex,fromHex,contentRoot,inputIdentity,inputCommitment,scientificTrialTask,STATES} from '/assets/vendor/generated/scientific-v5.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class ScientificJournalV5 {
  async access(mode,fn){const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('flybrain-scientific-mining-v5',1);q.onupgradeneeded=()=>q.result.createObjectStore('claims');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction('claims',mode);let result;fn(tx.objectStore('claims'),value=>result=value);tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
  get(key){return this.access('readonly',(s,done)=>{s.get(key).onsuccess=e=>done(e.target.result||null);});}
  put(key,value){return this.access('readwrite',s=>s.put(value,key));}
  list(){return this.access('readonly',(s,done)=>{s.getAll().onsuccess=e=>done(e.target.result);});}
}
export function scientificSearchOrder(goal,seed){
  const domain=inputs(goal),score=x=>hex(contentRoot({seed,input:x}));
  const ordered=domain.map(input=>({input,cost:input.current*(input.endStep-input.startStep),score:score(input)}));
  const explore=[...ordered].sort((a,b)=>a.score.localeCompare(b.score));ordered.sort((a,b)=>a.cost-b.cost||a.score.localeCompare(b.score));
  const seen=new Set(),result=[];let a=0,b=0;
  while(result.length<domain.length){const row=result.length%4===3&&b<explore.length?explore[b++]:ordered[a++];if(!row)continue;const key=hex(inputIdentity(row.input));if(!seen.has(key)){seen.add(key);result.push(row.input);}}
  return result;
}
export function updatePareto(frontier,row){
  const vector=x=>[x.cost,x.offTarget,-x.targetEffect],dominates=(a,b)=>{const x=vector(a),y=vector(b);return x.every((n,i)=>n<=y[i])&&x.some((n,i)=>n<y[i]);};
  if(frontier.some(x=>dominates(x,row)))return frontier;return [...frontier.filter(x=>!dominates(row,x)),row];
}
export class ScientificMiningRunnerV5 {
  constructor({client,compute,publish,journal=new ScientificJournalV5(),onState=()=>{},searchBudget=32,wait=delay}){
    if(!Number.isInteger(searchBudget)||searchBudget<1||searchBudget>256)throw new Error('Finite search evaluation budget required');
    Object.assign(this,{client,compute,publish,journal,onState,searchBudget,wait});this.running=false;this.stopped=false;this.frontier=[];
  }
  state(phase,details={}){this.phase=phase;this.onState({phase,...details});}
  stop(){this.stopped=true;this.state('paused');}
  assertActive(){if(this.stopped)throw Object.assign(new Error('Scientific mining paused; saved work is retained'),{code:'SCIENCE_PAUSED'});if(this.walletAddress&&String(this.client.wallet.publicKey)!==this.walletAddress)throw Object.assign(new Error('Wallet changed; saved scientific work is retained'),{code:'SCIENCE_WALLET_CHANGED'});}
  async slot(){return BigInt(await this.client.connection.getSlot('confirmed'));}
  async trial(r,address,content,input,role,assignment,index,training=false){
    this.assertActive();const task=await scientificTrialTask(r,address,content,input,role,assignment,index,{training});
    this.state(training?'searching':'computing',{round:address,role,index,input,training});
    const result=await this.compute({task,round:{roundAddress:address,content,goal:content.goal},reader:this.client.reader});
    if(!result.archive||!result.goalMetrics||result.resultHash!==hex(new Uint8Array(await crypto.subtle.digest('SHA-256',await new Blob([result.archive]).arrayBuffer()))))throw new Error('Complete computed archive required');
    return {archive:result.archive instanceof Blob?result.archive:new Blob([result.archive]),trial:{index,seedHex:task.seedHex,resultRoot:result.resultHash,bytes:result.responseBytes,metrics:result.goalMetrics}};
  }
  async selectInput(r,address,content,role,assignment){
    if(role>0)return content.auditInputs[2*(role-1)+assignment];
    let tested=0;
    for(const input of scientificSearchOrder(content.goal,String(this.client.wallet.publicKey))){
      this.assertActive();if(tested++>=this.searchBudget||await this.slot()>=r.specification.commitEnd)break;
      const outcomes=[];
      for(let j=0;j<2;j++){const result=await this.trial(r,address,content,input,0,255,j,true);outcomes.push(result.trial.metrics);if(!result.trial.metrics.passed)break;}
      if(outcomes.length===2&&outcomes.every(x=>x.passed)){
        const windows=outcomes.flatMap(x=>x.windows);this.frontier=updatePareto(this.frontier,{input,cost:outcomes[0].stimulusCost,offTarget:Math.max(...windows.map(x=>x.offTargetAbs)),targetEffect:Math.min(...windows.map(x=>x.targetNet))});
        return input;
      }
    }
    this.state('no-qualifying-intervention',{round:address,tested:Math.min(tested,this.searchBudget)});return null;
  }
  async run(address,{role=0,assignment=255,waitForPayment=true}={}){
    if(this.running)throw new Error('Scientific mining is already running');if(![0,1,2].includes(role)||!(role===0?assignment===255:[0,1].includes(assignment)))throw new Error('Scientific contribution role');
    this.running=true;this.stopped=false;this.walletAddress=String(this.client.wallet.publicKey);
    try{
      const reader=this.client.reader;let r=await reader.round(address),content=await reader.content(r,this.client.contentStore);
      const wallet=String(this.client.wallet.publicKey),key=[this.client.deployment.genesisHash,this.client.deployment.programId,wallet,address,role,assignment].join(':');
      let saved=await this.journal.get(key);
      if(!saved){while(await this.slot()<r.specification.commitStart){this.assertActive();this.state('waiting-commit-window',{round:address,until:String(r.specification.commitStart)});await this.wait(1500);}
        if(await this.slot()>=r.specification.commitEnd||r.closed){this.state('commit-window-closed',{round:address});return null;}
        const input=await this.selectInput(r,address,content,role,assignment);if(!input)return null;
        const salt=crypto.getRandomValues(new Uint8Array(32)),c={round:new Uint8Array(reader.a.round(r.specification.id).toBytes()),miner:new Uint8Array(this.client.wallet.publicKey.toBytes()),beneficiary:new Uint8Array(this.client.wallet.publicKey.toBytes()),role,assignment};
        const commitment=inputCommitment(reader.program,r,c,inputIdentity(input),salt),claim=reader.a.claim(address,this.client.wallet.publicKey,commitment).toBase58();
        saved={schema:'flybrain-scientific-miner-claim-v5',key,wallet,round:address,role,assignment,input,salt:hex(salt),commitment:hex(commitment),claim,trials:[],archives:[],phase:'prepared'};await this.journal.put(key,saved);
      }
      if(!await reader.connection.getAccountInfo(reader.a.claim(address,this.client.wallet.publicKey,fromHex(saved.commitment)),'finalized')){
        this.assertActive();this.state('committing-input',{round:address});
        await this.client.commit(address,{commitment:fromHex(saved.commitment),beneficiary:this.client.wallet.publicKey,role,assignment});saved.phase='committed';await this.journal.put(key,saved);
      }
      let c=await reader.claim(saved.claim,address);
      if(c.state===STATES.COMMITTED){
        while(!r.challenge.some(x=>x)){
          this.assertActive();if(await this.slot()>r.specification.challengeSlot+128n)throw new Error('Public challenge missed its registered deadline');
          this.state('waiting-public-challenge',{round:address,claim:saved.claim,until:String(r.specification.challengeSlot)});await this.wait(1500);r=await reader.round(address);
        }
        for(let j=saved.trials.length;j<r.specification.backgrounds;j++){
          if(await this.slot()>r.specification.revealEnd)throw new Error('Reveal window ended; computed results remain saved');
          const result=await this.trial(r,address,content,saved.input,role,assignment,j);saved.trials.push(result.trial);saved.archives.push(result.archive);saved.phase='computing';await this.journal.put(key,saved);
        }
        const computation=await scientificTrialTask(r,address,content,saved.input,role,assignment,0);
        const manifest={schema:'flybrain-scientific-manifest-v5',round:address,input:saved.input,role,assignment,computation:computation.candidateId,analysis:hex(r.specification.analysis),trials:saved.trials};
        this.state('publishing-evidence',{round:address,claim:saved.claim});
        for(let j=0;j<saved.trials.length;j++){this.assertActive();await this.publish({round:address,claim:saved.claim,root:saved.trials[j].resultRoot,bytes:saved.archives[j]});}
        const manifestRoot=hex(contentRoot(manifest));await this.publish({round:address,claim:saved.claim,root:manifestRoot,bytes:new Blob([canonical(manifest)])});
        saved.manifest=manifest;saved.manifestRoot=manifestRoot;saved.phase='published';await this.journal.put(key,saved);
        this.assertActive();await this.client.reveal(address,saved.claim,{input:inputIdentity(saved.input),salt:fromHex(saved.salt),manifest:fromHex(manifestRoot),result:contentRoot(saved.trials)});
        saved.phase='revealed';await this.journal.put(key,saved);
      }
      for(;;){
        this.assertActive();c=await reader.claim(saved.claim,address);
        if(c.state===STATES.ACCEPTED&&!waitForPayment){saved.phase='accepted-awaiting-payment';await this.journal.put(key,saved);this.state(saved.phase,{round:address,claim:saved.claim});return saved;}
        if([STATES.REJECTED,STATES.DUPLICATE,STATES.PAID].includes(c.state)){saved.phase=c.state===STATES.PAID?'paid':c.state===STATES.DUPLICATE?'duplicate':'rejected';await this.journal.put(key,saved);this.state(saved.phase,{round:address,claim:saved.claim,manifestRoot:saved.manifestRoot});return saved;}
        this.state(c.state===STATES.ACCEPTED?'accepted-awaiting-payment':'awaiting-node-verification',{round:address,claim:saved.claim});await this.wait(2000);
      }
    }finally{this.running=false;}
  }
}
