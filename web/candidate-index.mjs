// A derived OPFS index. Original candidate directories remain authoritative.
// A write-ahead marker bridges state.json, shard and head commits across crashes.
const enc=new TextEncoder();
async function read(dir,name){const file=await(await dir.getFileHandle(name)).getFile();if(file.size>8*1024*1024)throw new Error('Candidate index page bound');return JSON.parse(await file.text());}
async function put(dir,name,value){const h=await dir.getFileHandle(name,{create:true}),w=await h.createWritable();try{await w.write(enc.encode(JSON.stringify(value)));await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
const summary=m=>({id:m.candidateId,at:m.savedAt||m.createdAt||0,bytes:m.trials.reduce((n,t)=>n+(t.bytes||0),0),active:!!(m.partial||m.sciencePassed&&!m.rewardPaid&&(!m.terminalCompetition||m.won))});
export class CandidateIndex {
  constructor(store){this.store=store;this.cache=new Map();this.pages=new Map();}
  async lock(fn){await this.store.directory();const name='flybrain-candidate-index:'+this.store.name;return navigator.locks?.request?navigator.locks.request(name,{},fn):fn();}
  async directory(){return(await this.store.directory()).getDirectoryHandle('index-v1',{create:true});}
  async head(dir){try{const h=await read(dir,'head.json');if(h.version!==1||!h.pages||typeof h.pages!=='object')throw new Error('Candidate index version');return h;}catch(e){if(e.name!=='NotFoundError')throw e;return null;}}
  async ensure(dir){
    let head=await this.head(dir);
    if(!head){
      head={version:1,revision:0,pages:{}};const shards=new Map();
      for await(const [id,h]of(await this.store.directory()).entries())if(h.kind==='directory'&&/^[a-f0-9]{64}$/.test(id)){
        try{const row=summary(await this.store.metadata(id)),key=id.slice(0,2);if(!shards.has(key))shards.set(key,{});shards.get(key)[id]=row;}catch(error){if(error.name!=='NotFoundError')throw error;}
      }
      for(const [key,rows]of shards){await put(dir,key+'.json',rows);head.pages[key]=1;}await put(dir,'head.json',head);
    }
    // Only interrupted mutations are inspected. Ordinary refresh never scans all
    // candidate metadata or response.bin files again.
    for await(const [name,h]of dir.entries())if(h.kind==='file'&&/^pending-[a-f0-9]{64}$/.test(name)){
      const id=name.slice(8);try{head=await this.record(dir,head,await this.store.metadata(id));}catch(error){if(error.name!=='NotFoundError')throw error;}await dir.removeEntry(name);
    }
    return head;
  }
  async record(dir,head,meta){const key=meta.candidateId.slice(0,2);let rows={};try{rows=await read(dir,key+'.json');}catch(e){if(e.name!=='NotFoundError')throw e;}rows[meta.candidateId]=summary(meta);await put(dir,key+'.json',rows);head={...head,revision:head.revision+1,pages:{...head.pages,[key]:(head.pages[key]||0)+1}};await put(dir,'head.json',head);return head;}
  async mutate(meta,write){return this.lock(async()=>{const dir=await this.directory(),head=await this.ensure(dir),marker='pending-'+meta.candidateId;await put(dir,marker,{id:meta.candidateId});await write();await this.record(dir,head,meta);await dir.removeEntry(marker);return meta;});}
  async rows(){return this.lock(async()=>{const dir=await this.directory(),head=await this.ensure(dir);for(const [key,revision]of Object.entries(head.pages)){if(this.pages.get(key)===revision)continue;const rows=await read(dir,key+'.json');for(const [id,row]of Object.entries(rows)){if(!/^[a-f0-9]{64}$/.test(id)||row.id!==id)throw new Error('Candidate index identity');this.cache.set(id,row);}this.pages.set(key,revision);}return [...this.cache.values()].sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id));});}
  async select({limit=100,offset=0,activeOnly=false,includeActive=true}={}){if(!Number.isSafeInteger(limit)||limit<1||limit>1000||!Number.isSafeInteger(offset)||offset<0)throw new Error('Candidate history page bound');const all=await this.rows(),page=(activeOnly?all.filter(r=>r.active):all).slice(offset,offset+limit),selected=includeActive&&!activeOnly?[...new Map([...page,...all.filter(r=>r.active)].map(r=>[r.id,r])).values()]:page;return {ids:selected.map(r=>r.id),total:all.length,bytes:all.reduce((n,r)=>n+r.bytes,0),active:all.filter(r=>r.active).length,activeBytes:all.filter(r=>r.active).reduce((n,r)=>n+r.bytes,0),nextOffset:offset+limit<(activeOnly?all.filter(r=>r.active).length:all.length)?offset+limit:null};}
}
