/// <reference lib="dom" />

export type ShaderSource = GPUTexture | GPUTextureView | ShaderEffect;
export type ShaderInputs = Record<string, ShaderSource>;
export type Dynamic<T> = T | (() => T);
export type ShaderUniforms = Record<string, Dynamic<unknown>>;

async function supportsFormat(device: GPUDevice, format: GPUTextureFormat): Promise<boolean> {
  device.pushErrorScope('validation');
  let texture: GPUTexture | null = null;
  try {
    texture = device.createTexture({
      size: { width: 1, height: 1 },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  } catch {
    await device.popErrorScope();
    return false;
  }
  const error = await device.popErrorScope();
  if (error) {
    return false;
  }
  texture?.destroy();
  return true;
}

export async function selectShaderFxFormat(
  device: GPUDevice,
  preferred: GPUTextureFormat[] = ['rgba16float', 'rgba32float', 'rgba8unorm'],
): Promise<GPUTextureFormat> {
  for (const format of preferred) {
    if (await supportsFormat(device, format)) {
      return format;
    }
  }
  return 'rgba8unorm';
}

function extract<T>(value: Dynamic<T>): T {
  return value instanceof Function ? value() : value;
}

function resolveTexture(source: ShaderSource): GPUTextureView {
  if (source instanceof ShaderEffect) {
    return source.output;
  }
  if ('createView' in source) {
    return source.createView();
  }
  return source;
}

export interface GraphNode {
  id: string;
  name: string;
  ref: ShaderEffect;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface ShaderGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

let shaderEffectIdCounter = 0;
function generateShaderEffectId(): string {
  shaderEffectIdCounter += 1;
  return `shaderEffect-${shaderEffectIdCounter}`;
}

export abstract class ShaderEffect<I extends ShaderInputs = ShaderInputs> {
  readonly id: string;
  abstract setSrcs(fx: Partial<I>): void;
  abstract render(): void;
  abstract setUniforms(uniforms: ShaderUniforms): void;
  abstract updateUniforms(): void;
  abstract output: GPUTextureView;
  public debugId = 'unset';
  effectName = 'unset';
  width = 1280;
  height = 720;
  inputs: Partial<I> = {};
  uniforms: ShaderUniforms = {};

  protected constructor() {
    this.id = generateShaderEffectId();
  }

  abstract dispose(): void;

  disposeAll(): void {
    this.dispose();
    for (const input of Object.values(this.inputs)) {
      if (input instanceof ShaderEffect) {
        input.disposeAll();
      }
    }
  }

  protected buildOrderedEffects(): ShaderEffect[] {
    const ordered: ShaderEffect[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (effect: ShaderEffect): void => {
      if (visited.has(effect.id)) {
        return;
      }
      if (visiting.has(effect.id)) {
        throw new Error(`Cycle detected in shader graph at ${effect.effectName}`);
      }
      visiting.add(effect.id);
      for (const input of Object.values(effect.inputs)) {
        if (input instanceof ShaderEffect) {
          visit(input);
        }
      }
      visiting.delete(effect.id);
      visited.add(effect.id);
      ordered.push(effect);
    };

    visit(this);
    return ordered;
  }

  public getOrderedEffects(): ShaderEffect[] {
    return this.buildOrderedEffects();
  }

  public getGraph(): ShaderGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const visited = new Set<string>();

    const visit = (effect: ShaderEffect): void => {
      if (visited.has(effect.id)) {
        return;
      }
      visited.add(effect.id);

      nodes.push({
        id: effect.id,
        name: effect.effectName,
        ref: effect,
      });

      for (const input of Object.values(effect.inputs)) {
        if (input instanceof ShaderEffect) {
          edges.push({ from: input.id, to: effect.id });
          visit(input);
        }
      }
    };

    visit(this);
    return { nodes, edges };
  }

  renderAll(): void {
    const ordered = this.getOrderedEffects();
    for (const effect of ordered) {
      effect.render();
    }
  }
}

export interface MaterialHandles<U, TName extends string = string> {
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  setTexture(name: TName, texture: GPUTextureView): void;
  setUniforms(uniforms: Partial<U>): void;
}

export type ShaderMaterialFactory<U, TName extends string = string> = (
  device: GPUDevice,
  format: GPUTextureFormat,
  options?: { name?: string; passIndex?: number },
) => MaterialHandles<U, TName>;

export interface CustomShaderEffectOptions<U, I extends ShaderInputs = ShaderInputs> {
  factory: ShaderMaterialFactory<U, string>;
  textureInputKeys: Array<keyof I & string>;
  width?: number;
  height?: number;
  format?: GPUTextureFormat;
  clearColor?: GPUColor;
}

export class CustomShaderEffect<U extends object, I extends ShaderInputs = ShaderInputs> extends ShaderEffect<I> {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly outputTexture: GPUTexture;
  output: GPUTextureView;
  protected readonly material: MaterialHandles<U, string>;
  protected readonly inputKeys: Array<keyof I & string>;
  protected readonly clearColor: GPUColor;

  constructor(device: GPUDevice, inputs: I, options: CustomShaderEffectOptions<U, I>) {
    super();
    this.device = device;
    this.inputs = inputs;
    this.width = options.width ?? this.width;
    this.height = options.height ?? this.height;
    this.format = options.format ?? 'rgba16float';
    this.clearColor = options.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };

    if (options.textureInputKeys.length === 0) {
      throw new Error('CustomShaderEffect requires at least one textureInputKey');
    }
    this.inputKeys = [...options.textureInputKeys];

    this.material = options.factory(device, this.format, { name: 'ShaderFXMaterial', passIndex: 0 });

    this.outputTexture = device.createTexture({
      size: { width: this.width, height: this.height },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.output = this.outputTexture.createView();
  }

  setSrcs(inputs: Partial<I>): void {
    this.inputs = { ...this.inputs, ...inputs };
  }

  setUniforms(uniforms: ShaderUniforms): void {
    this.uniforms = { ...this.uniforms, ...uniforms };
    this.updateUniforms();
  }

  updateUniforms(): void {
    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.uniforms)) {
      record[key] = extract(value as Dynamic<unknown>);
    }
    this.material.setUniforms(record as Partial<U>);
  }

  render(): void {
    for (const key of this.inputKeys) {
      const source = this.inputs[key];
      if (!source) {
        throw new Error(`Missing input texture for key ${String(key)}`);
      }
      const view = resolveTexture(source);
      this.material.setTexture(String(key), view);
    }

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.output,
          clearValue: this.clearColor,
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.material.pipeline);
    pass.setBindGroup(0, this.material.bindGroup);
    pass.draw(3);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.outputTexture.destroy();
  }
}
