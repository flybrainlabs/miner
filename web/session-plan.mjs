// An explicit intent, independent of worker, wallet, simulation and replay time.
export class SessionPlan {
  constructor({config,count=1024,minutes=null,storageBytes=1024*1024*1024,mode='explore',clock=()=>performance.now(),persist=true}={}){
    if(!Number.isSafeInteger(count)||count<1||minutes!==null&&(!Number.isFinite(minutes)||minutes<=0||minutes>1440)||!Number.isSafeInteger(storageBytes)||storageBytes<1)throw new Error('Invalid session budget');
    Object.assign(this,{clock,persist,sessionId:crypto.randomUUID(),operationId:crypto.randomUUID(),campaign:config.campaign,profile:config.profile_id||'quick32',count,minutes,storageBytes,mode});
    this.generation=1;this.launchIntent=true;this.cancelled=false;this.awaitingFiles=false;this.activeSince=null;this.activeMs=0;this.completed=0;this.savedBytes=0;this.remember();
  }
  accepts(operationId,generation=this.generation){return !this.cancelled&&this.launchIntent&&operationId===this.operationId&&generation===this.generation;}
  invalidate(reason='paused'){this.launchIntent=false;this.reason=reason;this.generation++;this.suspend();this.remember();}
  cancel(reason='cancelled'){this.cancelled=true;this.invalidate(reason);}
  activate(){if(this.activeSince===null)this.activeSince=this.clock();}
  suspend(){if(this.activeSince!==null){this.activeMs+=Math.max(0,this.clock()-this.activeSince);this.activeSince=null;}}
  get elapsedMs(){return this.activeMs+(this.activeSince===null?0:Math.max(0,this.clock()-this.activeSince));}
  get limit(){return this.completed>=this.count?'task-limit':this.savedBytes>=this.storageBytes?'storage-limit':this.minutes!==null&&this.elapsedMs>=this.minutes*60000?'time-limit':null;}
  summary(){return {schema:'flypow-session-plan-v1',sessionId:this.sessionId,operationId:this.operationId,campaign:this.campaign,profile:this.profile,count:this.count,minutes:this.minutes,storageBytes:this.storageBytes,mode:this.mode,completed:this.completed,savedBytes:this.savedBytes,elapsedMs:this.elapsedMs,reason:this.reason||null,launchIntent:this.launchIntent&&!this.cancelled};}
  remember(){if(this.persist)try{localStorage.setItem('flypow-session-plan-v1',JSON.stringify({...this.summary(),launchIntent:false,note:'Stored data and explanation only; refresh never resumes simulation.'}));}catch{}}
  static restored(){try{return JSON.parse(localStorage.getItem('flypow-session-plan-v1')||'null');}catch{return null;}}
}
