// Existing v2 directories remain intact. Secrets are confined to this local store.
export class SubmissionStore {
  constructor(client,address){this.client=client;this.address=address;}
  async directory(create=false){const root=await navigator.storage.getDirectory(),d=await root.getDirectoryHandle('flypow-submissions-v2',{create});return d.getDirectoryHandle(this.client.campaign.toBase58()+'-'+this.address,{create});}
  async save(value){
    if(value.campaign!==this.client.campaign.toBase58()||value.miner!==this.address)throw new Error('Submission storage identity mismatch');
    const d=await this.directory(true),f=await d.getFileHandle(value.submission+'.json',{create:true}),w=await f.createWritable();try{await w.write(JSON.stringify(value));await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}
  }
  async saveFunds(value){
    if(value.schema!=='flypow-funds-v1'||value.campaign!==this.client.campaign.toBase58()||value.miner!==this.address||!['claim','refund'].includes(value.kind)||! /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.submission))throw new Error('Funds storage identity mismatch');
    const d=await this.directory(true),f=await d.getFileHandle('funds-'+value.submission+'-'+value.kind+'.json',{create:true}),w=await f.createWritable();
    try{await w.write(JSON.stringify(value));await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}
  }
  async listFunds(){
    let d;try{d=await this.directory();}catch{return [];}
    const out=[];for await(const [name,f]of d.entries())if(f.kind==='file'&&name.startsWith('funds-')&&name.endsWith('.json'))try{
      const file=await f.getFile();if(file.size>65536)continue;const p=JSON.parse(await file.text());
      if(p.schema==='flypow-funds-v1'&&p.campaign===this.client.campaign.toBase58()&&p.miner===this.address&&['claim','refund'].includes(p.kind)&&name==='funds-'+p.submission+'-'+p.kind+'.json'&&Array.isArray(p.transactions))out.push(p);
    }catch{}return out;
  }
  async list(){
    let d;try{d=await this.directory();}catch{return [];}
    const out=[];for await(const [name,f]of d.entries())if(f.kind==='file'&&name.endsWith('.json'))try{
      const file=await f.getFile();if(file.size>65536)continue;const p=JSON.parse(await file.text());
      if(p.campaign===this.client.config.campaign&&p.miner===this.address&&p.submission+'.json'===name&&/^[a-f0-9]{64}$/.test(p.taskId)&&/^[a-f0-9]{64}$/.test(p.resultRoot)&&Array.isArray(p.salt)&&p.salt.length===32&&p.salt.every(b=>Number.isInteger(b)&&b>=0&&b<256))out.push(p);
    }catch{}
    return out;
  }
}
