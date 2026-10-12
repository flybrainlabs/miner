#!/usr/bin/env python3
"""Verify the deployed HTTPS app runs the full frozen model locally in Chromium.

No wallet, signing keys or chain transactions are used. Graph/model inputs are
local files, never uploaded to the static host. This checks the production CSP,
Worker, WASM, true full-model result, language and mobile layout together.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import tempfile
import time
from urllib.parse import urlsplit

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


def main(args):
    if urlsplit(args.url).scheme != 'https':
        raise ValueError('The deployed app must use HTTPS with certificate verification')
    report = {'schema': 'flypow-public-research-e2e-v1', 'url': args.url,
              'input_mode': 'locally imported frozen full graph/model; no input upload',
              'checks': []}
    output = Path(args.report)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='flypow-public-browser-', dir=output.parent) as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = '/usr/bin/chromium'
        for flag in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
                     '--no-proxy-server', '--renderer-process-limit=2',
                     '--window-size=1440,1000', '--user-data-dir='+profile]:
            options.add_argument(flag)
        options.set_capability('goog:loggingPrefs', {'browser': 'ALL', 'performance': 'ALL'})
        driver = webdriver.Chrome(options=options)
        driver.set_script_timeout(60)
        wait = WebDriverWait(driver, 900)

        def element(id):
            return driver.find_element(By.ID, id)

        def click(id):
            wait.until(lambda _: element(id).is_enabled())
            driver.execute_script('arguments[0].click()', element(id))

        try:
            driver.get(args.url.rstrip('/')+'/mining/?view=tools')
            wait.until(lambda _: element('research-capabilities').text)
            wait.until(lambda _: 'No chain campaign configured' in element('research-chain-state').get_attribute('textContent'))
            assert not element('research-chain-tools').is_displayed()
            assert not element('research-run').is_enabled()
            assert not element('research-connect').is_enabled()
            assert not element('research-commit').is_enabled()
            report['checks'].append('HTTPS app loads real modules; calculation gated until full input checks; chain disabled')
            element('research-graph').send_keys(str(args.graph.resolve()))
            element('research-model').send_keys(str(args.model.resolve()))
            started = time.monotonic()
            click('research-prepare')
            wait.until(lambda _: element('research-tools-state').text in {'Full model ready', 'Preparation needs attention'})
            assert element('research-tools-state').text == 'Full model ready', element('miner-error-detail').text
            report['prepare_seconds'] = round(time.monotonic()-started, 3)
            print('Public HTTPS full graph ready', report['prepare_seconds'], flush=True)
            driver.execute_script("document.querySelector('[data-miner-view=settings]').click()")
            wait.until(lambda _: '208 MB' in element('miner-settings-storage').text)
            report['checks'].append('Settings reads current saved model size after preparation without loading or deleting results')
            driver.execute_script("document.querySelector('[data-miner-view=tools]').click()")
            started = time.monotonic()
            click('research-run')
            wait.until(lambda _: driver.execute_script("return document.querySelector('.research-app').dataset.execution==='complete'"))
            click('miner-show-result')
            wait.until(lambda _: element('research-response').is_displayed())
            report['experiment_seconds'] = round(time.monotonic()-started, 3)
            driver.execute_script("document.getElementById('miner-result-details').open=true")
            report['result_root'] = element('research-result-hash').text.removeprefix('SHA-256 ')
            assert report['result_root'] == args.expected_root, report['result_root']
            report['response_bytes'] = element('research-bytes').text
            report['spikes_a'] = element('research-a').text
            report['spikes_b'] = element('research-b').text
            report['checks'].append('public Worker/WASM computes the actual full MaleCNS result matching native reference')
            wait.until(lambda _: driver.find_elements(By.CSS_SELECTOR, '#research-history article'))
            assert not element('research-commit').is_enabled()
            requests = [json.loads(row['message'])['message'] for row in driver.get_log('performance')]
            writes = [row['params']['request']['url'] for row in requests
                      if row['method'] == 'Network.requestWillBeSent'
                      and row['params']['request']['method'] not in {'GET', 'HEAD', 'OPTIONS'}]
            assert not writes, 'Static research computation unexpectedly made a network write'
            report['network_write_count'] = len(writes)
            report['checks'].append('graph/model and computation stay in browser; no POST/PUT, server mining or chain submission')
            driver.execute_script('arguments[0].scrollIntoView({block:"start"})', element('research-response'))
            driver.save_screenshot(str(output.with_suffix('.png')))
            driver.set_window_size(390, 844)
            assert driver.execute_script('return document.documentElement.scrollWidth<=innerWidth+1')
            driver.execute_script('window.scrollTo(0,0)')
            wait.until(lambda d:d.execute_script('return Math.abs(scrollY)<1'))
            element('language-switch').click()
            wait.until(lambda d: d.execute_script('return document.documentElement.lang').startswith('zh'))
            report['checks'].append('390px viewport and Chinese switch work on the deployed host')
            report['browser_errors'] = [row['message'] for row in driver.get_log('browser') if row['level'] == 'SEVERE']
            assert not report['browser_errors'], report['browser_errors']
        finally:
            try:
                report['last_ui_state'] = {id: element(id).get_attribute('textContent') for id in ['research-state', 'research-chain-state']}
            except Exception as error:
                report['last_ui_error'] = str(error)
            output.write_text(json.dumps(report, indent=2)+'\n')
            driver.quit()
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='https://flybrain.work')
    parser.add_argument('--graph', required=True, type=Path)
    parser.add_argument('--model', required=True, type=Path)
    parser.add_argument('--expected-root', required=True)
    parser.add_argument('--report', default='data/prepared/public-research-report.json')
    main(parser.parse_args())
