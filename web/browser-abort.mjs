// AbortSignal.throwIfAborted is absent in some otherwise capable mobile browsers.
export function throwIfAborted(signal){
  if(signal?.aborted)throw signal.reason||new DOMException('The operation was aborted.','AbortError');
}
