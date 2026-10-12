export const MINING_PROFILE_ID='duration256-v1-dev';
import { checkCatalog } from './catalog-task.mjs';
import { digest } from './response-record.mjs';
export class ResearchProfiles {
  constructor(index){if(index.schema!=='flypow-research-profiles-v1')throw new Error('Unknown profiles index');this.index=index;this.cache=new Map();}
  static async load(){const r=await fetch('/assets/data/research-profiles.json',{cache:'no-store'});if(!r.ok)throw new Error('Profiles index unavailable');return new ResearchProfiles(await r.json());}
  async mining(){const p=await this.get(MINING_PROFILE_ID);if(!p.entry.enabled||p.config.profile_id!==MINING_PROFILE_ID)throw new Error('Fixed mining profile unavailable or disabled');return p;}
  async get(id){
    if(this.cache.has(id))return this.cache.get(id);
    const entry=this.index.profiles.find(p=>p.id===id);if(!entry)throw new Error('Unknown published profile');
    const r=await fetch(entry.config_path,{cache:'no-store'});if(!r.ok)throw new Error('Profile unavailable');const bytes=await r.arrayBuffer();if(await digest(bytes)!==entry.config_sha256)throw new Error('Profile config hash mismatch');const config=JSON.parse(new TextDecoder().decode(bytes));
    const c=await fetch(entry.catalog_path,{cache:'no-store'});if(!c.ok)throw new Error('Catalog unavailable');const catalog=await checkCatalog(new Uint8Array(await c.arrayBuffer()),config),profile={entry,config,catalog};this.cache.set(id,profile);return profile;
  }
}
