// Small embedded host profile, not a browser DOM or a Node environment.
globalThis.console = {log:hostLog,error:hostLog,warn:hostLog,debug:hostLog};
globalThis.performance = Object.freeze({now:__hostNow});
globalThis.crypto = Object.freeze({randomUUID:__hostUUID});
globalThis.DOMException=class DOMException extends Error{constructor(message,name='Error'){super(message);this.name=name;}};
globalThis.Event=class Event {
  constructor(type,options={}){this.type=String(type);this.cancelable=!!options?.cancelable;this.defaultPrevented=false;this.target=null;this.currentTarget=null;}
  preventDefault(){if(this.cancelable)this.defaultPrevented=true;}
  stopImmediatePropagation(){this._stop=true;}
};
globalThis.EventTarget=class EventTarget {
  #listeners=new Map();
  addEventListener(type,fn,options={}){
    if(!fn)return;type=String(type);const capture=typeof options==='boolean'?options:!!options?.capture;
    const list=this.#listeners.get(type)||[];
    if(!list.some(x=>!x.removed&&x.fn===fn&&x.capture===capture))list.push({fn,capture,once:!!options?.once,removed:false});
    this.#listeners.set(type,list);
  }
  removeEventListener(type,fn,options={}){
    const capture=typeof options==='boolean'?options:!!options?.capture;
    const list=this.#listeners.get(String(type));if(!list)return;
    for(const x of list)if(x.fn===fn&&x.capture===capture)x.removed=true;
    this.#listeners.set(String(type),list.filter(x=>!x.removed));
  }
  dispatchEvent(event){
    event.target=event.currentTarget=this;
    for(const entry of [...(this.#listeners.get(event.type)||[])]){
      if(entry.removed)continue;
      if(entry.once)this.removeEventListener(event.type,entry.fn,{capture:entry.capture});
      try{if(typeof entry.fn==='function')entry.fn.call(this,event);else entry.fn.handleEvent(event);}
      catch(error){__hostReportError(error);}
      if(event._stop)break;
    }
    event.currentTarget=null;return !event.defaultPrevented;
  }
};
const abortToken={};
globalThis.AbortSignal=class AbortSignal extends EventTarget {
  #aborted=false;#reason;#onabort=null;
  constructor(token){super();if(token!==abortToken)throw new TypeError('Illegal constructor');}
  get aborted(){return this.#aborted;} get reason(){return this.#reason;}
  throwIfAborted(){if(this.#aborted)throw this.#reason;}
  get onabort(){return this.#onabort;}
  set onabort(fn){if(this.#onabort)this.removeEventListener('abort',this.#onabort);this.#onabort=typeof fn==='function'?fn:null;if(this.#onabort)this.addEventListener('abort',this.#onabort);}
  _abort(token,reason){if(token!==abortToken||this.#aborted)return;this.#aborted=true;this.#reason=reason===undefined?new DOMException('This operation was aborted','AbortError'):reason;this.dispatchEvent(new Event('abort'));}
};
globalThis.AbortController=class AbortController {
  #signal=new AbortSignal(abortToken);
  get signal(){return this.#signal;}
  abort(reason){this.#signal._abort(abortToken,reason);}
};
const globalEvents=new EventTarget();
globalThis.addEventListener=globalEvents.addEventListener.bind(globalEvents);
globalThis.removeEventListener=globalEvents.removeEventListener.bind(globalEvents);
globalThis.dispatchEvent=globalEvents.dispatchEvent.bind(globalEvents);
globalThis.__hostRejection=(reason,promise)=>{const event=new Event('unhandledrejection',{cancelable:true});event.reason=reason;event.promise=promise;return !dispatchEvent(event);};
// Explicit TD frame source. No timer is synthesized while TD is paused.
let frameId=0;const frames=new Map();
globalThis.requestAnimationFrame=fn=>{if(typeof fn!=='function')throw new TypeError('Frame callback must be callable');const id=++frameId;if(__hostAlive())frames.set(id,{fn,generation:__hostGeneration()});return id;};
globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
globalThis.__hostCancelFrames=generation=>{for(const [id,entry] of frames)if(entry.generation===generation)frames.delete(id);};
globalThis.__hostFrame=()=>{
  const turn=[...frames.keys()];const time=performance.now();
  return Promise.all(turn.map(id=>new Promise(resolve=>__avNativeImmediate(()=>{
    const entry=frames.get(id);if(!entry){resolve();return;}frames.delete(id);
    const previous=__hostGeneration(entry.generation);
    try{if(__hostAlive())entry.fn(time);}catch(error){__hostReportError(error);}
    finally{__hostGeneration(previous);resolve();}
  }))));
};
