// In-memory OPFS contract for storage failure/restart tests. No scientific claim.
export class Directory {
  constructor(path='',fail=()=>false){this.path=path;this.fail=fail;this.items=new Map();this.kind='directory';}
  async getDirectoryHandle(name,{create=false}={}){let h=this.items.get(name);if(!h&&create){h=new Directory(this.path+'/'+name,this.fail);this.items.set(name,h);}if(!h)throw new DOMException('Missing directory','NotFoundError');if(h.kind!=='directory')throw new Error('Wrong kind');return h;}
  async getFileHandle(name,{create=false}={}){let h=this.items.get(name);if(!h&&create){const path=this.path+'/'+name,fail=this.fail;h={kind:'file',bytes:new Uint8Array(),getFile:async()=>new File([h.bytes],name),createWritable:async()=>{const chunks=[];return {write:async data=>{if(fail(path))throw new DOMException('Injected full disk','QuotaExceededError');chunks.push(data);},close:async()=>{h.bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());},abort:async()=>{}};}};this.items.set(name,h);}if(!h)throw new DOMException('Missing file','NotFoundError');return h;}
  async removeEntry(name){if(!this.items.delete(name))throw new DOMException('Missing entry','NotFoundError');}
  async *entries(){yield* this.items.entries();}
}
