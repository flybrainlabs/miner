const messages={
 en:{title:'Automatic task supply',checking:'Checking the task pool…',inventory:'Funded tasks remaining: {remaining} · Open claim windows: {open}',ready:'Open tasks are available. Start mining to join.',standby:'Funded tasks remain. Start mining to check the contract and continue into an available task window.',empty:'No funded task is currently available. Waiting for calibrated and funded tasks.',budget:'New task rewards are fully allocated. Additional task creation needs the next finite reward authorization; existing funded tasks remain available.',preparing:'Automatic task supply is checking calibrated inventory and authorized rewards.',offline:'Task supply could not be checked. The previous sample is not a current availability result.',busy:'The task service is not ready. Waiting for recovery.',sample:'Checked at {time} UTC',scope:'Task windows open as needed. Only a verified contract task can authorize mining.'},
 zh:{title:'自动任务供给',checking:'正在检查任务池…',inventory:'剩余已资助任务：{remaining} 项 · 开放领取窗口：{open} 个',ready:'已有开放任务，点击开始挖矿即可参与。',standby:'仍有已资助任务。点击开始挖矿后会检查合约，并接续可用的任务窗口。',empty:'目前没有可用的已资助任务，正在等待完成校准和资助的新任务。',budget:'新增任务奖励额度已全部分配。继续创建新任务需要下一阶段有限奖励授权；现有已资助任务仍可接续。',preparing:'自动供给正在检查已校准库存及已授权奖励。',offline:'暂时无法核验任务供给，先前采样不能代表当前可用状态。',busy:'任务服务尚未就绪，正在等待恢复。',sample:'核验时间：{time} UTC',scope:'任务窗口按需开启。挖矿准入仍以已验证的合约任务为准。'},
 fr:{title:'Approvisionnement automatique en tâches',checking:'Vérification du pool de tâches…',inventory:'Tâches financées restantes : {remaining} · Fenêtres ouvertes : {open}',ready:'Des tâches sont ouvertes. Démarrez le minage pour participer.',standby:'Des tâches financées restent disponibles. Démarrez le minage pour vérifier le contrat et poursuivre dans une fenêtre disponible.',empty:'Aucune tâche financée n’est disponible actuellement. En attente de tâches calibrées et financées.',budget:'Les récompenses des nouvelles tâches sont entièrement attribuées. Leur création nécessite une nouvelle autorisation de récompenses limitée ; les tâches déjà financées restent disponibles.',preparing:'Le système vérifie le stock calibré et les récompenses autorisées.',offline:'Impossible de vérifier les tâches. Le relevé précédent ne représente pas la disponibilité actuelle.',busy:'Le service de tâches n’est pas prêt. En attente de rétablissement.',sample:'Vérifié à {time} UTC',scope:'Les fenêtres de tâches s’ouvrent selon la demande. Seule une tâche du contrat vérifiée autorise le minage.'},
 ru:{title:'Автоматическая подготовка заданий',checking:'Проверка пула заданий…',inventory:'Осталось оплаченных заданий: {remaining} · Открытых окон: {open}',ready:'Есть открытые задания. Запустите майнинг для участия.',standby:'Есть оплаченные задания. Запустите майнинг для проверки контракта и продолжения в доступном окне.',empty:'Сейчас нет доступных оплаченных заданий. Ожидание калибровки и финансирования новых заданий.',budget:'Награды новых заданий полностью распределены. Для создания новых заданий требуется следующее ограниченное разрешение на награды; уже оплаченные задания остаются доступными.',preparing:'Система проверяет откалиброванные задания и разрешённые награды.',offline:'Не удалось проверить задания. Предыдущий замер не отражает текущую доступность.',busy:'Сервис заданий не готов. Ожидание восстановления.',sample:'Проверено в {time} UTC',scope:'Окна заданий открываются по запросу. Майнинг допускается только по проверенному заданию контракта.'},
 ja:{title:'タスクの自動供給',checking:'タスクプールを確認中…',inventory:'資金確保済みの残りタスク：{remaining} · 受付中の枠：{open}',ready:'受付中のタスクがあります。マイニングを開始して参加できます。',standby:'資金確保済みのタスクがあります。開始するとコントラクトを確認し、利用可能な受付枠へ進みます。',empty:'現在利用できる資金確保済みタスクはありません。校正と資金確保が完了した新しいタスクを待っています。',budget:'新規タスクの報酬予算はすべて割り当て済みです。追加作成には次の有限報酬枠の承認が必要です。既存の資金確保済みタスクは引き続き利用できます。',preparing:'自動供給が校正済み在庫と承認済み報酬を確認しています。',offline:'タスク供給を確認できませんでした。前回の記録は現在の利用状況を示しません。',busy:'タスクサービスは準備中です。復旧を待っています。',sample:'確認時刻：{time} UTC',scope:'受付枠は需要に応じて開きます。検証済みコントラクトタスクのみがマイニングを許可します。'},
 ko:{title:'자동 작업 공급',checking:'작업 풀을 확인하는 중…',inventory:'보상 확보된 남은 작업: {remaining} · 열린 접수 창: {open}',ready:'열린 작업이 있습니다. 채굴을 시작하여 참여하세요.',standby:'보상 확보된 작업이 남아 있습니다. 채굴을 시작하면 계약을 확인하고 이용 가능한 작업 창으로 이어갑니다.',empty:'현재 이용 가능한 보상 확보 작업이 없습니다. 보정과 자금 확보가 끝난 새 작업을 기다립니다.',budget:'신규 작업 보상 한도가 모두 배정되었습니다. 추가 생성에는 다음 유한 보상 한도의 승인이 필요합니다. 기존에 보상 확보된 작업은 계속 이용할 수 있습니다.',preparing:'자동 공급이 보정된 작업 재고와 승인된 보상을 확인하고 있습니다.',offline:'작업 공급을 확인할 수 없습니다. 이전 기록은 현재 이용 가능 상태를 나타내지 않습니다.',busy:'작업 서비스가 준비되지 않았습니다. 복구를 기다립니다.',sample:'확인 시각: {time} UTC',scope:'작업 창은 수요에 따라 열립니다. 검증된 계약 작업만 채굴을 허용합니다.'}
};

export function taskSupplySampleV4(value,now=Date.now()){
 if(value?.schema!=='flybrainlabs-factory-health-v4'||!value.inventory||!Number.isSafeInteger(value.discoveryAgeMs)||value.discoveryAgeMs<0||value.discoveryAgeMs>60000)throw new Error('TASK_SUPPLY_STALE');
 const remaining=value.inventory.scheduledAndOpenTasks,open=value.inventory.actualOpen;
 if(![remaining,open].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000)||open>remaining)throw new Error('TASK_SUPPLY_INVALID');
 return {remaining,open,ready:value.businessReady===true,budgetExhausted:value.verifier?.supply?.code==='POOL_REWARD_AUTHORIZATION_EXHAUSTED',checkedAt:now};
}

// Health is informational. This component never grants a wallet capability,
// opens a task, accepts a catalog, signs a transaction or receives an RPC key.
export class TaskSupplyStatusV4 {
 constructor({apiBase,parent,document=globalThis.document,window=globalThis.window,fetch=globalThis.fetch,clock=()=>Date.now()}){
  Object.assign(this,{document,window,fetch,clock});const base=new URL(apiBase);
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname))||base.username||base.password||base.search||base.hash)throw new Error('TASK_SUPPLY_ORIGIN');
  this.url=new URL('/api/task-factory/v4/health',base.origin);this.root=document.createElement('section');this.root.id='miner-task-supply';this.root.className='miner-target-card';this.root.dataset.noI18n='';
  this.title=document.createElement('h3');this.inventory=document.createElement('p');this.state=document.createElement('p');this.budget=document.createElement('p');this.scope=document.createElement('p');this.sampleTime=document.createElement('p');this.sampleTime.className='muted';this.root.append(this.title,this.inventory,this.state,this.budget,this.scope,this.sampleTime);parent.append(this.root);
  this.language=()=>this.render();document.addEventListener('flypow:language',this.language);this.render();
 }
 async refresh(){
  if(this.pending||this.stopped)return;this.pending=true;const controller=new AbortController();this.controller=controller;const timeout=this.window.setTimeout(()=>controller.abort(),12000);
  try{const response=await this.fetch(this.url,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});if(!response.ok)throw new Error('TASK_SUPPLY_UNAVAILABLE');const text=await response.text();if(text.length>65536)throw new Error('TASK_SUPPLY_SIZE');const sample=taskSupplySampleV4(JSON.parse(text),this.clock());if(!this.stopped){this.sample=sample;this.failed=false;}}
  catch{if(!this.stopped)this.failed=true;}
  finally{this.window.clearTimeout(timeout);this.pending=false;this.controller=null;if(!this.stopped)this.render();}
 }
 start(){if(this.timer||this.stopped)return;this.refresh();this.timer=this.window.setInterval(()=>{this.render();this.refresh();},30000);}
 render(){
  const m=messages[this.window.FlyI18n?.language]||messages.en,s=this.sample,fresh=s&&!this.failed&&this.clock()-s.checkedAt<75000;
  this.title.textContent=m.title;this.scope.textContent=m.scope;this.root.dataset.state=fresh?(s.ready?s.open?'open':s.remaining?'standby':'empty':'unready'):this.failed||s?'unavailable':'checking';
  this.inventory.hidden=!fresh;this.budget.hidden=!fresh||!s?.budgetExhausted;
  if(fresh){this.inventory.textContent=m.inventory.replace('{remaining}',s.remaining).replace('{open}',s.open);this.state.textContent=!s.ready?m.busy:s.open?m.ready:s.remaining?m.standby:m.empty;this.budget.textContent=m.budget;}
  else this.state.textContent=this.failed||s?m.offline:m.checking;
  this.sampleTime.hidden=!s;if(s)this.sampleTime.textContent=m.sample.replace('{time}',new Date(s.checkedAt).toISOString().slice(11,19));
 }
 dispose(){this.stopped=true;this.controller?.abort();this.window.clearInterval(this.timer);this.document.removeEventListener('flypow:language',this.language);this.root.remove();}
}
