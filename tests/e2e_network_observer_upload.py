#!/usr/bin/env python3
"""CDP must keep observing after a real multi-MiB PUT and page refresh.

Uses an isolated loopback receiver, preserves its browser profile and performs
no scientific computation, model import or official download.
"""
import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from selenium import webdriver
from browser_cache import retained_profile, close_test_browser
from e2e_official_download import BrowserNetwork


def main(a):
    network = json.loads(Path(a.network_file).read_text())

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            body = b'<!doctype html><title>Network observer regression</title>' if self.path == '/' else b'{"enabled":false}'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html' if self.path == '/' else 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_PUT(self):
            remaining = int(self.headers['Content-Length'])
            assert remaining == 4 * 1024 * 1024
            while remaining:
                data = self.rfile.read(min(remaining, 65536))
                if not data:
                    raise IOError('Incomplete upload')
                remaining -= len(data)
            self.send_response(204)
            self.end_headers()

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = 'http://127.0.0.1:' + str(server.server_port)
    with retained_profile(a.profile) as profile:
        options = webdriver.ChromeOptions()
        options.binary_location = '/usr/bin/chromium'
        for flag in ['--headless=new', '--no-sandbox', '--no-proxy-server',
                     '--disable-dev-shm-usage', '--user-data-dir=' + profile]:
            options.add_argument(flag)
        driver = webdriver.Chrome(options=options)
        driver.set_script_timeout(30)
        observer = BrowserNetwork(driver, staged_network=network, staged_origin=origin)
        try:
            driver.get(origin)
            read = lambda: driver.execute_async_script("fetch('/assets/data/target-network-v2.json',{cache:'no-store'}).then(r=>r.json()).then(arguments[0])")
            assert read() == network
            status = driver.execute_async_script("fetch('/upload',{method:'PUT',body:new Uint8Array(4*1024*1024).fill(65)}).then(r=>arguments[0](r.status))")
            assert status == 204
            time.sleep(.5)
            driver.refresh()
            received = read()
            if received != network or observer.errors:
                Path(a.report).write_text(json.dumps(dict(failure='Upload interrupted configuration interception', observerErrors=observer.errors, configurationOverrides=observer.staged_requests, received=received), indent=2) + '\n')
            assert received == network, observer.errors
            assert not observer.errors and not observer.requests
            assert 'PUT' in observer.writes and len(observer.staged_requests) == 2
            report = dict(schema='flypow-observer-upload-regression-v1', passed=1,
                          actualUploadBytes=4*1024*1024, observerErrors=observer.errors,
                          configurationOverrides=observer.staged_requests,
                          officialDownloads=0, profileRetained=True,
                          scientificComputation=False)
            Path(a.report).write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(dict(passed=1, actualUploadBytes=report['actualUploadBytes'], officialDownloads=0)))
        finally:
            observer.close()
            close_test_browser(driver)
            server.shutdown()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--network-file', required=True)
    p.add_argument('--profile', required=True)
    p.add_argument('--report', required=True)
    main(p.parse_args())
