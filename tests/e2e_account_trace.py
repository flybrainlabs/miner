#!/usr/bin/env python3
"""Trace a retained real winner through signed records, task and local archives.

Does not start mining, publish private results or export browser signing state.
"""
import argparse
import json
import time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from browser_cache import retained_profile, close_test_browser
from e2e_official_download import BrowserNetwork


def main(args):
    out = Path(args.report)
    out.parent.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'flybrain-account-trace-v1', 'site': args.site,
              'checks': [], 'retainedProfile': True, 'formalFunds': False,
              'privateFieldsExported': False, 'miningStarted': False}

    def check(text):
        report['checks'].append(text)
        out.write_text(json.dumps(report, indent=2) + '\n')
        print(text, flush=True)

    with retained_profile() as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = '/usr/bin/chromium'
        for flag in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
                     '--no-proxy-server', '--enable-unsafe-swiftshader',
                     '--use-gl=angle', '--use-angle=swiftshader',
                     '--user-data-dir=' + profile, '--window-size=1440,1050']:
            options.add_argument(flag)
        options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
        driver = webdriver.Chrome(options=options)
        js = driver.execute_script
        wait = WebDriverWait(driver, 120)
        network = BrowserNetwork(driver)
        driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {'source':
            'window.accountWorkerCount=0;const OriginalWorker=window.Worker;'
            'window.Worker=class extends OriginalWorker{constructor(...args){'
            'super(...args);window.accountWorkerCount++;}};'})

        def records():
            driver.get(args.site.rstrip('/') + '/account/')
            wait.until(lambda _: driver.find_elements(By.CSS_SELECTOR,
                       '#account-records article[data-contribution-id]'))
            for element in driver.find_elements(By.CSS_SELECTOR,
                             '#account-records article[data-contribution-id]'):
                row = json.loads(element.find_element(By.TAG_NAME, 'pre').get_attribute('textContent'))
                if row['candidateId'] == args.candidate:
                    return element, row
            raise AssertionError('The retained real winner is missing from signed account records')

        try:
            element, row = records()
            assert row['publicResultId'] is None
            assert row['acceptanceId'] and row['roundId'] and row['goalId']
            assert not element.find_elements(By.CSS_SELECTOR, 'a[href^="/results/"]')
            assert js('return accountWorkerCount') == 0
            report['contribution'] = {k: row[k] for k in
                ['contributionId', 'taskId', 'goalId', 'roundId', 'candidateId', 'acceptanceId', 'publicResultId']}
            report['browserVersion'] = driver.capabilities['browserVersion']
            check('Actual newly won candidate appears under the retained signed identity with acceptance, round, goal and scientific task; private result has no public link')

            for language in ['en', 'zh', 'en']:
                js('FlyI18n.setLanguage(arguments[0])', language)
                wait.until(lambda _: js('return FlyI18n.language') == language)
                time.sleep(.2)
                assert len(element.find_elements(By.CSS_SELECTOR, 'nav a')) == 2
                expected = '发现贡献' if language == 'zh' else 'Discovery contribution'
                wait.until(lambda _: expected in element.text)
            for width in [360, 390, 1440]:
                driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride', {
                    'width': width, 'height': 1050, 'deviceScaleFactor': 1, 'mobile': False})
                assert js('return document.documentElement.scrollWidth') <= width + 1
            check('Contribution navigation and dynamic labels survive both languages and 360/390/1440px widths without horizontal overflow')

            driver.refresh()
            wait.until(lambda _: driver.find_elements(By.ID, 'contribution-' + row['contributionId']))
            element = driver.find_element(By.ID, 'contribution-' + row['contributionId'])
            restored = json.loads(element.find_element(By.TAG_NAME, 'pre').get_attribute('textContent'))
            assert restored == row and js('return accountWorkerCount') == 0
            element.find_element(By.CSS_SELECTOR, 'a[href^="/tasks/"]').click()
            wait.until(lambda _: driver.find_elements(By.CSS_SELECTOR, '#task-detail details pre'))
            definition = json.loads(driver.find_element(By.CSS_SELECTOR, '#task-detail details pre').get_attribute('textContent'))
            assert definition['goalId'] == row['goalId'] and definition['scientificTaskId'] == row['taskId']
            driver.refresh()
            wait.until(lambda _: driver.find_elements(By.CSS_SELECTOR, '#task-detail details pre'))
            assert js('return accountWorkerCount') == 0
            check('Refresh preserves the exact contribution; task link and refreshed task definition match its frozen goal and scientific identity without computation')

            element, after = records()
            assert after == row
            element.find_element(By.CSS_SELECTOR, 'a[href*="view=contributions"]').click()
            wait.until(lambda _: js('return !!window.flypowWorkspace'))
            wait.until(lambda _: js('return flypowWorkspace.snapshot().goalResults?.some(r=>r.candidateId===arguments[0]&&r.won)', args.candidate))
            snapshot = js('return flypowWorkspace.snapshot()')
            assert not snapshot['running'] and not snapshot['preparationBusy'] and snapshot['cacheModel']
            assert not driver.find_element(By.ID, 'miner-view-contributions').get_attribute('hidden')
            check('Local archive link opens the actual retained winner and model cache; navigation and refresh never start CPU or upload local history')

            report['officialRequests'] = len(network.requests)
            report['officialBytes'] = network.data_received_bytes
            report['severeBrowserErrors'] = sum(x['level'] == 'SEVERE' for x in driver.get_log('browser'))
            assert not network.requests and not network.data_received_bytes
            assert report['severeBrowserErrors'] == 0
            check('Real HTTPS account-to-task-to-archive navigation uses zero official model requests or bytes and reports no severe browser errors')
            report['passed'] = True
        except Exception as error:
            report['errorType'] = type(error).__name__
            raise
        finally:
            out.write_text(json.dumps(report, indent=2) + '\n')
            network.close()
            close_test_browser(driver)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', default='https://flybrain.work')
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--report', required=True)
    main(parser.parse_args())
