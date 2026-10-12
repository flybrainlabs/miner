// User viewing intent survives system visibility/graphics pauses. Computation is separate.
export class ReplayController {
  constructor({onFrame=()=>{},onState=()=>{},request=fn=>requestAnimationFrame(fn),cancel=id=>cancelAnimationFrame(id),clock=()=>performance.now(),reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false}={}){
    Object.assign(this,{onFrame,onState,request,cancel,clock,reducedMotion});this.frameInterval=50;this.speed=1;this.mode='b';this.loop=false;this.playing=false;this.intent='paused';this.time=0;this.last=null;this.frameId=null;this.generation=0;this.waiting=false;this.blockers=new Set();this.lastTickAt=null;this.lastTraceAt=null;this.state='preparing';
  }
  load({steps,timeStepUs=1000,available=steps,live=false,identity=null,preserveIntent=false}){const intent=this.intent;this.pause({system:true});this.generation++;Object.assign(this,{steps,timeStepUs,available,live,identity,time:0,start:0,end:steps,last:null,lastDraw:null,intent:preserveIntent?intent:'paused'});this.setState(available?'paused':'preparing');this.emit();}
  get upper(){return Math.max(this.start,Math.min(this.end-1,(this.live?this.available:this.steps)-1));}
  setState(state){this.state=state;this.onState(state);}
  emit(){this.onFrame({time:this.time,step:Math.floor(this.time),modelTimeUs:this.time*this.timeStepUs,speed:this.speed,mode:this.mode,playing:this.playing,intent:this.intent,state:this.state,identity:this.identity,live:this.live,waiting:this.waiting,blockers:[...this.blockers]});}
  play({restart=false}={}){if(this.steps==null)return;this.intent='play';this.recoveryUsed=false;if(restart)this.time=this.start;if(this.blockers.size||this.reducedMotion()){this.setState(this.reducedMotion()?'reduced-motion':'invisible');this.emit();return;}this.cancelFrame();this.playing=true;this.last=null;this.lastDraw=null;this.waiting=this.live&&(!this.available||this.time>=this.upper);this.setState(this.waiting?'waiting':'playing');this.emit();if(!this.waiting)this.schedule();}
  cancelFrame(){this.generation++;if(this.frameId!==null)this.cancel(this.frameId);this.frameId=null;}
  schedule(){if(this.frameId!==null||!this.playing||this.waiting||this.blockers.size)return;const generation=this.generation;this.scheduledAt=this.clock();this.frameId=this.request(now=>{if(generation!==this.generation||!this.playing)return;this.frameId=null;this.tick(now);if(this.playing&&!this.waiting)this.schedule();});}
  recoverSchedule(ready,now=this.clock()){
    if(!ready||!this.playing||this.intent!=='play'||this.waiting||this.blockers.size||this.reducedMotion()||this.time>=this.upper||now-Math.max(this.scheduledAt||0,this.lastTickAt||0)<6000)return;
    if(this.recoveryUsed){this.pause({system:true,reason:'error'});return;}
    this.recoveryUsed=true;this.cancelFrame();this.last=null;this.setState('recovering');this.schedule();this.emit();
  }
  tick(now){
    if(!this.playing)return;this.lastTickAt=now;if(this.state==='recovering')this.setState('playing');
    if(this.last!==null){const elapsed=Math.max(0,now-this.last),dt=elapsed>2000?0:elapsed;this.time+=dt*this.speed/500;if(this.time>=this.upper){
      if(this.loop&&!this.live&&this.upper>this.start)this.time=this.start+(this.time-this.start)%(this.upper-this.start);
      else if(this.live){this.time=this.upper;this.waiting=true;this.setState('waiting');}
      else{this.time=this.upper;this.playing=false;this.cancelFrame();this.setState('ended');}
    }}this.last=now;
    if(this.lastDraw==null||now-this.lastDraw>=this.frameInterval||this.waiting||!this.playing){this.lastDraw=now;this.emit();}
  }
  pause({system=false,reason='paused'}={}){this.cancelFrame();if(!system)this.intent='paused';this.playing=false;this.waiting=false;this.last=null;this.setState(reason);if(this.steps!=null)this.emit();}
  suspend(reason){if(this.blockers.has(reason))return;this.blockers.add(reason);this.pause({system:true,reason});}
  resume(reason){if(!this.blockers.delete(reason))return;if(!this.blockers.size&&this.intent==='play')this.play();else if(this.steps!=null)this.emit();}
  seek(time){if(!Number.isFinite(Number(time)))return;this.time=Math.max(this.start,Math.min(this.upper,Number(time)));this.last=null;this.waiting=this.live&&this.time>=this.upper;if(this.intent==='play'&&!this.blockers.size&&!this.reducedMotion()){this.playing=true;this.setState(this.waiting?'waiting':'playing');if(!this.waiting)this.schedule();}this.emit();}
  setSpeed(speed){if(![.25,.5,1,2,4].includes(Number(speed)))throw new Error('Unknown playback speed');this.speed=Number(speed);this.emit();}
  stepForward(){this.pause();this.seek(Math.floor(this.time)+1);}
  stepBackward(){this.pause();this.seek(Math.ceil(this.time)-1);}
  setMode(mode){if(!['a','b','difference'].includes(mode))throw new Error('Unknown replay mode');this.mode=mode;this.emit();}
  setLoop(loop){this.loop=!!loop;}
  setWindow(start,end){if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>this.steps)throw new Error('Replay window outside recorded time');this.pause();this.start=start;this.end=end;this.seek(start);}
  setAvailable(steps){const previous=this.available;this.available=Math.max(this.available,Math.min(this.steps,steps));if(this.available===previous)return;this.lastTraceAt=performance.now();if(this.intent==='play'&&!this.blockers.size&&!this.reducedMotion()&&this.time<this.upper){if(!this.playing||this.waiting)this.last=null;this.playing=true;this.waiting=false;this.setState('playing');this.schedule();}}
  snapshot(){return {executionId:this.identity,viewCursor:this.time,availableSteps:this.available,intent:this.intent,state:this.state,waiting:this.waiting,blockers:[...this.blockers],generation:this.generation,lastTraceAt:this.lastTraceAt,lastTickAt:this.lastTickAt,scheduled:this.frameId!==null,schedulingRecoveryUsed:!!this.recoveryUsed};}
  dispose(){this.pause();this.steps=null;this.identity=null;this.blockers.clear();}
}
