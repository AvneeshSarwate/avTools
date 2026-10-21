import * as timing from '../../core-timing/mod.ts';
const g=globalThis as any;
const scopes=new Map<number,SketchLifetime>();
/** Ownership is propagated by V8 through promises; host callbacks capture it too. */
export class SketchLifetime {
  readonly id:number=g.__hostRegister();
  active=true;
  error='';
  private roots=new Set<timing.CancelablePromiseProxy<any>>();
  private cleanups: (()=>void)[]=[];
  private resources=new Set<{destroy():void}>();
  private disposing=false;
  /** Synchronous, reverse registration order; called before GPU resources expire. */
  onDispose(callback:()=>void){this.run(()=>{if(this.disposing)throw new Error('Sketch cleanup has already started');if(typeof callback!=='function')throw new TypeError('onDispose requires a function');this.cleanups.push(callback);});}
  constructor(){scopes.set(this.id,this);}
  run<T>(fn:()=>T):T {
    if(!this.active)throw new Error('Sketch generation has been disposed');
    const previous=g.__hostGeneration(this.id);
    try{return fn();}finally{g.__hostGeneration(previous);}
  }
  private track<T>(fn:()=>timing.CancelablePromiseProxy<T>){
    return this.run(()=>{
      const handle=fn();this.roots.add(handle);
      handle.then(()=>this.roots.delete(handle),error=>{
        this.roots.delete(handle);
        if(!handle.abortController.signal.aborted)this.fail(error);
      });
      return handle; // Preserve cancel(), cancelSafe(), handleCancel(), and context.
    });
  }
  readonly timing=Object.freeze({...timing,
    launch:((...args:Parameters<typeof timing.launch>)=>this.track(()=>timing.launch(...args))) as typeof timing.launch,
    launchBrowser:((...args:Parameters<typeof timing.launchBrowser>)=>this.track(()=>timing.launchBrowser(...args))) as typeof timing.launchBrowser,
    createAndLaunchContext:((...args:Parameters<typeof timing.createAndLaunchContext>)=>this.track(()=>timing.createAndLaunchContext(...args))) as typeof timing.createAndLaunchContext,
    cancelAllContexts:()=>this.cancelRoots(),
  });
  cancelRoots(){for(const root of [...this.roots])root.cancel();this.roots.clear();}
  fail(error:unknown){if(!this.active||this.error)return;this.error=String((error as any)?.stack??error);this.run(()=>this.cancelRoots());g.__hostInvalidate(this.id);g.__hostCancelFrames(this.id);}
  dispose(){
    if(!this.active)return;
    this.disposing=true;
    this.run(()=>this.cancelRoots());
    for(const cleanup of this.cleanups.splice(0).reverse()){
      try {const result:any=this.run(cleanup);if(result&&typeof result.then==='function'){result.catch(()=>{});throw new Error('onDispose callbacks must be synchronous');}}
      catch(error){console.error('Sketch cleanup failed:',String(error));}
    }
    for(const resource of this.resources){try{resource.destroy();}catch(error){console.error('GPU cleanup failed:',String(error));}}
    this.resources.clear();
    g.__hostInvalidate(this.id);g.__hostCancelFrames(this.id);this.active=false;scopes.delete(this.id);
  }
  private wrapped=new WeakMap<object,any>();
  private raw=new WeakMap<object,any>();
  /** Retained renderer/host functions fail before entering disposed native resources. */
  guard<T extends object>(value:T):T {
    const {wrapped,raw}=this;
    const unwrap=(value:any):any=>{
      if(!value||typeof value!=='object')return value;
      if(raw.has(value))return raw.get(value);
      if(Array.isArray(value))return value.map(unwrap);
      if(Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,unwrap(v)]));
      return value;
    };
    const wrap=(target:any):any=>{
      if(!target||typeof target!=='object'||ArrayBuffer.isView(target)||target instanceof ArrayBuffer)return target;
      if(target instanceof Promise)return target.then(wrap);
      if(wrapped.has(target))return wrapped.get(target);
      const methods=new Map<PropertyKey,unknown>();
      const proxy=new Proxy(target,{get:(object,key)=>{
        const result=this.run(()=>Reflect.get(object,key,object));
        if(typeof result!=='function')return wrap(result);
        if(!methods.has(key))methods.set(key,(...args:unknown[])=>this.run(()=>{
          const value:any=Reflect.apply(result,object,args.map(unwrap));
          if((key==='createBuffer'||key==='createTexture')&&value&&typeof value.destroy==='function')this.resources.add(value);
          if(key==='destroy')this.resources.delete(object);
          return wrap(value);
        }));
        return methods.get(key);
      },set:(object,key,value)=>this.run(()=>Reflect.set(object,key,unwrap(value),object))});
      wrapped.set(target,proxy);raw.set(proxy,target);return proxy;
    };
    return wrap(value);
  }

}
g.__hostError=(error:unknown,generation:number)=>{
  const scope=scopes.get(generation);
  if(scope)scope.fail(error);
  else if(generation===0){g.__avError=String((error as any)?.stack??error);g.__avBackgroundError=g.__avError;}
};
