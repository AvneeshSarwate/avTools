/// <reference lib="dom" />

export interface UniformDescriptor {
  name: string;
  kind: 'f32' | 'i32' | 'u32' | 'bool' | 'vec2f' | 'vec3f' | 'vec4f' | 'mat4x4f';
  bindingName: string;
  default?: unknown;
  isArray?: boolean;
  arraySize?: number;
  ui?: {
    min?: number;
    max?: number;
    step?: number;
  };
}

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

type ShaderInputShape<I> = { [K in keyof I]: ShaderSource };

export type TextureInputKey<I extends ShaderInputShape<I>> = keyof I & string;

export type PassTextureSourceSpec<I extends ShaderInputShape<I>> =
  | { binding: string; source: { kind: 'input'; key: TextureInputKey<I> } }
  | { binding: string; source: { kind: 'pass'; passIndex: number } };

type RuntimePassTextureSource<I extends ShaderInputShape<I>> =
  | { binding: string; kind: 'input'; key: TextureInputKey<I> }
  | { binding: string; kind: 'pass'; passIndex: number };

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

export interface CustomShaderEffectOptions<U, I extends ShaderInputShape<I> = ShaderInputs> {
  factory: ShaderMaterialFactory<U, string>;
  textureInputKeys: Array<TextureInputKey<I>>;
  textureBindingKeys?: string[];
  passTextureSources?: readonly (readonly PassTextureSourceSpec<I>[])[];
  passCount?: number;
  primaryTextureKey?: keyof I & string;
  width?: number;
  height?: number;
  format?: GPUTextureFormat;
  clearColor?: GPUColor;
  uniformMeta?: UniformDescriptor[];
}

export class CustomShaderEffect<U extends object, I extends ShaderInputShape<I> = ShaderInputs> extends ShaderEffect<I> {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly outputTexture: GPUTexture;
  output: GPUTextureView;
  protected readonly passMaterials: Array<MaterialHandles<U, string>>;
  protected readonly inputKeys: Array<TextureInputKey<I>>;
  protected readonly textureBindingKeys: string[];
  protected readonly passCount: number;
  protected readonly primaryTextureKey: keyof I & string;
  protected readonly passTextureSources: RuntimePassTextureSource<I>[][];
  protected readonly passTextures: Array<GPUTexture | null>;
  protected readonly passViews: Array<GPUTextureView | null>;
  protected readonly clearColor: GPUColor;
  public readonly uniformMeta: UniformDescriptor[];

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

    const bindingKeys = options.textureBindingKeys ? [...options.textureBindingKeys] : [...this.inputKeys];
    if (bindingKeys.length === 0) {
      throw new Error('CustomShaderEffect requires at least one texture binding key');
    }
    this.textureBindingKeys = bindingKeys;

    const passCount = Math.max(1, options.passCount ?? 1);
    this.passCount = passCount;

    const primaryTextureKey = options.primaryTextureKey ?? this.inputKeys[0];
    if (!primaryTextureKey) {
      throw new Error('CustomShaderEffect requires a primaryTextureKey to manage multi-pass routing');
    }
    if (!this.inputKeys.includes(primaryTextureKey)) {
      throw new Error(`Primary texture key ${primaryTextureKey} must be one of the textureInputKeys`);
    }
    this.primaryTextureKey = primaryTextureKey;

    this.passMaterials = [];
    for (let i = 0; i < passCount; i += 1) {
      this.passMaterials.push(options.factory(device, this.format, { name: 'ShaderFXMaterial', passIndex: i }));
    }

    this.passTextureSources = this.initializePassTextureSources(options.passTextureSources, passCount);
    this.passTextures = new Array(Math.max(0, passCount - 1)).fill(null);
    this.passViews = new Array(Math.max(0, passCount - 1)).fill(null);

    this.uniformMeta = options.uniformMeta ? [...options.uniformMeta] : [];

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
    const resolved = record as Partial<U>;
    for (const material of this.passMaterials) {
      material.setUniforms(resolved);
    }
  }

  protected initializePassTextureSources(
    sources: readonly (readonly PassTextureSourceSpec<I>[])[] | undefined,
    passCount: number,
  ): RuntimePassTextureSource<I>[][] {
    if (!sources || sources.length === 0) {
      return this.buildDefaultPassTextureSources(passCount);
    }

    const normalized: RuntimePassTextureSource<I>[][] = [];
    for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
      const entries = sources[passIndex] ?? [];
      const normalizedEntries: RuntimePassTextureSource<I>[] = [];
      for (const entry of entries) {
        if (entry.source.kind === 'input') {
          normalizedEntries.push({ binding: entry.binding, kind: 'input', key: entry.source.key });
        } else {
          const dependency = entry.source.passIndex;
          if (dependency >= passIndex) {
            throw new Error(`Pass ${passIndex} can only depend on earlier passes. Received dependency on pass${dependency}.`);
          }
          normalizedEntries.push({ binding: entry.binding, kind: 'pass', passIndex: dependency });
        }
      }
      const seenBindings = new Set(normalizedEntries.map((entry) => entry.binding));
      for (const binding of this.textureBindingKeys) {
        if (seenBindings.has(binding)) {
          continue;
        }
        const candidateKey = binding as TextureInputKey<I>;
        if (this.inputKeys.includes(candidateKey)) {
          normalizedEntries.push({ binding, kind: 'input', key: candidateKey });
        }
      }
      normalized.push(normalizedEntries);
    }
    return normalized;
  }

  protected buildDefaultPassTextureSources(passCount: number): RuntimePassTextureSource<I>[][] {
    const sources: RuntimePassTextureSource<I>[][] = [];
    for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
      const entries: RuntimePassTextureSource<I>[] = [];
      for (const binding of this.textureBindingKeys) {
        if (binding === this.primaryTextureKey && passIndex > 0) {
          entries.push({ binding, kind: 'pass', passIndex: passIndex - 1 });
          continue;
        }
        const candidateKey = binding as TextureInputKey<I>;
        if (this.inputKeys.includes(candidateKey)) {
          entries.push({ binding, kind: 'input', key: candidateKey });
        }
      }
      sources.push(entries);
    }
    return sources;
  }

  protected ensurePassTexture(passIndex: number): GPUTextureView {
    const existing = this.passViews[passIndex];
    if (existing) {
      return existing;
    }
    const texture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const view = texture.createView();
    this.passTextures[passIndex] = texture;
    this.passViews[passIndex] = view;
    return view;
  }

  protected resolveInputs(): Partial<Record<TextureInputKey<I>, GPUTextureView>> {
    const resolved: Partial<Record<TextureInputKey<I>, GPUTextureView>> = {};
    for (const key of this.inputKeys) {
      const source = this.inputs[key];
      if (!source) {
        continue;
      }
      resolved[key] = resolveTexture(source);
    }
    return resolved;
  }

  protected applySourcesForPass(
    passIndex: number,
    resolvedInputs: Partial<Record<TextureInputKey<I>, GPUTextureView>>,
    passOutputs: Array<GPUTextureView | undefined>,
  ): void {
    const handles = this.passMaterials[passIndex];
    const bindings = this.passTextureSources[passIndex] ?? [];
    for (const binding of bindings) {
      let view: GPUTextureView | undefined;
      if (binding.kind === 'input') {
        view = resolvedInputs[binding.key];
      } else {
        view = passOutputs[binding.passIndex];
      }
      if (!view) {
        continue;
      }
      handles.setTexture(binding.binding, view);
    }
  }

  render(): void {
    const resolvedInputs = this.resolveInputs();
    this.updateUniforms();

    const encoder = this.device.createCommandEncoder();
    const passOutputs: Array<GPUTextureView | undefined> = [];

    for (let passIndex = 0; passIndex < this.passCount; passIndex += 1) {
      const isFinal = passIndex === this.passCount - 1;
      const outputView = isFinal ? this.output : this.ensurePassTexture(passIndex);

      this.applySourcesForPass(passIndex, resolvedInputs, passOutputs);

      const material = this.passMaterials[passIndex];
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: outputView,
            clearValue: this.clearColor,
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });

      pass.setPipeline(material.pipeline);
      pass.setBindGroup(0, material.bindGroup);
      pass.draw(3);
      pass.end();

      passOutputs[passIndex] = outputView;
    }

    this.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.outputTexture.destroy();
    for (const texture of this.passTextures) {
      texture?.destroy();
    }
  }
}
