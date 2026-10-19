// UI state is separate from scientific data and chain settlement facts.
export const PREPARATION = ['checking','needed','files','fetching','checking-files','building','loading','ready','paused','space','unsupported','error'];
export const EXECUTION = ['idle','selecting','running','pausing','paused','resuming','saving','complete','empty','error'];
export const SUBMISSION = ['unsubmitted','signature','sending','unknown','committed','waiting-reveal','reveal-authorization','revealed','archiving','verifying','accepted','lost','rejected','timeout','refundable'];
export function createMinerState() {
  let state = { preparation:{phase:'checking'}, execution:{phase:'idle',task:null}, submission:{phase:'unsubmitted'}, view:'experience' };
  const listeners=new Set();
  return {
    get value(){return state;},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    update(section,patch){
      const phases={preparation:PREPARATION,execution:EXECUTION,submission:SUBMISSION};
      if(!phases[section] || (patch.phase && !phases[section].includes(patch.phase)))throw new Error('Invalid miner state');
      const resume=section==='preparation'&&patch.phase&&!['paused','space','unsupported','error'].includes(patch.phase)?{resumePhase:patch.phase}:{};
      state={...state,[section]:{...state[section],...resume,...patch}};for(const fn of listeners)fn(state);
    },
    view(view){state={...state,view:['experience','contributions','tools','settings'].includes(view)?view:'experience'};for(const fn of listeners)fn(state);}
  };
}
export class FlowError extends Error { constructor(code,detail=''){super(detail||code);this.code=code;} }
// The workbench, tools and settings use this same action policy.
export function deriveActions({ready=false,preparing=false,running=false,paused=false,initialised=true,unsupported=false,opfs=true,actionBusy=false}={}){
  const idle=!preparing&&!running&&!actionBusy;
  return Object.freeze({start:initialised&&!unsupported&&!preparing&&!actionBusy&&(!running||paused),prepare:idle,run:idle&&ready,import:idle,cache:idle&&ready&&opfs,clear:idle&&opfs,release:idle,pausePreparation:preparing,pauseTask:running&&!paused,stop:running});
}
export function errorCode(error) {
  if(typeof error.code==='string'&&Object.hasOwn(ERROR_TEXT,error.code))return error.code;
  const gatewayCodes={SESSION_REQUIRED:'wallet-login-required',SESSION_EXPIRED:'wallet-login-required',GRANT_EXPIRED:'funding-required',GRANT_REVOKED:'funding-required',GRANT_LIMIT:'funding-required',GRANT_UNAVAILABLE:'funding-required',ROUND_NOT_FUNDED:'funding-unavailable',MINING_PLAN_COMPLETE:'funding-unavailable',GATEWAY_RETRY:'network',RETRYABLE_INFRA_ERROR:'network',STALE_WALLET:'wallet',FUNDING_SCOPE_CHANGED:'wallet'};
  if(gatewayCodes[error.code])return gatewayCodes[error.code];
  if(['RPC_RATE_LIMITED','RPC_UNAVAILABLE','RPC_BUSY','RPC_UPSTREAM_REJECTED','RPC_INVALID_RESPONSE'].includes(error.code))return 'network';
  if(error.code==='WRONG_CHAIN')return 'version';
  if(error.code===4001)return 'signature-rejected';
  const s=String(error.message||error);
  if(error.name==='AbortError')return 'paused';
  if(/quota|storage|space|disk/i.test(s))return 'space';
  if(/another tab|another page|lock unavailable/i.test(s))return 'other-tab';
  if(/SHA|hash mismatch|damaged|length|ended early/i.test(s))return 'damaged';
  if(/catalog|version|identity|configuration|frozen/i.test(s))return 'version';
  if(/reject|declin|denied|4001/i.test(s))return 'signature-rejected';
  if(/wallet|account changed/i.test(s))return 'wallet';
  if(/archive/i.test(s))return 'archive';
  if(/CORS|fetch|network|RPC|timeout/i.test(s))return 'network';
  if(/memory|allocation/i.test(s))return 'memory';
  return 'operation';
}
export const ERROR_TEXT={
  'input-lease-lost':'The input assignment could not be renewed. Your saved backgrounds remain; continue to check the assignment again.',
  paused:'Paused. Checked input blocks and saved results remain. An interrupted experiment must start again.',
  space:'There is not enough browser storage. Saved results and submission recovery data are retained. Free space in Settings or continue on another device.',
  'other-tab':'Another page holds the model session. Browse results here, or finish, discard or close that session before starting here.',
  damaged:'A file or cache did not pass its integrity check. Saved results are retained. Import the affected official file again.',
  version:'These data do not match the current experiment. Previous results are retained. Prepare the current version or use Research tools to inspect the details.',
  'signature-rejected':'The wallet request was declined. Nothing is retried automatically. Reconcile the submission, then continue when you are ready.',
  wallet:'A compatible wallet is not connected or its account changed. Your work is retained. Choose a wallet to continue, or browse local results.',
  archive:'The archive service is unavailable. Your exact result is retained. Retry before the deadline or export your result.',
  network:'The network request did not complete. Checked data and results are retained. Check your connection and retry; unknown transactions are reconciled first.',
  memory:'The device could not allocate the complete model. Saved work is retained. Close other applications or continue on a device with more memory.',
  resource:'The scientific archive or resource budget was reached. No scientific events were truncated. Choose another published profile or a device with more resources.',
  operation:'This step could not finish. Saved work is retained. Retry or open diagnostics for the details.',
  'wallet-login-required':'Your wallet login expired or is missing. Sign in again; the prepared model and saved results remain.',
  'funding-check-required':'Check wallet balances and rent authorization before starting. No computation has started.',
  'funding-required':'The task is open, but this wallet has no usable rent authorization. Review a finite rent grant to start; the prepared model remains.',
  'funding-insufficient':'The rent authorization cannot cover this result. Review its remaining credit and per-result limit, then explicitly renew it.',
  'funding-device-required':'This device has no signing key for the selected rent grant. Explicitly renew the grant on this device; your saved work remains.',
  'funding-unavailable':'This task has no usable frozen reward budget. Check for a funded task; your prepared model and results remain.',
  unsupported:'This browser lacks a required capability. You can still browse the atlas and saved results. Use a browser with Workers, WASM, streaming files and Web Locks.',
  'no-opfs':'This browser cannot store the official inputs. You can still browse results or import the exact prepared model in Research tools on a supported device.',
  'activity-ended':'This test activity is not accepting tasks. Existing submissions and eligible funds can still be reviewed in My contributions.',
  'services':'This test activity has no configured archive or verifier service. New tasks are paused; existing results remain available.',
  'pending-limit':'Handle the pending submission or wait for verification before computing more tasks.',
  'fee-limit':'The next submission exceeds your session funding limit. No payment has been made. Adjust the limit explicitly to continue.',
  'queue-full':'The eligible task queues are full. No reservation or reward is guaranteed. Try again after existing candidates finish.',
  'catalog-complete':'All available tasks in this catalog have been completed. Your recorded results remain available.',
  'hidden':'New tasks are paused while this page is hidden. When you return, task and activity status are checked before you continue.',
  'run-limit':'The session task or time limit was reached. The model remains loaded; choose Continue to start another bounded session.'
};

// Local, opt-out diagnostics. No addresses, filenames, salts, results or network requests.
export class FlowEvents {
  constructor(context={}){
    this.context=context;this.started=performance.now();this.session=crypto.randomUUID();this.seen=new Set();this.stages=new Map();
    try{this.enabled=localStorage.getItem('flypow-flow-events')!=='off';}catch{this.enabled=false;}
    this.rows=[];try{this.rows=JSON.parse(localStorage.getItem('flypow-flow-events-v1')||'[]').slice(-200);}catch{}
  }
  emit(stage,outcome='start',code='none'){
    if(!this.enabled)return;
    const key=stage+':'+outcome;if(this.seen.has(key))return;this.seen.add(key);
    const now=performance.now();if(outcome==='start')this.stages.set(stage,now);
    const row={session:this.session,stage,outcome,code,elapsed_ms:Math.round(now-this.started),stage_ms:this.stages.has(stage)?Math.round(now-this.stages.get(stage)):null,mode:this.context.mode||'experience',returning:!!this.context.returning,cache:!!this.context.cache};
    this.rows.push(row);this.rows=this.rows.slice(-200);try{localStorage.setItem('flypow-flow-events-v1',JSON.stringify(this.rows));}catch{}
  }
  setEnabled(enabled){this.enabled=enabled;try{localStorage.setItem('flypow-flow-events',enabled?'on':'off');if(!enabled){this.rows=[];localStorage.removeItem('flypow-flow-events-v1');}}catch{}}
  summary(){
    const groups={};for(const r of this.rows){const key=[r.mode,r.returning?'returning':'new',r.cache?'cache':'cold'].join('/');const g=groups[key]??={};const s=g[r.stage]??={started:0,completed:0,failed:0};if(r.outcome==='start')s.started++;if(r.outcome==='complete')s.completed++;if(r.outcome==='failure')s.failed++;}
    return {scope:'local browser only; session durations, not cross-session preparation time',denominators:'Each stage: distinct session starts; completion requires the actual operation, not its button click.',groups,events:this.rows.map(r=>({...r}))};
  }
}
