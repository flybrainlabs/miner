// Intent is memory-only. Restoring storage never restores signing permission.
export class MiningSessionController {
  constructor({identity,prepareModel,prepareSession,dispatch,pause=()=>{},onState=()=>{},retryable=()=>false}) {
    Object.assign(this,{identity,prepareModel,prepareSession,dispatch,pause,onState,retryable});this.generation=0;this.intent=false;this.state='idle';
  }
  setState(state,error=null){this.state=state;this.error=error;this.onState({state,intent:this.intent,error});}
  start() {
    if(this.pending)return this.intent?this.pending:this.pending.then(()=>this.start());
    this.intent=true;const generation=++this.generation,identity=this.identity();
    const guard=()=>{if(!this.intent||generation!==this.generation||identity!==this.identity())throw Object.assign(new Error('Mining session stopped or identity changed'),{code:'MINING_SESSION_STOPPED'});};
    this.pending=(async()=>{
      let attempts=0;
      while(this.intent)try {
        guard();this.setState('preparing-model');
        // Session preparation here is read-only with respect to task windows.
        const prepared=await Promise.allSettled([this.prepareModel(guard),this.prepareSession({activate:false,guard})]);guard();for(const result of prepared)if(result.status==='rejected')throw result.reason;
        this.setState('preparing-session');await this.prepareSession({activate:true,guard});guard();
        await this.dispatch(guard);guard();this.setState('running');return;
      }catch(error){
        if(error.code==='MINING_SESSION_STOPPED'){if(this.intent&&generation===this.generation){this.intent=false;this.pause();this.setState('needs-user-action','MINING_IDENTITY_CHANGED');}return;}
        if(!this.retryable(error)){this.intent=false;this.pause();this.setState('needs-user-action',error.code||error.message);throw error;}
        this.setState('recovering-network',error.code||'NETWORK_RETRY');
        await new Promise(resolve=>{this.retryResolve=resolve;this.retryTimer=setTimeout(resolve,Math.min(60000,1000*2**Math.min(++attempts,6))+Math.random()*1000);});
        this.retryResolve=null;
      }
    })().finally(()=>{this.pending=null;});return this.pending;
  }
  cancel(reason='paused-by-user') {this.intent=false;this.generation++;clearTimeout(this.retryTimer);this.retryResolve?.();this.pause();this.setState(reason);}
}
