#!/usr/bin/env python3
"""Reconnect a retained target miner without repeating its completed science.

Checks actual HTTPS signatures, saved archives, signing identity and refresh.
Never starts CPU, imports models, clears storage or downloads official inputs.
"""
import argparse
import json
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile, close_test_browser
from e2e_official_download import BrowserNetwork


def main(a):
    previous = json.loads(Path(a.candidate_report).read_text())
    staged = json.loads(Path(a.staged_network).read_text()) if a.staged_network else None
    out = Path(a.report)
    out.parent.mkdir(parents=True, exist_ok=True)
    report = dict(schema='flypow-target-cache-continuity-v1', checks=[],
                  repeatedScientificComputation=False, profileRetained=True,
                  configurationOverrideOnly=bool(staged), physicalAndroid=False)

    def save():
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')

    with retained_profile(a.profile) as profile:
        o = webdriver.ChromeOptions()
        o.binary_location = '/usr/bin/chromium'
        for f in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
                  '--no-proxy-server', '--renderer-process-limit=1',
                  '--enable-unsafe-swiftshader', '--user-data-dir=' + profile]:
            o.add_argument(f)
        d = webdriver.Chrome(options=o)
        d.set_script_timeout(90)
        n = BrowserNetwork(d, staged_network=staged, staged_origin=a.site.rstrip('/'))
        w = WebDriverWait(d, 120, poll_frequency=.2)
        snap = lambda: d.execute_script('return window.flypowWorkspace?.snapshot()')
        try:
            observations = []
            for refresh in (False, True):
                if refresh:
                    d.refresh()
                else:
                    d.get(a.site.rstrip('/') + '/mining/')
                w.until(lambda _: snap() and snap()['authorityOnline'])
                s = snap()
                assert not s['running'] and not s['ready'] and s['cacheModel']
                assert not s['chainAvailable']
                candidate = next(m for m in s['goalResults']
                                 if m['candidateId'] == previous['candidate']['candidateId'])
                assert candidate['sciencePassed'] and candidate['trials'] == 2
                evidence = d.execute_async_script("""
const done=arguments[arguments.length-1], config=arguments[0], cid=arguments[1];
(async()=>{
 const network=config||await(await fetch('/assets/data/target-network-v2.json',{cache:'no-store'})).json();
 const {persistentIdentity,TargetRoundClient}=await import('/assets/target-round-client.mjs');
 const {CandidateStoreV2}=await import('/assets/candidate-store-v2.mjs');
 const identity=await persistentIdentity(network), store=new CandidateStoreV2(network), meta=await store.metadata(cid);
 const archives=[];for(let j=0;j<meta.trials.length;j++){const file=await store.archive(meta,j);archives.push({bytes:file.size,resultRoot:meta.trials[j].resultRoot});}
 const client=new TargetRoundClient(network),claim=await client.claimState(meta.claimId),round=await client.roundState(meta.roundId);
 return {minerId:identity.publicKey,claim,round,archives};
})().then(done,e=>done({error:e.message}));
""", staged, previous['candidate']['candidateId'])
                assert 'error' not in evidence, evidence
                assert evidence['minerId'] == previous['minerId']
                expected = previous['scientificArtifacts']['trials']
                assert evidence['archives'] == [dict(bytes=t['bytes'], resultRoot=t['resultRoot'])
                                               for t in expected]
                observations.append(dict(refresh=refresh, candidate=candidate, evidence=evidence))
                report['checks'].append('Refresh' if refresh else 'Reconnection')
                save()
            report['observations'] = observations
            report['network'] = dict(officialRequests=n.requests, officialBytes=n.data_received_bytes,
                                     configurationOverrides=n.staged_requests, observerErrors=n.errors)
            assert not n.requests and not n.errors
            report['passed'] = len(report['checks'])
            save()
            print(json.dumps(dict(passed=report['passed'], officialDownloads=0,
                                  repeatedScientificComputation=False)), flush=True)
        except Exception as e:
            report['failure'] = str(e)
            report['network'] = dict(officialRequests=n.requests, observerErrors=n.errors,
                                     configurationOverrides=n.staged_requests)
            save()
            raise
        finally:
            n.close()
            close_test_browser(d)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--site', default='https://flybrain.work')
    p.add_argument('--profile', required=True)
    p.add_argument('--candidate-report', required=True)
    p.add_argument('--staged-network')
    p.add_argument('--report', required=True)
    main(p.parse_args())
