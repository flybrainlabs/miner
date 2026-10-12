#!/usr/bin/env python3
"""Retain positive and negative full-model cases; never changes parameters."""
import argparse
import json
from pathlib import Path
import struct
import subprocess
import time

def main(a):
    output=Path(a.output);output.mkdir(parents=True,exist_ok=True);catalog=Path('web/data/research-profiles/duration128-v1-dev/catalog.json');c=json.loads(catalog.read_text())['campaign'];report={'schema':'flypow-duration-diagnostics-v1','profile':'duration128-v1-dev','state':'UNCALIBRATED_DEV_ONLY','samples':[]}
    # Controlled strength (one step), duration (current=200), and seed repeats.
    for k in [0,4,8,12,28,44,60,124,125,126,127,200]:
        file=output/f'{k}.bin';at=time.monotonic()
        command=['target/release/verify_response','data/prepared/registry-male-cns-v1.0/graph-v1.bin','data/prepared/registry-male-cns-v1.0/model-v0.bin',str(catalog),str(k),str(file)]
        if not file.exists():command.append('--write-new')
        run=subprocess.run(command,capture_output=True,text=True,check=True);seconds=time.monotonic()-at
        with file.open('rb') as f:head=f.read(480)
        glob=struct.unpack_from('<8Q',head,24);bins=struct.unpack_from('<32i',head,216)
        sample={'k':k,'stimulus':c['stimuli'][(k//4)%len(c['stimuli'])],'repeat':k%4,'nativeComputeEncodeValidateSeconds':seconds,'archiveBytes':file.stat().st_size,'spikesA':glob[0],'spikesB':glob[1],'activeA':glob[2],'activeB':glob[3],'targetA':glob[4],'targetB':glob[5],'maximumBinDelta':max(bins),'populationDeltaBins':bins,'native':run.stdout.strip()}
        report['samples'].append(sample);(output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'k':k,'seconds':seconds,'A':glob[0],'B':glob[1]}),flush=True)
    report['interpretation']='All retained samples use unchanged lif-point-v0-dev physiology. Silent A and broad synchronized B cascades are development-model limitations; these are model predictions, not calibrated biology or a reward factor.'
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',default='data/prepared/optimization-diagnostics');main(p.parse_args())
