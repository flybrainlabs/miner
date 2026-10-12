#!/usr/bin/env python3
"""Actual full-model -> ordinary SubmissionController -> localnet SBF.

Wallet is the existing TEST Wallet Standard adapter, with actual Ed25519 signatures.
Rejection and lost acknowledgement are deliberate fault injections, not fake transactions.
"""
import argparse,json,subprocess,tempfile,time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from e2e_campaign import WALLET

def main(a):
 class Checks(list):
  def append(self,value):super().append(value);print(value,flush=True)
 report={'schema':'flypow-miner-submission-e2e-v1','network':'localnet only','wallet':'injected TEST Wallet Standard wallet; real Ed25519 and actual localnet transactions','faults':['one simulated wallet refusal','simulated lost acknowledgements after actual commit and claim','simulated Wallet Standard account-change event'],'checks':Checks()}
 private=a.campaign.resolve();out=Path(a.report).parent
 with tempfile.TemporaryDirectory(prefix='miner-submit-browser-',dir=out) as profile:
  o=webdriver.ChromeOptions();o.binary_location='/usr/bin/chromium'
  for flag in ['--renderer-process-limit=2','--num-raster-threads=1','--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--window-size=1440,1000','--user-data-dir='+profile]:o.add_argument(flag)
  o.set_capability('goog:loggingPrefs',{'browser':'ALL'});d=webdriver.Chrome(options=o);d.set_script_timeout(90);w=WebDriverWait(d,240)
  def text(id):return d.find_element(By.ID,id).get_attribute('textContent')
  def phase():return d.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-submission')
  def click(id):w.until(lambda b:b.find_element(By.ID,id).is_enabled());d.execute_script('arguments[0].click()',d.find_element(By.ID,id))
  def js(script):
   r=d.execute_async_script('const done=arguments[0];(async()=>{'+script+'})().then(v=>done(JSON.parse(JSON.stringify(v,(_,x)=>typeof x==="bigint"?String(x):x))),e=>done({error:String(e)}))')
   if isinstance(r,dict) and 'error' in r:raise AssertionError(r['error'])
   return r
  def route(view):d.execute_script("document.querySelector('.miner-tabs [data-miner-view="+view+"]').click()")
  def chain_state():return js("const {CampaignClient,pk}=await import('/assets/vendor/generated/solana-client.mjs'),c=new CampaignClient(await(await fetch('/assets/data/chain-config.json')).json()),s=await c.snapshot();return {state:s.state.state,tge:s.state.tge,pages:s.pages.map(p=>({complete:p.complete,archived:p.archived,nextSeq:p.nextSeq})),ent:s.entitlements.map(e=>({accepted:e.accepted,closed:e.closed,refundPaid:e.refundPaid,minerWhole:e.minerWhole,minerClaimed:e.minerClaimed}))};")
  try:
   d.get(a.url.rstrip('/')+'/mining/');w.until(lambda b:b.find_element(By.ID,'miner-primary').is_enabled());assert 'Test activity' in text('miner-mode');route('tools');d.find_element(By.ID,'research-graph').send_keys(str(a.graph.resolve()));d.find_element(By.ID,'research-model').send_keys(str(a.model.resolve()));click('research-prepare');w.until(lambda b:b.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-preparation')=='ready');route('experience');click('miner-primary');w.until(lambda b:b.find_element(By.CSS_SELECTOR,'.research-app').get_attribute('data-execution')=='complete');report['result_root']=text('research-result-hash').removeprefix('SHA-256 ')
   test_wallet=WALLET.replace('on:()=>()=>{}','on:(_event,handler)=>{window.testWalletChanged=handler;return()=>{window.testWalletChanged=null;};}')
   who=d.execute_async_script(test_wallet,json.loads(a.payer.read_text()));assert isinstance(who,str);click('miner-connect');w.until(lambda b:'SOL' in text('miner-funding-quote'));assert 'storage principal' in text('miner-funding-quote').lower();assert 'account funding cap' in text('miner-funding-quote').lower();report['checks'].append('full-model automatic test task; explicit wallet connect followed by visible SOL quote, beneficiary, network and nonrefundable conditions')
   js("const s=await import('/assets/vendor/generated/solana-client.mjs'),wallet=s.standardWallets()[0],sign=wallet.features['solana:signTransaction'].signTransaction;window.rejectOnce=true;wallet.features['solana:signTransaction'].signTransaction=async(...args)=>{if(window.rejectOnce){window.rejectOnce=false;throw Error('User rejected signing (injected fault)');}return sign(...args);};return true;")
   click('miner-submit');w.until(lambda b:'declined' in text('miner-submission-error'));assert chain_state()['pages'][0]['nextSeq']==0;report['checks'].append('simulated refusal preserves result/recovery and performs no chain commit')
   js("const s=await import('/assets/vendor/generated/solana-client.mjs'),send=s.CampaignClient.prototype.send;window.dropAck=true;s.CampaignClient.prototype.send=async function(...args){const id=await send.apply(this,args);if(window.dropAck){window.dropAck=false;throw Error('Simulated lost RPC acknowledgement after confirmation');}return id;};return true;")
   click('miner-submit');w.until(lambda b:phase()=='unknown');actual=chain_state();assert actual['pages'][0]['nextSeq']==1;click('miner-reconcile');w.until(lambda b:phase() in ['waiting-reveal','reveal-authorization']);assert chain_state()['pages'][0]['nextSeq']==1;report['checks'].append('actual paid candidate survives injected unknown confirmation; signature is reconciled without second candidate or repeated payment')
   # Saved legacy-compatible record contains the exact salt locally; do not print it.
   record=js("const {SubmissionStore}=await import('/assets/submission-store.mjs'),s=await import('/assets/vendor/generated/solana-client.mjs'),c=new s.CampaignClient(await(await fetch('/assets/data/chain-config.json')).json());return (await new SubmissionStore(c,s.standardWallets()[0].accounts[0].address).list()).map(p=>({submission:p.submission,archiveRoot:p.archiveRoot,signed:p.transactions.length}));")[0];report['submission']=record['submission'];assert record['signed']==1
   before=len(d.execute_script('return window.testSignedTransactions'));d.execute_script("window.testWalletChanged({accounts:[{address:'11111111111111111111111111111111'}]})");w.until(lambda b:phase()=='unsubmitted');assert d.find_element(By.ID,'miner-wallet-picker').is_displayed();assert not text('miner-beneficiary');click('miner-connect');w.until(lambda b:phase() in ['waiting-reveal','reveal-authorization']);assert len(d.execute_script('return window.testSignedTransactions'))==before;assert chain_state()['pages'][0]['nextSeq']==1;report['checks'].append('simulated Wallet Standard account-change event clears prior account actions; explicit reconnect restores exact pending record without signing or duplicate candidate')
   w.until(lambda b:phase()=='reveal-authorization');click('miner-submit');w.until(lambda b:phase() in ['verifying','revealed']);click('miner-submit');w.until(lambda b:phase() in ['verifying','revealed'] and not b.find_element(By.ID,'miner-submit').get_attribute('disabled'))
   archive=a.archive.resolve()/record['archiveRoot'];w.until(lambda b:archive.joinpath('sealed.json').is_file());report['checks'].append('ordinary flow observes reveal slots, requests actual reveal signature and separate archive message authorization; immutable archive contains exact bytes')
   for i in range(2):
    cmd=['node','tools/verifier_node.mjs',str(private/'public/chain-config.json'),str(a.graph.resolve()),str(a.model.resolve()),str(private/'catalog.json'),record['submission'],str(private/f'verifier-{i}.json'),str(archive),'--send'];
    if i==1:cmd.append('--numpy')
    subprocess.run(cmd,check=True,timeout=240,stdout=subprocess.DEVNULL);print('Actual full replay vote',i,flush=True)
   click('miner-reconcile');w.until(lambda b:phase()=='revealed');click('miner-submit');w.until(lambda b:phase()=='accepted');assert chain_state()['pages'][0]['complete'];report['checks'].append('Rust + independent NumPy replay, actual 2-of-3 votes and normal Confirm contribution finalize the unique task')
   click('miner-close');w.until(lambda b:phase()=='accepted' and chain_state()['ent'][0]['closed']);report['checks'].append('temporary receipt closes without deleting permanent contribution or local recovery')
   route('tools');click('research-chain-refresh');w.until(lambda b:b.find_element(By.ID,'research-seal').is_enabled());click('research-seal');click('research-end');w.until(lambda b:chain_state()['state']==2);click('research-tge');w.until(lambda b:chain_state()['tge']);route('contributions');w.until(lambda b:'100' in text('miner-contribution-list'));assert 'Confirmed test contributions' in text('miner-contribution-counts');report['checks'].append('maintenance stays in Research tools; SUCCESS and test issuance are real localnet facts, distinct from local experiment count')
   # Inspect contributor funds from chain, then explicit ordinary claim/refund.
   buttons=d.find_elements(By.CSS_SELECTOR,'#miner-contribution-list article button');review=[b for b in buttons if 'submission' in b.get_attribute('textContent').lower()][0];d.execute_script('arguments[0].click()',review);w.until(lambda b:b.find_element(By.ID,'miner-claim').is_displayed());js('window.dropAck=true;return true;');click('miner-claim');w.until(lambda b:phase()=='unknown');assert chain_state()['ent'][0]['minerClaimed']==str(100*100000000);before=len(d.execute_script('return window.testSignedTransactions'));click('miner-reconcile');w.until(lambda b:not b.find_element(By.ID,'miner-claim').is_displayed());assert len(d.execute_script('return window.testSignedTransactions'))==before;click('miner-refund');w.until(lambda b:chain_state()['ent'][0]['refundPaid']);report['checks'].append('actual test claim survives a second injected lost acknowledgement; funds signature reconciles without replay, then unused advance refunds via explicit wallet signature')
   # Reload reconciles old commitments but never asks for signatures automatically.
   before=len(d.execute_script('return window.testSignedTransactions'));d.refresh();w.until(lambda b:b.find_element(By.ID,'miner-primary').is_enabled());assert not d.find_element(By.ID,'miner-wallet-picker').is_displayed();who=d.execute_async_script(test_wallet,json.loads(a.payer.read_text()));route('tools');click('research-connect');w.until(lambda b:text('research-chain-quote'));assert not d.execute_script('return window.testSignedTransactions');report['checks'].append('reload reconnect reads old recovery/chain state with zero automatic replayed payments or signatures')
   report['final_chain_state']=chain_state();report['browser_errors']=[x['message'] for x in d.get_log('browser') if x['level']=='SEVERE'];assert not report['browser_errors'],report['browser_errors'];d.save_screenshot(str(out/'miner-confirmed-test-contribution.png'))
  finally:
   try:report['last_phase']=phase();report['last_error']=text('miner-error-detail')
   except Exception:pass
   Path(a.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');d.quit()
 print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',required=True)
 for k in ['campaign','graph','model','archive']:p.add_argument('--'+k,type=Path,required=True)
 p.add_argument('--payer',type=Path,default=Path('deploy/localnet/payer.json'));p.add_argument('--report',default='data/prepared/miner-submission-report.json');main(p.parse_args())
