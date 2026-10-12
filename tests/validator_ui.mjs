import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

class Element {
  constructor() { this.children=[]; this.dataset={}; this.textContent=""; this.disabled=false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children=[...children]; }
}
const elements=new Map(),events=new Map();
const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
let language="en",tick,resolveCheck,verificationCalls=0,attestations=0;
const task={hash:"a".repeat(64),votes:0,quorum:2,voted:false};
const account={exists:true,validator_active:true,stake_atoms:"1000000000000",assignments:[task]};
const wallet={address:"fly1"+"1".repeat(40),short:s=>s.slice(0,8),amount:s=>s||"0",
  account:async()=>JSON.parse(JSON.stringify(account)),register:async()=>{},
  action:async(name,payload)=>{
    assert.equal(name,"attest");assert.equal(payload.candidate,task.hash);assert.equal(payload.work_hash,task.hash);
    attestations++;task.voted=true;
  }
};
const context={console,BigInt,Map,Set,Promise,document:{body:{dataset:{page:"validators"}},hidden:false,
  getElementById:get,createElement:()=>new Element(),addEventListener:(name,fn)=>events.set(name,fn)},
  setInterval:fn=>{tick=fn;},window:{FlyWallet:wallet,FlyI18n:{ready:Promise.resolve(),
    get language(){return language;},t:s=>language==="zh"?"zh:"+s:s},
    FlySite:{format:String,api:async(path)=>{
      if(path==="/api/network")return {server_time:1000};
      if(path==="/api/network/validators")return {validators:[]};
      assert.equal(path,"/api/network/candidates/"+task.hash+"/verify");verificationCalls++;
      return new Promise(resolve=>{resolveCheck=resolve;});
    }}}};
vm.createContext(context);
await vm.runInContext(fs.readFileSync("web/network-ui.js","utf8"),context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const article=get("validator-tasks").children[0];
const [run,sign]=article.children[3].children;
assert.equal(sign.disabled,true);
const recompute=run.onclick();
tick();await flush();
assert.equal(get("validator-tasks").children[0],article);
assert.equal(run.disabled,true);
assert.equal(verificationCalls,1);
resolveCheck({valid:true,actual_hash:task.hash,checks:[true,true],elapsed_ms:1.5});
await recompute;
assert.equal(sign.disabled,false);
assert.match(article.children[2].textContent,/Computation verified/);
task.votes=1;tick();await flush();
assert.equal(get("validator-tasks").children[0],article);
assert.equal(article.children[1].textContent,"Votes: 1 / 2");
assert.equal(sign.disabled,false);
language="zh";events.get("flypow:language")();await flush();
assert.equal(get("validator-tasks").children[0],article);
assert.match(article.children[2].textContent,/zh:Computation verified/);
assert.equal(sign.disabled,false);
await sign.onclick();assert.equal(attestations,1);assert.equal(sign.disabled,true);
await sign.onclick();assert.equal(attestations,1);
account.assignments=[];tick();await flush();
assert.equal(get("validator-tasks").children.length,0);
assert.equal(get("validator-task-empty").hidden,false);
wallet.address="fly1"+"2".repeat(40);task.voted=false;account.assignments=[task];
events.get("flypow:wallet")();await flush();
const changed=get("validator-tasks").children[0];
assert.notEqual(changed,article);assert.equal(changed.children[3].children[1].disabled,true);
console.log("Validator refresh, pending recomputation, language switch and attestation state tests passed.");
