#!/usr/bin/env python3
"""Mining presentation in Chromium; optional isolated preparation event wiring."""
import argparse
import json
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from mining_session import FIXTURE


def main(a):
    options=webdriver.ChromeOptions();options.binary_location='/usr/bin/chromium';options.page_load_strategy='eager'
    for flag in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']:
        options.add_argument(flag)
    driver=webdriver.Chrome(options=options);driver.set_script_timeout(45);wait=WebDriverWait(driver,45);checks=[]
    a.report.parent.mkdir(parents=True,exist_ok=True)
    if a.exercise_preparation:
        assert a.site.startswith('http://127.0.0.1:'),'Preparation fixtures run only on loopback'
        driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':FIXTURE})
    def js(code,*args):return driver.execute_script(code,*args)
    def settle():driver.execute_async_script('const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)))')
    def run(code):
        value=driver.execute_async_script('const done=arguments[0];(async()=>{'+code+'})().then(v=>done({ok:true,value:v}),e=>done({ok:false,error:e.message}));')
        assert value['ok'],value;return value.get('value')
    def check(name,value):assert value,name;checks.append(name)
    try:
        driver.set_window_size(1440,1000);driver.get(a.site.rstrip('/')+'/mining/')
        wait.until(lambda _:js('return !!globalThis.flypowWorkspace'))
        js("FlyI18n.setLanguage('en');document.documentElement.style.setProperty('scroll-behavior','auto','important')")
        wait.until(lambda _:js("return document.getElementById('miner-log-backdrop').dataset.entries>0"))
        check('real initial preparation state supplies the visible backdrop',js("return document.querySelector('.mining-log-line').textContent.includes('Preparation') && document.getElementById('miner-log-backdrop').getAttribute('aria-hidden')==='true'"))
        for width,height in [(320,660),(390,844),(768,1024),(1440,1000),(1440,740)]:
            driver.set_window_size(width,height)
            for language in ['en','zh']:
                js('FlyI18n.setLanguage(arguments[0])',language)
                settle()
                check('layout without horizontal overflow '+str(width)+' '+str(height)+' '+language,js('return document.documentElement.scrollWidth<=innerWidth+1'))
                if width==1440:
                    layout=js("const a=document.querySelector('.miner-primary-panel').getBoundingClientRect(),b=document.getElementById('research-response').getBoundingClientRect();return {left:a.width,right:b.width,gap:b.left-a.right,viewport:innerWidth}")
                    check('two equally sized workspace columns '+str(height)+' '+language+' '+json.dumps(layout),abs(layout['left']-layout['right'])<2 and 10<=layout['gap']<32)
        driver.set_window_size(1440,1000);js("FlyI18n.setLanguage('en')")
        if a.exercise_preparation:
            run("await flybrainlabsWallet.connect(flybrainlabsWallet.availableWallets()[0]);flybrainlabsWallet.login={wallet:flybrainlabsWallet.account.address,expiresAt:Date.now()/1000+3600,token:'fixture-session',csrfToken:'fixture-csrf'};await flybrainlabsWallet.refresh();")
            run("""const {PreparationController}=await import('/assets/preparation-controller.mjs?v=mining-product-20261011-r7');
                PreparationController.prototype.start=function(){globalThis.fixturePreparationStarts=(globalThis.fixturePreparationStarts||0)+1;globalThis.fixturePrep=this;this.busy=true;this.state.update('preparation',{phase:'fetching',progress:{done:25,total:100}});return new Promise(resolve=>globalThis.fixturePrepResolve=resolve);};
                PreparationController.prototype.pause=function(){globalThis.fixturePreparationPauses=(globalThis.fixturePreparationPauses||0)+1;this.busy=false;this.state.update('preparation',{phase:'paused',progress:null,error:{code:'paused'}});globalThis.fixturePrepResolve(false);};""")
            wait.until(lambda _:not driver.find_element(By.ID,'miner-primary').get_attribute('disabled'))
            driver.find_element(By.ID,'miner-primary').click()
            wait.until(lambda _:js("return document.getElementById('miner-primary').getAttribute('aria-busy')==='true'"))
            check('real primary event wiring becomes disabled and displays a spinner',js("const b=document.getElementById('miner-primary');return b.disabled&&getComputedStyle(b.querySelector('.mining-button-spinner')).animationName==='mining-spinner'&&flypowWorkspace.snapshot().preparationBusy"))
            js("document.getElementById('miner-primary').click();document.getElementById('miner-primary').dispatchEvent(new MouseEvent('click'))")
            check('a second click neither starts again nor pauses preparation',js('return fixturePreparationStarts===1 && !globalThis.fixturePreparationPauses'))
            check('animated fill preserves the actual numerical value',js("const p=document.getElementById('research-progress'),fill=p.parentElement.querySelector('.mining-progress-fill');return p.value===25&&p.max===100&&fill.style.width==='25%'&&getComputedStyle(fill).animationName==='mining-progress-flow'"))
            driver.save_screenshot(str(a.report.with_name(a.report.stem+'-preparing.png')))
            driver.find_element(By.ID,'miner-prepare-pause').click()
            wait.until(lambda _:js("return !flypowWorkspace.snapshot().preparationBusy && document.getElementById('miner-primary').getAttribute('aria-busy')==='false'"))
            check('separate explicit pause works while the primary action is locked',js('return fixturePreparationPauses===1 && !flypowWorkspace.snapshot().running'))
            run("""const {MiningLogBackdrop}=await import('/assets/mining-presentation.mjs?v=mining-depth-20261014-v2'),host=document.getElementById('miner-log-backdrop'),fixtureHost=document.createElement('div');globalThis.fixtureBackdrop=new MiningLogBackdrop(fixtureHost,{t:(s,v)=>FlyI18n.t(s,v)});
                fixtureBackdrop.update({preparation:'ready',phaseLabel:FlyI18n.t('Full model ready'),logRows:Array.from({length:18},(_,i)=>({event:'progress',sessionElapsedMs:i*1000,telemetry:{stage:'simulation',completedSteps:i,totalSteps:256,neuronUpdates:330244*i,synapseTransmissions:10000*i}})),candidates:[{candidateId:'a'.repeat(64),round:{pre:{roundSequence:32}},sciencePassed:true,searchComplete:true},{candidateId:'b'.repeat(64),round:{pre:{roundSequence:31}},won:true}]});""")
            js("document.getElementById('miner-log-backdrop').replaceChildren(fixtureBackdrop.track)")
            check('qualification and confirmed winning records receive bold weight',js("const lines=[...document.querySelectorAll('#miner-log-backdrop strong')];return lines.length===4&&lines.every(e=>Number(getComputedStyle(e).fontWeight)>=700)&&lines.some(e=>e.textContent.includes('awaiting verification'))&&lines.some(e=>e.textContent.includes('won'))"))
            check('backdrop scrolls behind the transparent anatomy layer without intercepting input',js("return getComputedStyle(document.querySelector('.mining-log-track')).animationName==='mining-log-scroll'&&getComputedStyle(document.getElementById('miner-log-backdrop')).pointerEvents==='none'&&Number(getComputedStyle(document.getElementById('anatomy-stage')).zIndex)>Number(getComputedStyle(document.getElementById('miner-log-backdrop')).zIndex)"))
        js("if(!document.getElementById('miner-graphics').checked)document.getElementById('miner-graphics').click()")
        driver.set_window_size(1440,1000);js("document.getElementById('research-response').scrollIntoView({block:'start',behavior:'instant'})")
        wait.until(lambda _:js("return flypowWorkspace.snapshot().anatomy.mode==='3d'"))
        wait.until(lambda _:js("return document.getElementById('miner-log-backdrop').dataset.foreground==='anatomy'"))
        check('anatomical renderer retains whole CNS and alpha transparency',js("const c=document.querySelector('#anatomy-stage canvas'),gl=c.getContext(c.dataset.renderer==='webgl1'?'webgl':'webgl2');return gl.getContextAttributes().alpha&&document.getElementById('anatomy-stage').dataset.framing==='whole-cns'"))
        for key in ['ArrowLeft','ArrowUp','+','-']:
            pixels=js("""const host=document.getElementById('anatomy-stage');host.dispatchEvent(new KeyboardEvent('keydown',{key:arguments[0],bubbles:true}));const c=host.querySelector('canvas'),gl=c.getContext(c.dataset.renderer==='webgl1'?'webgl':'webgl2'),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,p=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);let opaque=0,clear=0,bright=0,lower=0;for(let i=0;i<p.length;i+=4){if(p[i+3]===255){opaque++;if(i/(w*4)<h*.45)lower++;}if(!p[i+3])clear++;if(p[i]>55&&p[i+3]>0)bright++;}return {total:w*h,opaque,clear,bright,lower};""",key)
            check('brain surfaces block background characters while keeping anatomy and surrounding logs '+key,pixels['opaque']>pixels['total']*.03 and pixels['clear']>pixels['total']*.2 and pixels['bright']>50 and pixels['lower']>50)
        js("document.getElementById('anatomy-reset').click()")
        driver.save_screenshot(str(a.report.with_name(a.report.stem+'-brain-desktop.png')))
        driver.set_window_size(390,844);driver.save_screenshot(str(a.report.with_name(a.report.stem+'-brain-mobile.png')))
        driver.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
        check('reduced motion removes decorative scrolling',js("return getComputedStyle(document.querySelector('.mining-log-track')).animationName==='none'"))
        driver.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[]})
        js("document.getElementById('miner-graphics').click()")
        wait.until(lambda _:js("return document.getElementById('miner-log-backdrop').hidden"))
        check('graphics off also removes the backdrop',True)
        check('no model execution or automatic funding',js('return !flypowWorkspace.snapshot().running && !flypowWorkspace.snapshot().ready'))
        if a.exercise_preparation:
            check('isolated preparation issued no model download or financial write',js("return !Number(localStorage.getItem('fixture-model-downloads'))&&!Number(localStorage.getItem('fixture-transactions'))&&!Number(localStorage.getItem('fixture-signatures'))"))
        report=dict(passed=True,checks=checks,checkCount=len(checks),actualChromium=True,preparationFixture=a.exercise_preparation,logFixture=a.exercise_preparation,modelExecuted=False,officialModelDownloads=0,financialMutations=0,extensionConfirmation=False,physicalDevice=False,site=a.site)
        a.report.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['passed','checkCount','preparationFixture','modelExecuted','financialMutations']}))
    except Exception:
        driver.save_screenshot(str(a.report.with_suffix('.failure.png')))
        a.report.with_suffix('.failure.json').write_text(json.dumps({'checks':checks,'error':js("return document.getElementById('miner-error-detail').textContent"),'snapshot':js("return {primary:document.getElementById('miner-primary').textContent,disabled:document.getElementById('miner-primary').disabled,backdrop:document.getElementById('miner-log-backdrop').hidden,preparation:flypowWorkspace?.snapshot().preparation,anatomy:flypowWorkspace?.snapshot().anatomy.mode}")},indent=2)+'\n')
        raise
    finally:driver.quit()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--site',required=True);parser.add_argument('--report',type=Path,required=True);parser.add_argument('--exercise-preparation',action='store_true');main(parser.parse_args())
