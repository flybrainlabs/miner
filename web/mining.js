"use strict";
(async()=>{
 await window.FlyI18n.ready;
 const $=id=>document.getElementById(id),t=s=>window.FlyI18n.t(s),W=window.FlyWallet;
 const api=window.FlySite.api,number=window.FlySite.format;
 let ready=false,active=sessionStorage.getItem("flypow-active-job"),saved=null,verifying=false,starting=false,latestStatus=null;
 const stages={waiting:"Waiting for official data",downloading:"Downloading official data",source_verifying:"Verifying source",converting:"Converting records",merkle:"Building data commitment",prepared:"Data prepared",loading:"Loading full data",partitioning:"Partitioning data",sketching:"Building connection sketches",indexing:"Building FlyHash index",index_loading:"Verifying stored index",index_saving:"Saving index",ready:"Full dataset ready",error:"Dataset preparation failed"};
 function notice(message=""){$("notice").textContent=message;}
 function buttons(){
  $("mine-button").disabled=!ready||!!active||starting;
  $("verify-button").disabled=!ready||verifying||!$("proof").value.trim();
  $("sample-button").disabled=!ready;$("restore-button").disabled=!saved;$("export-button").disabled=!$("proof").value.trim();
  $("cancel-button").hidden=!active;$("difficulty").disabled=$("mining-mode").value==="wallet";
 }
 function progress(el,n,total){if(total)el.value=Math.min(100,n/total*100);else el.removeAttribute("value");}
 async function status(){
  try{
   const value=await api("/api/status");latestStatus=value;ready=value.ready;window.FlySite.updateStatus(value);
   const p=value.progress;$("stage-title").textContent=t(stages[p.stage]||p.stage);$("stage-message").textContent=t(p.message);
   $("stage-percent").textContent=ready?"READY":p.total?(100*p.completed/p.total).toFixed(1)+"%":t("Working…");
   $("stage-dot").className="status-dot "+(ready?"ready":"");progress($("load-progress"),p.completed,p.total);
   if(value.data){const d=value.data;$("record-count").textContent=number(d.record_count);$("body-count").textContent=number(d.body_count);$("data-size").textContent=(d.canonical_bytes/1e9).toFixed(2)+" GB";$("dataset-root").textContent=d.dataset_root;$("artifact-root").textContent=d.artifact_root;$("source-hash").textContent=d.source_sha256;$("chunk-count").textContent=number(d.chunk_count)+" "+t("verified chunks");}
   $("mining-wallet-state").textContent=W.address?t("Mining wallet")+": "+W.short(W.address):t("Create or unlock a wallet to earn points and rewards.");
   if(!active&&$("job-label").dataset.waiting!=="done")$("job-label").textContent=t(ready?"Ready to compute":"Waiting for data");
  }catch{ready=false;window.FlySite.offline();}
  buttons();setTimeout(status,ready?5000:1500);
 }
 function activate(winners=[]){$("winner-count").textContent=winners.length+" / 2,000";window.FlySite.latestActivation=winners;document.dispatchEvent(new CustomEvent("flypow:activation",{detail:{winners}}));}
 function clear(title="Awaiting a proof",description="Verify roots, access trace, FlyHash outputs and the work hash."){
  $("verify-result").className="verification-result";$("verify-label").textContent=t(title);$("verify-description").textContent=t(description);$("verify-symbol").textContent="○";$("checks").replaceChildren();$("actual-hash-row").hidden=true;
 }
 function renderJob(job){
  const labels={running:"Reading synapses and searching nonces",found:"Valid work hash found",not_found:"No result in this attempt range",cancelled:"Computation stopped",timed_out:"The 30-second limit was reached",error:"Computation failed"};
  $("job-label").dataset.waiting="done";$("job-label").textContent=t(labels[job.status]||job.status);$("job-count").textContent=number(job.attempts)+" / "+number(job.max_attempts);
  $("job-time").textContent=(job.elapsed_ms/1000).toFixed(2)+" s";$("job-rate").textContent=number(Math.round(job.nonces_per_second))+" H/s";progress($("job-bar"),job.attempts,job.max_attempts);
  if(job.error)notice(t(job.error));
 }
 async function pollJob(){
  if(!active)return;
  try{const job=await api("/api/jobs/"+active);renderJob(job);
   if(job.status!=="running"){
    active=null;sessionStorage.removeItem("flypow-active-job");
    if(job.proof){saved=job.proof;$("proof").value=JSON.stringify(saved,null,2);activate(saved.winners);clear("Proof generated. Ready to verify.","Review the proof below, then recompute it.");
     if(saved.binding)notice(t("Wallet-bound proof submitted. Points update after validation; block rewards require quorum and the next settlement slot."));
    }buttons();return;
   }
  }catch(error){notice(t(error.message));active=null;sessionStorage.removeItem("flypow-active-job");buttons();return;}
  setTimeout(pollJob,300);
 }
 $("mine-form").onsubmit=async event=>{
  event.preventDefault();if(!ready||active||starting)return;starting=true;buttons();notice();
  try{
   let ticket;const message=$("message").value;
   if($("mining-mode").value==="wallet"){await W.register();const authorized=await W.action("mine",{message});ticket=authorized.result.ticket;$("difficulty").value=authorized.result.difficulty_bits;}
   const body={message,difficulty_bits:Number($("difficulty").value),max_attempts:Number($("attempts").value),start_nonce:$("nonce-start").value};
   if(ticket)body.ticket=ticket;
   const job=await api("/api/mine",body);active=job.id;sessionStorage.setItem("flypow-active-job",active);renderJob(job);pollJob();
  }catch(error){notice(t(error.message));}finally{starting=false;buttons();}
 };
 $("mining-mode").onchange=()=>{if($("mining-mode").value==="wallet")$("difficulty").value="8";buttons();};
 $("cancel-button").onclick=async()=>{if(active)try{await api("/api/jobs/"+active+"/cancel",{});}catch(error){notice(t(error.message));}};
 async function verifyCurrent(){
  if(!ready||verifying)return;verifying=true;buttons();$("verify-button").textContent=t("Recomputing…");
  try{
   const text=$("proof").value,proof=JSON.parse(text),result=await api("/api/verify",proof);
   if($("proof").value!==text){clear("Proof changed. Verify again.");return result;}
   $("verify-result").className="verification-result "+(result.valid?"valid":"invalid");$("verify-label").textContent=t(result.valid?"Verification passed":"Verification failed");$("verify-symbol").textContent=result.valid?"✓":"×";
   $("verify-description").textContent=result.checks.filter(c=>c.valid).length+" / "+result.checks.length+" "+t("checks passed")+" · "+result.elapsed_ms.toFixed(2)+" ms";
   $("checks").replaceChildren(...result.checks.map(check=>{const li=document.createElement("li");li.textContent=t(check.name);if(!check.valid)li.className="failed";return li;}));
   $("actual-hash-row").hidden=!result.actual_hash;$("actual-hash").textContent=result.actual_hash||"";if(result.valid)activate(proof.winners);return result;
  }catch(error){clear("Unable to verify this proof",error.message);notice(t(error.message));}finally{verifying=false;$("verify-button").textContent=t("Recompute proof →");buttons();}
 }
 $("verify-button").onclick=verifyCurrent;$("proof").oninput=()=>{clear("Proof changed. Verify again.");buttons();};
 $("restore-button").onclick=()=>{if(saved){$("proof").value=JSON.stringify(saved,null,2);activate(saved.winners);clear("Original proof restored.");buttons();}};
 $("export-button").onclick=()=>{try{const proof=JSON.parse($("proof").value);window.FlySite.downloadJSON(proof,"flypow-proof-"+String(proof.nonce).replace(/\D/g,"")+".json");}catch(error){notice(t(error.message));}};
 $("sample-form").onsubmit=async event=>{event.preventDefault();try{const row=await api("/api/synapses/"+encodeURIComponent($("record-index").value));$("sample-result").textContent="#"+row.index+"\n"+row.body_pre+" → "+row.body_post+"\nPre: "+row.pre.join(", ")+"\nPost: "+row.post.join(", ")+"\n8 nm voxel units";}catch(error){$("sample-result").textContent=t(error.message);}};
 const proofHash=new URLSearchParams(location.search).get("proof");
 if(proofHash&&/^[0-9a-f]{64}$/.test(proofHash)){api("/api/blocks/"+proofHash).then(result=>{saved=result.block.proof;$("proof").value=JSON.stringify(saved,null,2);activate(saved.winners);clear("Stored proof loaded.");buttons();}).catch(error=>notice(t(error.message)));}
 $("sample-result").textContent=t("Inspect any record after the dataset loads.");
 status();if(active)pollJob();
 document.addEventListener("flypow:language",()=>{buttons();if(!$("sample-result").textContent.startsWith("#"))$("sample-result").textContent=t("Inspect any record after the dataset loads.");});
 if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();const schema={type:"object",properties:{},additionalProperties:false};
  const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:"flypow_read_status",description:"Read the loaded dataset status.",inputSchema:schema,annotations:{readOnlyHint:true},execute(){return latestStatus;}});
  register({name:"flypow_verify_current_proof",description:"Recompute the proof currently in the visible editor.",inputSchema:schema,annotations:{readOnlyHint:false},execute:verifyCurrent});
  addEventListener("pagehide",()=>lifecycle.abort(),{once:true});
 }
})();
