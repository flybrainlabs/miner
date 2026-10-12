#!/usr/bin/env python3
"""Full MaleCNS browser -> real local SBF -> full replay -> TGE/claim.

The injected Wallet Standard wallet is TEST ONLY, backed by a localnet seed.
It uses Chromium WebCrypto Ed25519, not a mocked chain or signature. No key is
served by the website or written in the public report. An extension is untested.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.parse import urlsplit
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

WALLET = r"""
const secret=arguments[0],done=arguments[1];
(async()=>{
  const pkcs8=new Uint8Array([0x30,0x2e,2,1,0,0x30,5,6,3,0x2b,0x65,0x70,4,0x22,4,0x20,...secret.slice(0,32)]);
  const key=await crypto.subtle.importKey('pkcs8',pkcs8,{name:'Ed25519'},false,['sign']);
  const publicKey=new Uint8Array(secret.slice(32));
  const {pk}=await import('/assets/vendor/generated/solana-client.mjs');
  const account={address:pk(publicKey).toBase58(),publicKey,chains:['solana:localnet'],features:['solana:signTransaction','solana:signMessage']};
  window.testSignedTransactions=[];
  const wallet={version:'1.0.0',name:'FlyPoW localnet TEST wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',chains:['solana:localnet'],accounts:[account],features:{
    'standard:connect':{version:'1.0.0',connect:async()=>({accounts:[account]})},
    'standard:events':{version:'1.0.0',on:()=>()=>{}},
    'solana:signTransaction':{version:'1.0.0',supportedTransactionVersions:['legacy'],signTransaction:async(...inputs)=>Promise.all(inputs.map(async input=>{
      if(input.chain!=='solana:localnet'||input.account.address!==account.address)throw Error('TEST wallet only supports localnet');
      const tx=new Uint8Array(input.transaction);
      // These UI instructions have one required signer. Reject other formats.
      if(tx[0]!==1)throw Error('TEST wallet requires a single legacy signer');
      const signature=new Uint8Array(await crypto.subtle.sign('Ed25519',key,tx.slice(65)));
      tx.set(signature,1);window.testSignedTransactions.push(Array.from(tx));
      return {signedTransaction:tx};
    }))},
    'solana:signMessage':{version:'1.0.0',signMessage:async(...inputs)=>Promise.all(inputs.map(async input=>({signedMessage:input.message,signature:new Uint8Array(await crypto.subtle.sign('Ed25519',key,input.message))})))},
  }};
  window.addEventListener('wallet-standard:app-ready',({detail:api})=>api.register(wallet));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet',{detail:({register})=>register(wallet)}));
  window.dispatchEvent(new Event('focus'));return account.address;
})().then(done,e=>done({error:String(e)}));
"""

def main(args):
    if urlsplit(args.url).hostname not in {'127.0.0.1','localhost'}:
        raise ValueError('This test must run on loopback')
    private=args.campaign.resolve()
    config=json.loads((private/'public/chain-config.json').read_text())
    if config['network']!='localnet':raise ValueError('Test wallet must never use devnet/mainnet')
    report={'schema':'flypow-full-model-localnet-e2e-v1','campaign':config['campaign'],
            'wallet':'injected Wallet Standard TEST wallet; actual WebCrypto Ed25519 and localnet transactions',
            'checks':[]}
    if args.resume:
        report=json.loads(Path(args.report).read_text())
        if report.get('campaign')!=config['campaign'] or 'final_chain_state' not in report:
            raise ValueError('Resume requires this exact campaign with the recorded completed chain flow')
    with tempfile.TemporaryDirectory(prefix='flypow-chain-browser-',dir=Path(args.report).parent) as profile:
        options=webdriver.ChromeOptions();options.binary_location='/usr/bin/chromium'
        for flag in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--renderer-process-limit=2','--window-size=1440,1000','--user-data-dir='+profile]:options.add_argument(flag)
        options.set_capability('goog:loggingPrefs',{'browser':'ALL'})
        driver=webdriver.Chrome(options=options);driver.set_script_timeout(60);wait=WebDriverWait(driver,180)
        def click(id):
            wait.until(lambda d:d.find_element(By.ID,id).is_enabled())
            driver.execute_script('arguments[0].click()',driver.find_element(By.ID,id))
        def js(source):
            value=driver.execute_async_script("const done=arguments[0];(async()=>{"+source+"})().then(v=>done(JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x))),e=>done({error:String(e)}));")
            if isinstance(value,dict) and 'error' in value:raise AssertionError(value['error'])
            return value
        def connect():
            who=driver.execute_async_script(WALLET,json.loads(args.payer.read_text()))
            if isinstance(who,dict):raise AssertionError(who)
            click('research-connect')
            wait.until(lambda d:d.find_element(By.ID,'research-chain-quote').text)
            return who
        def chain_state():
            return js("const {CampaignClient,pk}=await import('/assets/vendor/generated/solana-client.mjs');const c=new CampaignClient(await(await fetch('/assets/data/chain-config.json')).json());const snap=await c.snapshot();return {state:snap.state.state,tge:snap.state.tge,epochs:snap.epochs,pages:snap.pages.map(p=>({complete:p.complete,archived:p.archived})),ent:snap.entitlements};")
        try:
            driver.get(args.url.rstrip('/')+'/mining/?view=tools')
            wait.until(lambda d:d.find_element(By.ID,'research-capabilities').text)
            who=connect()
            if args.resume:
                assert who==report['miner'], 'Resume wallet differs from the original contributor'
            report['miner']=who
            print('Wallet Standard connected to the real localnet',flush=True)
            if args.resume:
                current=chain_state()
                assert current['state']==2 and current['tge']
                assert all(p['complete'] and p['archived'] for p in current['pages'])
                assert all(e['closed'] and e['accepted'] and e['refundPaid'] for e in current['ent'])
                assert current==report['final_chain_state'], 'Terminal accounts changed since the recorded run'
                report['resume_after']='SUCCESS/TGE/claims/refund; recheck terminal accounts and public archive UI'
            else:
                report['funding_quote']=driver.find_element(By.ID,'research-chain-quote').text
                driver.find_element(By.ID,'research-graph').send_keys(str(args.graph.resolve()))
                driver.find_element(By.ID,'research-model').send_keys(str(args.model.resolve()))
                started=time.monotonic();click('research-prepare')
                wait.until(lambda d:d.find_element(By.ID,'research-tools-state').text in {'Full model ready','Preparation needs attention'})
                assert driver.find_element(By.ID,'research-tools-state').text=='Full model ready',driver.find_element(By.ID,'miner-error-detail').text
                report['prepare_seconds']=round(time.monotonic()-started,3)
                print('Full graph ready',report['prepare_seconds'],flush=True)
                started=time.monotonic();click('research-run')
                wait.until(lambda d:d.execute_script("return document.querySelector('.research-app').dataset.execution==='complete'"))
                click('miner-show-result')
                wait.until(lambda d:d.find_element(By.ID,'research-response').is_displayed())
                report['experiment_seconds']=round(time.monotonic()-started,3)
                driver.execute_script("document.getElementById('miner-result-details').open=true")
                report['result_root']=driver.find_element(By.ID,'research-result-hash').get_attribute('textContent').removeprefix('SHA-256 ')
                report['response_bytes']=driver.find_element(By.ID,'research-bytes').text
                print('Full WASM experiment root',report['result_root'],flush=True)
                report['checks'].append('actual full graph WASM A/B; local result does not count as chain contribution')
                driver.execute_script("document.querySelector('[data-miner-view=tools]').click()")
                click('research-commit');wait.until(lambda d:'COMMITTED' in d.find_element(By.ID,'research-submission-state').text)
                report['submission']=driver.find_element(By.ID,'research-submission').get_attribute('value')
                report['submission_data_len']=js("const {CampaignClient,pk}=await import('/assets/vendor/generated/solana-client.mjs');const c=new CampaignClient(await(await fetch('/assets/data/chain-config.json')).json());const a=await c.connection.getAccountInfo(pk(document.querySelector('#research-submission').value));return a.data.length;")
                assert report['submission_data_len']==1024
                # Wait actual confirmed slots rather than a blind reveal delay.
                js("const {CampaignClient,pk}=await import('/assets/vendor/generated/solana-client.mjs');const c=new CampaignClient(await(await fetch('/assets/data/chain-config.json')).json());await c.load();const s=await c.receipt(document.querySelector('#research-submission').value);while(BigInt(await c.connection.getSlot('confirmed'))<s.lifecycle.commitSlot+c.rules.min_reveal_slots)await new Promise(r=>setTimeout(r,200));return true;")
                click('research-reveal');wait.until(lambda d:'REVEALED' in d.find_element(By.ID,'research-submission-state').text)
                upload_started=time.monotonic();click('research-upload')
                wait.until(lambda d:'RUNNING' in d.find_element(By.ID,'research-chain-state').text)
                # Upload completion is also checked from actual sealed content, not UI text.
                sub=report['submission']
                roots=js("const {CampaignClient}=await import('/assets/vendor/generated/solana-client.mjs');const c=new CampaignClient(await(await fetch('/assets/data/chain-config.json')).json());await c.load();return (await c.receipt(document.querySelector('#research-submission').value)).hashes;")
                archive=args.archive.resolve()/roots['archiveManifestHash']
                wait.until(lambda _:archive.joinpath('sealed.json').is_file())
                report['archive_seconds']=round(time.monotonic()-upload_started,3)
                print('Sealed archive ready; starting two full replays',flush=True)
                for i in range(2):
                    command=['node','tools/verifier_node.mjs',str(private/'public/chain-config.json'),str(args.graph.resolve()),str(args.model.resolve()),str(private/'catalog.json'),sub,str(private/f'verifier-{i}.json'),str(archive),'--send']
                    if i==1:command.append('--numpy')
                    subprocess.run(command,check=True,timeout=240,stdout=subprocess.DEVNULL)
                    print('Full replay vote confirmed',i,flush=True)
                report['verifiers']=[json.loads(archive.joinpath(f'verifier-{i}-report.json').read_text()) for i in range(2)]
                click('research-chain-refresh');wait.until(lambda d:'VERIFIED' in d.find_element(By.ID,'research-submission-state').text)
                report['checks'].append('archive holds exact full response and preview; Rust and independent NumPy replay sign actual 2-of-3 votes')
                click('research-finalize');wait.until(lambda _:chain_state()['pages'][0]['complete'])
                click('research-close');wait.until(lambda d:'Closed' in d.find_element(By.ID,'research-submission-state').text)
                click('research-seal');wait.until(lambda _:chain_state()['epochs'][0]['sealed'])
                click('research-end');wait.until(lambda _:chain_state()['state']==2)
                click('research-tge');wait.until(lambda _:chain_state()['tge'])
                for pool in ['miner','v0','v1','community']:
                    driver.execute_script("arguments[0].value=arguments[1];arguments[0].dispatchEvent(new Event('change'))",driver.find_element(By.ID,'research-claim-pool'),pool)
                    click('research-claim');wait.until(lambda d:not d.find_element(By.ID,'research-claim').is_enabled())
                click('research-refund');wait.until(lambda d:not d.find_element(By.ID,'research-refund').is_enabled())
                report['final_chain_state']=chain_state()
                report['checks'].append('browser finalizes, closes exact 1024-byte receipt, seals, SUCCESS, single TGE, three pool claims and unused-advance refund')
                transactions=driver.execute_script('return window.testSignedTransactions')
                # Public transactions contain no private material. Gather real CU/fees.
                report['transactions']=js("const {CampaignClient,pk}=await import('/assets/vendor/generated/solana-client.mjs');const c=new CampaignClient(await(await fetch('/assets/data/chain-config.json')).json());await c.load();const ids=await c.connection.getSignaturesForAddress(c.campaign,{limit:100});const out=[];for(const row of ids){const tx=await c.connection.getTransaction(row.signature,{maxSupportedTransactionVersion:0});out.push({id:row.signature,err:row.err,fee:tx?.meta?.fee,compute_units:tx?.meta?.computeUnitsConsumed});}return out;")
                report['signed_browser_transaction_count']=len(transactions)
            driver.get(args.url.rstrip('/')+'/mining/?view=tools');wait.until(lambda d:d.find_elements(By.CSS_SELECTOR,'#research-history article'))
            assert not driver.find_element(By.ID,'research-run').is_enabled()
            driver.execute_script('arguments[0].click()',driver.find_element(By.CSS_SELECTOR,'#research-history article button'))
            wait.until(lambda d:d.find_element(By.ID,'research-response').is_displayed())
            assert report['result_root'] in driver.find_element(By.ID,'research-result-hash').get_attribute('textContent')
            report['checks'].append('after whole receipt close, public card rebuilt from permanent chain accounts and hash-verified lightweight archive without full graph')
            # A actual browser with WebGL contexts unavailable must retain the
            # identity-checked official SVG and spike table, not fabricate geometry.
            driver.execute_script("const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/.test(kind)?null:original.call(this,kind,...args)}")
            driver.execute_script('arguments[0].click()',driver.find_element(By.CSS_SELECTOR,'#research-history article button'))
            wait.until(lambda d:d.find_elements(By.CSS_SELECTOR,'#research-skeleton img'))
            assert '16789' in driver.find_element(By.ID,'research-skeleton-note').text
            report['checks'].append('no WebGL uses SHA-verified SVG of the actual target and retains recorded spike table')
            driver.set_window_size(390,844)
            assert driver.execute_script('return document.documentElement.scrollWidth<=innerWidth+1')
            driver.execute_script('window.scrollTo(0,0)')
            wait.until(lambda d:d.execute_script('return Math.abs(scrollY)<1'))
            driver.find_element(By.ID,'language-switch').click()
            wait.until(lambda d:d.execute_script("return document.documentElement.lang").startswith('zh'))
            report['checks'].append('390px mobile viewport and Chinese language switch remain usable')
            report['browser_errors']=[x['message'] for x in driver.get_log('browser') if x['level']=='SEVERE']
            # Three.js emits this expected error before the handled SVG fallback.
            unexpected=[s for s in report['browser_errors'] if 'Error creating WebGL context' not in s]
            assert not unexpected,unexpected
            report['checks']=list(dict.fromkeys(report['checks']))
        finally:
            try:
                try:
                    report['last_ui_state']={id:driver.find_element(By.ID,id).text for id in ['research-tools-state','research-chain-state','research-submission-state']}
                except Exception as error:
                    report['last_ui_error']=str(error)
                try:
                    report.setdefault('browser_errors',[x['message'] for x in driver.get_log('browser') if x['level']=='SEVERE'])
                except Exception:
                    pass
                Path(args.report).write_text(json.dumps(report,indent=2)+'\n')
            finally:
                driver.quit()
    print(json.dumps({k:v for k,v in report.items() if k not in {'final_chain_state','transactions'}},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',required=True)
    for name in ['campaign','archive','graph','model']:p.add_argument('--'+name,required=True,type=Path)
    p.add_argument('--resume',action='store_true',help='Recheck an already completed exact campaign and resume only the public archive/UI checks')
    p.add_argument('--payer',type=Path,default=Path('deploy/localnet/payer.json'))
    p.add_argument('--report',default='data/prepared/full-model-localnet-report.json')
    main(p.parse_args())
