import {P5GPU as PortableP5GPU, type P5GPUOptions} from '../../../apps/deno-notebooks/tools/p5gpu_renderer.ts';
import {HostTextEngine, type NativeEngine} from './text-core.ts';
declare const nativeText: {TextEngine: new () => NativeEngine};
declare const readFile: (path:string) => Uint8Array;
export class EmbeddedP5GPU extends PortableP5GPU {
  constructor(device:GPUDevice, options:P5GPUOptions, fonts:readonly string[]) {
    super(device,options,{
      createTextEngine:()=>{
        const engine=new HostTextEngine(new nativeText.TextEngine());
        try {for(const font of fonts) if(!engine.loadFontBytes(readFile(font)))throw new Error(`Could not load font ${font}`);}
        catch(error){engine.dispose();throw error;}
        return engine;
      },
      readFile:async path=>readFile(String(path)),
    });
  }
}
