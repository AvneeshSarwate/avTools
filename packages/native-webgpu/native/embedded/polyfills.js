globalThis.console = {log:hostLog,error:hostLog,warn:hostLog,debug:hostLog};
const tasks=[];
globalThis.setImmediate = callback => {tasks.push(callback); return tasks.length;};
globalThis.__pump=()=>{const turn=tasks.splice(0,64);for(const task of turn)task();};
globalThis.Event=class Event{constructor(type,options={}){this.type=type;this.cancelable=!!options?.cancelable;this.defaultPrevented=false;} preventDefault(){if(this.cancelable)this.defaultPrevented=true;}};
globalThis.EventTarget=class EventTarget {
  listeners=new Map();
  addEventListener(type,fn,options={}){if(!fn)return;let list=this.listeners.get(type)||[];if(!list.some(x=>x.fn===fn))list.push({fn,once:!!options?.once});this.listeners.set(type,list);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x.fn!==fn));}
  dispatchEvent(event){for(const entry of [...(this.listeners.get(event.type)||[])]){if(entry.once)this.removeEventListener(event.type,entry.fn);if(typeof entry.fn==='function')entry.fn.call(this,event);else entry.fn.handleEvent(event);}return !event.defaultPrevented;}
};
globalThis.DOMException=class DOMException extends Error{constructor(message,name='Error'){super(message);this.name=name;}};
