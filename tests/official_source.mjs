import assert from 'node:assert/strict';
import fs from 'node:fs';
import { officialReadURL } from '../web/official-source.mjs';
const manifest=JSON.parse(fs.readFileSync('web/data/official-inputs.json'));
for(const source of manifest.sources){
  const url=new URL(officialReadURL(source));
  assert.equal(url.origin,'https://storage.googleapis.com');
  assert.equal(decodeURIComponent(url.pathname.split('/o/')[1]),new URL(source.url).pathname.slice('/flyem-male-cns/'.length));
  assert.equal(url.search,'?alt=media');
  assert.throws(()=>officialReadURL({...source,url:source.url+'?redirect=elsewhere'}));
  assert.throws(()=>officialReadURL({...source,url:source.url.replace('storage.googleapis.com','example.com')}));
  assert.throws(()=>officialReadURL({...source,bytes:0}));
  assert.throws(()=>officialReadURL({...source,sha256:'unchecked'}));
}
console.log('Official download API preserves each canonical object and rejects altered sources or unchecked identities.');
