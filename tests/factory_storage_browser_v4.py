#!/usr/bin/env python3
"""Kill Chromium at V4 OPFS handoff boundaries and recover its retained profile.

Run from an assembled workspace. Uses Selenium, Chromium and its matching
driver. All scientific events and submission I/O are fixtures. No live wallet,
RPC, complete-model result, signing, or financial action is involved.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import threading
import time

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path in ('/acceptance', '/tests/factory_storage_browser_v4.mjs'):
            body = ((b'<!doctype html><meta charset="utf-8"><title>V4 storage acceptance</title>'
                     b'<script type="module" src="/tests/factory_storage_browser_v4.mjs"></script>')
                    if path == '/acceptance' else Path(__file__).with_suffix('.mjs').read_bytes())
            self.send_response(200)
            self.send_header('Content-Type', ('text/html' if path == '/acceptance'
                                             else 'text/javascript') + '; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Content-Security-Policy', "default-src 'self'; connect-src 'self'")
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()


def descendants(parent):
    parents = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            status = path.joinpath('status').read_text().splitlines()
            parents[int(path.name)] = next(int(row.split()[1]) for row in status if row.startswith('PPid:'))
        except (OSError, StopIteration):
            pass
    owned = {parent}
    while True:
        new = {pid for pid, ppid in parents.items() if ppid in owned} - owned
        if not new:
            return owned
        owned |= new


def main(args):
    workspace, output = args.workspace.resolve(), args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(workspace)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = 'http://127.0.0.1:' + str(server.server_port)
    report = {'schema': 'flybrainlabs-v4-browser-storage-crash-acceptance', 'passed': False,
              'scope': 'Real Chromium/OPFS/Web Locks/store/outbox; synthetic events and submission I/O',
              'scientificFixtures': True, 'publicFinancialActions': 0, 'cases': []}
    driver = None

    def boot(profile, scenario):
        options = webdriver.ChromeOptions()
        options.binary_location = args.chromium
        for flag in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
                     '--disable-background-networking', '--disable-component-update',
                     '--disable-sync', '--no-first-run', '--user-data-dir=' + str(profile),
                     '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']:
            options.add_argument(flag)
        instance = webdriver.Chrome(service=Service(args.chromedriver), options=options)
        instance.set_script_timeout(15)
        try:
            instance.get(origin + '/acceptance?scenario=' + scenario)
            WebDriverWait(instance, 30).until(lambda d: d.execute_script('return !!window.storageAcceptanceReady'))
        except BaseException:
            instance.quit()
            raise
        return instance

    def invoke(instance, expression):
        result = instance.execute_async_script(
            'const done=arguments[0];Promise.resolve().then(()=>(' + expression +
            ')).then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));')
        assert result['ok'], result
        return result['value']

    try:
        scenarios = [('before-response', 0), ('response-before-receipt', 0),
                     ('receipt-before-state', 1), ('state-before-index', 2),
                     ('saved-before-enqueue', 2), ('enqueued-before-drive', 2)]
        for scenario, expected in scenarios:
            profile = output / ('profile-' + scenario)
            driver = boot(profile, scenario)
            driver.execute_script('window.storageAcceptance.prepare(arguments[0]).catch(e=>window.testFailure=String(e));', scenario)
            WebDriverWait(driver, 30).until(lambda d: d.execute_script('return !!window.crashBoundary || !!window.testFailure'))
            assert not driver.execute_script('return window.testFailure || null')
            before = driver.execute_script('return window.crashBoundary')
            assert before['point'] == scenario
            browser_pid = driver.capabilities.get('goog:processID')
            assert isinstance(browser_pid, int) and browser_pid > 1
            command = Path('/proc', str(browser_pid), 'cmdline').read_bytes()
            assert str(profile).encode() in command, 'Only kill the fresh acceptance browser'
            children = descendants(browser_pid)
            for pid in sorted(children, reverse=True):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            driver.service.stop()
            driver = None
            time.sleep(.5)
            driver = boot(profile, scenario)
            recovered = invoke(driver, 'window.storageAcceptance.inspect()')
            assert recovered['candidateId'] == before['candidateId']
            assert recovered['roundId'] == before['roundId']
            assert len(recovered['trials']) == expected, recovered
            assert recovered['count'] == 1
            assert recovered['sciencePassed'] == (expected == 2)
            assert recovered['retainedResponseBytes'] == (0 if scenario == 'before-response'
                                                         else 1056 if expected <= 1 else 2112)
            if scenario == 'enqueued-before-drive':
                first = driver.current_window_handle
                invoke(driver, 'window.storageAcceptance.holdOutbox()')
                WebDriverWait(driver, 15).until(lambda d: d.execute_script('return window.storageAcceptance.held'))
                driver.switch_to.new_window('tab')
                driver.get(origin + '/acceptance?scenario=' + scenario)
                WebDriverWait(driver, 30).until(lambda d: d.execute_script('return !!window.storageAcceptanceReady'))
                competing = invoke(driver, 'window.storageAcceptance.recoverOutbox()')
                assert competing['submissions'] == [], 'Second tab must not acquire the held candidate'
                driver.close()
                driver.switch_to.window(first)
                finished = invoke(driver, 'window.storageAcceptance.finishOutbox()')
                assert finished['submissions'] == [before['candidateId']]
                report['realTabsShareCandidateLock'] = True
            queued = invoke(driver, 'window.storageAcceptance.recoverOutbox()')
            assert queued['submissions'] == ([before['candidateId']] if expected == 2 else [])
            assert queued['snapshot']['active'] == 0
            report['cases'].append({'boundary': scenario, 'browserKilled': True,
                                    'savedTrialsRecovered': expected, 'recovered': recovered,
                                    'fixtureSubmitCalls': len(queued['submissions']),
                                    'duplicateSubmitOnSecondTick': False})
            driver.quit()
            driver = None
            (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        report['passed'] = True
    finally:
        if driver is not None:
            driver.quit()
        server.shutdown()
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passed': report['passed'], 'cases': len(report['cases']),
                      'publicFinancialActions': 0, 'report': str(output / 'report.json')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, default=Path.cwd())
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    parser.add_argument('--chromedriver', default='/usr/bin/chromedriver')
    main(parser.parse_args())
