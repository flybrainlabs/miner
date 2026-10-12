// The JSON download API serves the SAME public GCS objects with readable CORS
// and exposed Content-Range. The canonical URLs and frozen hashes stay unchanged.
const PREFIX='https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/';
const NAMES={annotation:'body-annotations-male-cns-v1.0-minconf-0.5.feather',weights:'connectome-weights-male-cns-v1.0-minconf-0.5.feather',transmitter:'body-neurotransmitters-male-cns-v1.0.feather'};
export function officialReadURL(source){
  if(!Object.hasOwn(NAMES,source.id)||source.url!==PREFIX+NAMES[source.id]||!Number.isSafeInteger(source.bytes)||source.bytes<=0||!/^[a-f0-9]{64}$/.test(source.sha256))throw new Error('Unexpected official source identity');
  const object='v1.0/connectome-data/flat-connectome/'+NAMES[source.id];
  return 'https://storage.googleapis.com/download/storage/v1/b/flyem-male-cns/o/'+encodeURIComponent(object)+'?alt=media';
}
