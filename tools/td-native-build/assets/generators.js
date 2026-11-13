var avtoolsGenerators = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // tools/td-sketch-build/codegen.ts
  var codegen_exports = {};
  __export(codegen_exports, {
    generate: () => generate
  });

  // node_modules/.deno/wgsl_reflect@1.2.3/node_modules/wgsl_reflect/wgsl_reflect.module.js
  var e = class {
    constructor(e2, t2) {
      this.name = e2, this.attributes = t2, this.size = 0;
    }
    get isArray() {
      return false;
    }
    get isStruct() {
      return false;
    }
    get isTemplate() {
      return false;
    }
    get isPointer() {
      return false;
    }
    getTypeName() {
      return this.name;
    }
  };
  var t = class {
    constructor(e2, t2, n2) {
      this.name = e2, this.type = t2, this.attributes = n2, this.offset = 0, this.size = 0;
    }
    get isArray() {
      return this.type.isArray;
    }
    get isStruct() {
      return this.type.isStruct;
    }
    get isTemplate() {
      return this.type.isTemplate;
    }
    get align() {
      return this.type.isStruct ? this.type.align : 0;
    }
    get members() {
      return this.type.isStruct ? this.type.members : null;
    }
    get format() {
      return this.type.isArray || this.type.isTemplate ? this.type.format : null;
    }
    get count() {
      return this.type.isArray ? this.type.count : 0;
    }
    get stride() {
      return this.type.isArray ? this.type.stride : this.size;
    }
  };
  var n = class extends e {
    constructor(e2, t2) {
      super(e2, t2), this.members = [], this.align = 0, this.startLine = -1, this.endLine = -1, this.inUse = false;
    }
    get isStruct() {
      return true;
    }
  };
  var s = class extends e {
    constructor(e2, t2) {
      super(e2, t2), this.count = 0, this.stride = 0;
    }
    get isArray() {
      return true;
    }
    getTypeName() {
      return `array<${this.format.getTypeName()}, ${this.count}>`;
    }
  };
  var r = class extends e {
    constructor(e2, t2, n2) {
      super(e2, n2), this.format = t2;
    }
    get isPointer() {
      return true;
    }
    getTypeName() {
      return `&${this.format.getTypeName()}`;
    }
  };
  var a = class extends e {
    constructor(e2, t2, n2, s2) {
      super(e2, n2), this.format = t2, this.access = s2;
    }
    get isTemplate() {
      return true;
    }
    getTypeName() {
      let e2 = this.name;
      if (null !== this.format) {
        if ("vec2" === e2 || "vec3" === e2 || "vec4" === e2 || "mat2x2" === e2 || "mat2x3" === e2 || "mat2x4" === e2 || "mat3x2" === e2 || "mat3x3" === e2 || "mat3x4" === e2 || "mat4x2" === e2 || "mat4x3" === e2 || "mat4x4" === e2) {
          if ("f32" === this.format.name) return e2 += "f", e2;
          if ("i32" === this.format.name) return e2 += "i", e2;
          if ("u32" === this.format.name) return e2 += "u", e2;
          if ("bool" === this.format.name) return e2 += "b", e2;
          if ("f16" === this.format.name) return e2 += "h", e2;
        }
        e2 += `<${this.format.name}>`;
      } else if ("vec2" === e2 || "vec3" === e2 || "vec4" === e2) return e2;
      return e2;
    }
  };
  var i;
  ((e2) => {
    e2[e2.Uniform = 0] = "Uniform", e2[e2.Storage = 1] = "Storage", e2[e2.Texture = 2] = "Texture", e2[e2.Sampler = 3] = "Sampler", e2[e2.StorageTexture = 4] = "StorageTexture";
  })(i || (i = {}));
  var o = class {
    constructor(e2, t2, n2, s2, r2, a2, i2) {
      this.name = e2, this.type = t2, this.group = n2, this.binding = s2, this.attributes = r2, this.resourceType = a2, this.access = i2;
    }
    get isArray() {
      return this.type.isArray;
    }
    get isStruct() {
      return this.type.isStruct;
    }
    get isTemplate() {
      return this.type.isTemplate;
    }
    get size() {
      return this.type.size;
    }
    get align() {
      return this.type.isStruct ? this.type.align : 0;
    }
    get members() {
      return this.type.isStruct ? this.type.members : null;
    }
    get format() {
      return this.type.isArray || this.type.isTemplate ? this.type.format : null;
    }
    get count() {
      return this.type.isArray ? this.type.count : 0;
    }
    get stride() {
      return this.type.isArray ? this.type.stride : this.size;
    }
  };
  var c = class {
    constructor(e2, t2) {
      this.name = e2, this.type = t2;
    }
  };
  var l = class {
    constructor(e2, t2, n2, s2) {
      this.name = e2, this.type = t2, this.locationType = n2, this.location = s2, this.interpolation = null;
    }
  };
  var u = class {
    constructor(e2, t2, n2, s2) {
      this.name = e2, this.type = t2, this.locationType = n2, this.location = s2;
    }
  };
  var h = class {
    constructor(e2, t2, n2, s2) {
      this.name = e2, this.type = t2, this.attributes = n2, this.id = s2;
    }
  };
  var f = class {
    constructor(e2, t2, n2) {
      this.name = e2, this.type = t2, this.attributes = n2;
    }
  };
  var p = class {
    constructor(e2, t2 = null, n2) {
      this.stage = null, this.inputs = [], this.outputs = [], this.arguments = [], this.returnType = null, this.resources = [], this.overrides = [], this.startLine = -1, this.endLine = -1, this.inUse = false, this.calls = /* @__PURE__ */ new Set(), this.name = e2, this.stage = t2, this.attributes = n2;
    }
  };
  var d = class {
    constructor() {
      this.vertex = [], this.fragment = [], this.compute = [];
    }
  };
  function m(e2) {
    var t2 = (32768 & e2) >> 15, n2 = (31744 & e2) >> 10, s2 = 1023 & e2;
    return 0 == n2 ? (t2 ? -1 : 1) * Math.pow(2, -14) * (s2 / Math.pow(2, 10)) : 31 == n2 ? s2 ? NaN : 1 / 0 * (t2 ? -1 : 1) : (t2 ? -1 : 1) * Math.pow(2, n2 - 15) * (1 + s2 / Math.pow(2, 10));
  }
  var g = new Float32Array(1);
  var _ = new Int32Array(g.buffer);
  var x = new Uint16Array(1);
  function y(e2) {
    g[0] = e2;
    const t2 = _[0], n2 = t2 >> 31 & 1;
    let s2 = t2 >> 23 & 255, r2 = 8388607 & t2;
    if (255 === s2) return x[0] = n2 << 15 | 31744 | (0 !== r2 ? 512 : 0), x[0];
    if (0 === s2) {
      if (0 === r2) return x[0] = n2 << 15, x[0];
      r2 |= 8388608;
      let e3 = 113;
      for (; !(8388608 & r2); ) r2 <<= 1, e3--;
      return s2 = 127 - e3, r2 &= 8388607, s2 > 0 ? (r2 = (r2 >> 126 - s2) + (r2 >> 127 - s2 & 1), x[0] = n2 << 15 | s2 << 10 | r2 >> 13, x[0]) : (x[0] = n2 << 15, x[0]);
    }
    return s2 = s2 - 127 + 15, s2 >= 31 ? (x[0] = n2 << 15 | 31744, x[0]) : s2 <= 0 ? s2 < -10 ? (x[0] = n2 << 15, x[0]) : (r2 = (8388608 | r2) >> 1 - s2, x[0] = n2 << 15 | r2 >> 13, x[0]) : (r2 >>= 13, x[0] = n2 << 15 | s2 << 10 | r2, x[0]);
  }
  var b = new Uint32Array(1);
  var v = new Float32Array(b.buffer, 0, 1);
  function w(e2) {
    const t2 = 112 + (e2 >> 6 & 31) << 23 | (63 & e2) << 17;
    return b[0] = t2, v[0];
  }
  function k(e2, t2, n2, s2, r2, a2, i2, o2, c2) {
    const l2 = s2 * (i2 >>= r2) * (a2 >>= r2) + n2 * i2 + t2 * o2;
    switch (c2) {
      case "r8unorm":
        return [I(e2, l2, "8unorm", 1)[0]];
      case "r8snorm":
        return [I(e2, l2, "8snorm", 1)[0]];
      case "r8uint":
        return [I(e2, l2, "8uint", 1)[0]];
      case "r8sint":
        return [I(e2, l2, "8sint", 1)[0]];
      case "rg8unorm": {
        const t3 = I(e2, l2, "8unorm", 2);
        return [t3[0], t3[1]];
      }
      case "rg8snorm": {
        const t3 = I(e2, l2, "8snorm", 2);
        return [t3[0], t3[1]];
      }
      case "rg8uint": {
        const t3 = I(e2, l2, "8uint", 2);
        return [t3[0], t3[1]];
      }
      case "rg8sint": {
        const t3 = I(e2, l2, "8sint", 2);
        return [t3[0], t3[1]];
      }
      case "rgba8unorm-srgb":
      case "rgba8unorm": {
        const t3 = I(e2, l2, "8unorm", 4);
        return [t3[0], t3[1], t3[2], t3[3]];
      }
      case "rgba8snorm": {
        const t3 = I(e2, l2, "8snorm", 4);
        return [t3[0], t3[1], t3[2], t3[3]];
      }
      case "rgba8uint": {
        const t3 = I(e2, l2, "8uint", 4);
        return [t3[0], t3[1], t3[2], t3[3]];
      }
      case "rgba8sint": {
        const t3 = I(e2, l2, "8sint", 4);
        return [t3[0], t3[1], t3[2], t3[3]];
      }
      case "bgra8unorm-srgb":
      case "bgra8unorm": {
        const t3 = I(e2, l2, "8unorm", 4);
        return [t3[2], t3[1], t3[0], t3[3]];
      }
      case "r16uint":
        return [I(e2, l2, "16uint", 1)[0]];
      case "r16sint":
        return [I(e2, l2, "16sint", 1)[0]];
      case "r16float":
        return [I(e2, l2, "16float", 1)[0]];
      case "rg16uint": {
        const t3 = I(e2, l2, "16uint", 2);
        return [t3[0], t3[1]];
      }
      case "rg16sint": {
        const t3 = I(e2, l2, "16sint", 2);
        return [t3[0], t3[1]];
      }
      case "rg16float": {
        const t3 = I(e2, l2, "16float", 2);
        return [t3[0], t3[1]];
      }
      case "rgba16uint": {
        const t3 = I(e2, l2, "16uint", 4);
        return [t3[0], t3[1], t3[2], t3[3]];
      }
      case "rgba16sint": {
        const t3 = I(e2, l2, "16sint", 4);
        return [t3[0], t3[1], t3[2], t3[3]];
      }
      case "rgba16float": {
        const t3 = I(e2, l2, "16float", 4);
        return [t3[0], t3[1], t3[2], t3[3]];
      }
      case "r32uint":
        return [I(e2, l2, "32uint", 1)[0]];
      case "r32sint":
        return [I(e2, l2, "32sint", 1)[0]];
      case "depth16unorm":
      case "depth24plus":
      case "depth24plus-stencil8":
      case "depth32float":
      case "depth32float-stencil8":
      case "r32float":
        return [I(e2, l2, "32float", 1)[0]];
      case "rg32uint": {
        const t3 = I(e2, l2, "32uint", 2);
        return [t3[0], t3[1]];
      }
      case "rg32sint": {
        const t3 = I(e2, l2, "32sint", 2);
        return [t3[0], t3[1]];
      }
      case "rg32float": {
        const t3 = I(e2, l2, "32float", 2);
        return [t3[0], t3[1]];
      }
      case "rgba32uint": {
        const t3 = I(e2, l2, "32uint", 4);
        return [t3[0], t3[1], t3[2], t3[3]];
      }
      case "rgba32sint": {
        const t3 = I(e2, l2, "32sint", 4);
        return [t3[0], t3[1], t3[2], t3[3]];
      }
      case "rgba32float": {
        const t3 = I(e2, l2, "32float", 4);
        return [t3[0], t3[1], t3[2], t3[3]];
      }
      case "rg11b10ufloat": {
        const t3 = new Uint32Array(e2.buffer, l2, 1)[0], n3 = (4192256 & t3) >> 11, s3 = (4290772992 & t3) >> 22;
        return [w(2047 & t3), w(n3), (function(e3) {
          const t4 = 112 + (e3 >> 5 & 31) << 23 | (31 & e3) << 18;
          return b[0] = t4, v[0];
        })(s3), 1];
      }
    }
    return null;
  }
  function I(e2, t2, n2, s2) {
    const r2 = [0, 0, 0, 0];
    for (let a2 = 0; a2 < s2; ++a2) switch (n2) {
      case "8unorm":
        r2[a2] = e2[t2] / 255, t2++;
        break;
      case "8snorm":
        r2[a2] = e2[t2] / 255 * 2 - 1, t2++;
        break;
      case "8uint":
        r2[a2] = e2[t2], t2++;
        break;
      case "8sint":
        r2[a2] = e2[t2] - 127, t2++;
        break;
      case "16uint":
        r2[a2] = e2[t2] | e2[t2 + 1] << 8, t2 += 2;
        break;
      case "16sint":
        r2[a2] = (e2[t2] | e2[t2 + 1] << 8) - 32768, t2 += 2;
        break;
      case "16float":
        r2[a2] = m(e2[t2] | e2[t2 + 1] << 8), t2 += 2;
        break;
      case "32uint":
      case "32sint":
        r2[a2] = e2[t2] | e2[t2 + 1] << 8 | e2[t2 + 2] << 16 | e2[t2 + 3] << 24, t2 += 4;
        break;
      case "32float":
        r2[a2] = new Float32Array(e2.buffer, t2, 1)[0], t2 += 4;
    }
    return r2;
  }
  function T(e2, t2, n2, s2, r2) {
    for (let a2 = 0; a2 < s2; ++a2) switch (n2) {
      case "8unorm":
        e2[t2] = 255 * r2[a2], t2++;
        break;
      case "8snorm":
        e2[t2] = 0.5 * (r2[a2] + 1) * 255, t2++;
        break;
      case "8uint":
        e2[t2] = r2[a2], t2++;
        break;
      case "8sint":
        e2[t2] = r2[a2] + 127, t2++;
        break;
      case "16uint":
        new Uint16Array(e2.buffer, t2, 1)[0] = r2[a2], t2 += 2;
        break;
      case "16sint":
        new Int16Array(e2.buffer, t2, 1)[0] = r2[a2], t2 += 2;
        break;
      case "16float": {
        const n3 = y(r2[a2]);
        new Uint16Array(e2.buffer, t2, 1)[0] = n3, t2 += 2;
        break;
      }
      case "32uint":
        new Uint32Array(e2.buffer, t2, 1)[0] = r2[a2], t2 += 4;
        break;
      case "32sint":
        new Int32Array(e2.buffer, t2, 1)[0] = r2[a2], t2 += 4;
        break;
      case "32float":
        new Float32Array(e2.buffer, t2, 1)[0] = r2[a2], t2 += 4;
    }
    return r2;
  }
  var S = { r8unorm: { bytesPerBlock: 1, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 1 }, r8snorm: { bytesPerBlock: 1, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 1 }, r8uint: { bytesPerBlock: 1, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 1 }, r8sint: { bytesPerBlock: 1, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 1 }, rg8unorm: { bytesPerBlock: 2, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 2 }, rg8snorm: { bytesPerBlock: 2, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 2 }, rg8uint: { bytesPerBlock: 2, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 2 }, rg8sint: { bytesPerBlock: 2, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 2 }, rgba8unorm: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, "rgba8unorm-srgb": { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, rgba8snorm: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, rgba8uint: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, rgba8sint: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, bgra8unorm: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, "bgra8unorm-srgb": { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, r16uint: { bytesPerBlock: 2, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 1 }, r16sint: { bytesPerBlock: 2, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 1 }, r16float: { bytesPerBlock: 2, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 1 }, rg16uint: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 2 }, rg16sint: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 2 }, rg16float: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 2 }, rgba16uint: { bytesPerBlock: 8, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, rgba16sint: { bytesPerBlock: 8, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, rgba16float: { bytesPerBlock: 8, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, r32uint: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 1 }, r32sint: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 1 }, r32float: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 1 }, rg32uint: { bytesPerBlock: 8, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 2 }, rg32sint: { bytesPerBlock: 8, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 2 }, rg32float: { bytesPerBlock: 8, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 2 }, rgba32uint: { bytesPerBlock: 16, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, rgba32sint: { bytesPerBlock: 16, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, rgba32float: { bytesPerBlock: 16, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, rgb10a2uint: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, rgb10a2unorm: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, rg11b10ufloat: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, stencil8: { bytesPerBlock: 1, blockWidth: 1, blockHeight: 1, isCompressed: false, isDepthStencil: true, hasDepth: false, hasStencil: true, channels: 1 }, depth16unorm: { bytesPerBlock: 2, blockWidth: 1, blockHeight: 1, isCompressed: false, isDepthStencil: true, hasDepth: true, hasStencil: false, channels: 1 }, depth24plus: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, isDepthStencil: true, hasDepth: true, hasStencil: false, depthOnlyFormat: "depth32float", channels: 1 }, "depth24plus-stencil8": { bytesPerBlock: 8, blockWidth: 1, blockHeight: 1, isCompressed: false, isDepthStencil: true, hasDepth: true, hasStencil: true, depthOnlyFormat: "depth32float", channels: 1 }, depth32float: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, isDepthStencil: true, hasDepth: true, hasStencil: false, channels: 1 }, "depth32float-stencil8": { bytesPerBlock: 8, blockWidth: 1, blockHeight: 1, isCompressed: false, isDepthStencil: true, hasDepth: true, hasStencil: true, stencilOnlyFormat: "depth32float", channels: 1 }, rgb9e5ufloat: { bytesPerBlock: 4, blockWidth: 1, blockHeight: 1, isCompressed: false, channels: 4 }, "bc1-rgba-unorm": { bytesPerBlock: 8, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "bc1-rgba-unorm-srgb": { bytesPerBlock: 8, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "bc2-rgba-unorm": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "bc2-rgba-unorm-srgb": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "bc3-rgba-unorm": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "bc3-rgba-unorm-srgb": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "bc4-r-unorm": { bytesPerBlock: 8, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 1 }, "bc4-r-snorm": { bytesPerBlock: 8, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 1 }, "bc5-rg-unorm": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 2 }, "bc5-rg-snorm": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 2 }, "bc6h-rgb-ufloat": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "bc6h-rgb-float": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "bc7-rgba-unorm": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "bc7-rgba-unorm-srgb": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "etc2-rgb8unorm": { bytesPerBlock: 8, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "etc2-rgb8unorm-srgb": { bytesPerBlock: 8, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "etc2-rgb8a1unorm": { bytesPerBlock: 8, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "etc2-rgb8a1unorm-srgb": { bytesPerBlock: 8, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "etc2-rgba8unorm": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "etc2-rgba8unorm-srgb": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "eac-r11unorm": { bytesPerBlock: 8, blockWidth: 1, blockHeight: 1, isCompressed: true, channels: 1 }, "eac-r11snorm": { bytesPerBlock: 8, blockWidth: 1, blockHeight: 1, isCompressed: true, channels: 1 }, "eac-rg11unorm": { bytesPerBlock: 16, blockWidth: 1, blockHeight: 1, isCompressed: true, channels: 2 }, "eac-rg11snorm": { bytesPerBlock: 16, blockWidth: 1, blockHeight: 1, isCompressed: true, channels: 2 }, "astc-4x4-unorm": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "astc-4x4-unorm-srgb": { bytesPerBlock: 16, blockWidth: 4, blockHeight: 4, isCompressed: true, channels: 4 }, "astc-5x4-unorm": { bytesPerBlock: 16, blockWidth: 5, blockHeight: 4, isCompressed: true, channels: 4 }, "astc-5x4-unorm-srgb": { bytesPerBlock: 16, blockWidth: 5, blockHeight: 4, isCompressed: true, channels: 4 }, "astc-5x5-unorm": { bytesPerBlock: 16, blockWidth: 5, blockHeight: 5, isCompressed: true, channels: 4 }, "astc-5x5-unorm-srgb": { bytesPerBlock: 16, blockWidth: 5, blockHeight: 5, isCompressed: true, channels: 4 }, "astc-6x5-unorm": { bytesPerBlock: 16, blockWidth: 6, blockHeight: 5, isCompressed: true, channels: 4 }, "astc-6x5-unorm-srgb": { bytesPerBlock: 16, blockWidth: 6, blockHeight: 5, isCompressed: true, channels: 4 }, "astc-6x6-unorm": { bytesPerBlock: 16, blockWidth: 6, blockHeight: 6, isCompressed: true, channels: 4 }, "astc-6x6-unorm-srgb": { bytesPerBlock: 16, blockWidth: 6, blockHeight: 6, isCompressed: true, channels: 4 }, "astc-8x5-unorm": { bytesPerBlock: 16, blockWidth: 8, blockHeight: 5, isCompressed: true, channels: 4 }, "astc-8x5-unorm-srgb": { bytesPerBlock: 16, blockWidth: 8, blockHeight: 5, isCompressed: true, channels: 4 }, "astc-8x6-unorm": { bytesPerBlock: 16, blockWidth: 8, blockHeight: 6, isCompressed: true, channels: 4 }, "astc-8x6-unorm-srgb": { bytesPerBlock: 16, blockWidth: 8, blockHeight: 6, isCompressed: true, channels: 4 }, "astc-8x8-unorm": { bytesPerBlock: 16, blockWidth: 8, blockHeight: 8, isCompressed: true, channels: 4 }, "astc-8x8-unorm-srgb": { bytesPerBlock: 16, blockWidth: 8, blockHeight: 8, isCompressed: true, channels: 4 }, "astc-10x5-unorm": { bytesPerBlock: 16, blockWidth: 10, blockHeight: 5, isCompressed: true, channels: 4 }, "astc-10x5-unorm-srgb": { bytesPerBlock: 16, blockWidth: 10, blockHeight: 5, isCompressed: true, channels: 4 }, "astc-10x6-unorm": { bytesPerBlock: 16, blockWidth: 10, blockHeight: 6, isCompressed: true, channels: 4 }, "astc-10x6-unorm-srgb": { bytesPerBlock: 16, blockWidth: 10, blockHeight: 6, isCompressed: true, channels: 4 }, "astc-10x8-unorm": { bytesPerBlock: 16, blockWidth: 10, blockHeight: 8, isCompressed: true, channels: 4 }, "astc-10x8-unorm-srgb": { bytesPerBlock: 16, blockWidth: 10, blockHeight: 8, isCompressed: true, channels: 4 }, "astc-10x10-unorm": { bytesPerBlock: 16, blockWidth: 10, blockHeight: 10, isCompressed: true, channels: 4 }, "astc-10x10-unorm-srgb": { bytesPerBlock: 16, blockWidth: 10, blockHeight: 10, isCompressed: true, channels: 4 }, "astc-12x10-unorm": { bytesPerBlock: 16, blockWidth: 12, blockHeight: 10, isCompressed: true, channels: 4 }, "astc-12x10-unorm-srgb": { bytesPerBlock: 16, blockWidth: 12, blockHeight: 10, isCompressed: true, channels: 4 }, "astc-12x12-unorm": { bytesPerBlock: 16, blockWidth: 12, blockHeight: 12, isCompressed: true, channels: 4 }, "astc-12x12-unorm-srgb": { bytesPerBlock: 16, blockWidth: 12, blockHeight: 12, isCompressed: true, channels: 4 } };
  var A = class _A {
    constructor() {
      this.id = _A._id++, this.line = 0;
    }
    get isAstNode() {
      return true;
    }
    get astNodeType() {
      return "";
    }
    search(e2) {
      e2(this);
    }
    searchBlock(e2, t2) {
      if (e2) {
        t2(E.instance);
        for (const n2 of e2) n2 instanceof Array ? this.searchBlock(n2, t2) : n2.search(t2);
        t2($.instance);
      }
    }
    constEvaluate(e2, t2) {
      throw new Error("Cannot evaluate node");
    }
    constEvaluateString(e2) {
      return this.constEvaluate(e2).toString();
    }
  };
  A._id = 0;
  var E = class extends A {
  };
  E.instance = new E();
  var $ = class extends A {
  };
  $.instance = new $();
  var L = /* @__PURE__ */ new Set(["all", "all", "any", "select", "arrayLength", "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "atan2", "ceil", "clamp", "cos", "cosh", "countLeadingZeros", "countOneBits", "countTrailingZeros", "cross", "degrees", "determinant", "distance", "dot", "dot4U8Packed", "dot4I8Packed", "exp", "exp2", "extractBits", "faceForward", "firstLeadingBit", "firstTrailingBit", "floor", "fma", "fract", "frexp", "insertBits", "inverseSqrt", "ldexp", "length", "log", "log2", "max", "min", "mix", "modf", "normalize", "pow", "quantizeToF16", "radians", "reflect", "refract", "reverseBits", "round", "saturate", "sign", "sin", "sinh", "smoothStep", "sqrt", "step", "tan", "tanh", "transpose", "trunc", "dpdx", "dpdxCoarse", "dpdxFine", "dpdy", "dpdyCoarse", "dpdyFine", "fwidth", "fwidthCoarse", "fwidthFine", "textureDimensions", "textureGather", "textureGatherCompare", "textureLoad", "textureNumLayers", "textureNumLevels", "textureNumSamples", "textureSample", "textureSampleBias", "textureSampleCompare", "textureSampleCompareLevel", "textureSampleGrad", "textureSampleLevel", "textureSampleBaseClampToEdge", "textureStore", "atomicLoad", "atomicStore", "atomicAdd", "atomicSub", "atomicMax", "atomicMin", "atomicAnd", "atomicOr", "atomicXor", "atomicExchange", "atomicCompareExchangeWeak", "pack4x8snorm", "pack4x8unorm", "pack4xI8", "pack4xU8", "pack4x8Clamp", "pack4xU8Clamp", "pack2x16snorm", "pack2x16unorm", "pack2x16float", "unpack4x8snorm", "unpack4x8unorm", "unpack4xI8", "unpack4xU8", "unpack2x16snorm", "unpack2x16unorm", "unpack2x16float", "storageBarrier", "textureBarrier", "workgroupBarrier", "workgroupUniformLoad", "subgroupAdd", "subgroupExclusiveAdd", "subgroupInclusiveAdd", "subgroupAll", "subgroupAnd", "subgroupAny", "subgroupBallot", "subgroupBroadcast", "subgroupBroadcastFirst", "subgroupElect", "subgroupMax", "subgroupMin", "subgroupMul", "subgroupExclusiveMul", "subgroupInclusiveMul", "subgroupOr", "subgroupShuffle", "subgroupShuffleDown", "subgroupShuffleUp", "subgroupShuffleXor", "subgroupXor", "quadBroadcast", "quadSwapDiagonal", "quadSwapX", "quadSwapY"]);
  var C = class extends A {
    constructor() {
      super();
    }
  };
  var D = class extends C {
    constructor(e2, t2, n2, s2, r2, a2) {
      super(), this.calls = /* @__PURE__ */ new Set(), this.name = e2, this.args = t2, this.returnType = n2, this.body = s2, this.startLine = r2, this.endLine = a2;
    }
    get astNodeType() {
      return "function";
    }
    search(e2) {
      if (this.attributes) for (const t2 of this.attributes) e2(t2);
      e2(this);
      for (const t2 of this.args) e2(t2);
      this.searchBlock(this.body, e2);
    }
  };
  var N = class extends C {
    constructor(e2) {
      super(), this.expression = e2;
    }
    get astNodeType() {
      return "staticAssert";
    }
    search(e2) {
      this.expression.search(e2);
    }
  };
  var V = class extends C {
    constructor(e2, t2) {
      super(), this.condition = e2, this.body = t2;
    }
    get astNodeType() {
      return "while";
    }
    search(e2) {
      this.condition.search(e2), this.searchBlock(this.body, e2);
    }
  };
  var O = class extends C {
    constructor(e2, t2) {
      super(), this.body = e2, this.loopId = t2;
    }
    get astNodeType() {
      return "continuing";
    }
    search(e2) {
      this.searchBlock(this.body, e2);
    }
  };
  var B = class extends C {
    constructor(e2, t2, n2, s2) {
      super(), this.init = e2, this.condition = t2, this.increment = n2, this.body = s2;
    }
    get astNodeType() {
      return "for";
    }
    search(e2) {
      var t2, n2, s2;
      null === (t2 = this.init) || void 0 === t2 || t2.search(e2), null === (n2 = this.condition) || void 0 === n2 || n2.search(e2), null === (s2 = this.increment) || void 0 === s2 || s2.search(e2), this.searchBlock(this.body, e2);
    }
  };
  var F = class extends C {
    constructor(e2, t2, n2, s2, r2) {
      super(), this.attributes = null, this.name = e2, this.type = t2, this.storage = n2, this.access = s2, this.value = r2;
    }
    get astNodeType() {
      return "var";
    }
    search(e2) {
      var t2;
      e2(this), null === (t2 = this.value) || void 0 === t2 || t2.search(e2);
    }
  };
  var M = class extends C {
    constructor(e2, t2, n2) {
      super(), this.attributes = null, this.name = e2, this.type = t2, this.value = n2;
    }
    get astNodeType() {
      return "override";
    }
    search(e2) {
      var t2;
      null === (t2 = this.value) || void 0 === t2 || t2.search(e2);
    }
  };
  var U = class extends C {
    constructor(e2, t2, n2, s2, r2) {
      super(), this.attributes = null, this.name = e2, this.type = t2, this.storage = n2, this.access = s2, this.value = r2;
    }
    get astNodeType() {
      return "let";
    }
    search(e2) {
      var t2;
      e2(this), null === (t2 = this.value) || void 0 === t2 || t2.search(e2);
    }
  };
  var P = class extends C {
    constructor(e2, t2, n2, s2, r2) {
      super(), this.attributes = null, this.name = e2, this.type = t2, this.storage = n2, this.access = s2, this.value = r2;
    }
    get astNodeType() {
      return "const";
    }
    constEvaluate(e2, t2) {
      return this.value.constEvaluate(e2, t2);
    }
    search(e2) {
      var t2;
      e2(this), null === (t2 = this.value) || void 0 === t2 || t2.search(e2);
    }
  };
  var W;
  var q;
  var H;
  var z;
  ((e2) => {
    e2.increment = "++", e2.decrement = "--";
  })(W || (W = {})), ((e2) => {
    e2.parse = function(t2) {
      const n2 = t2;
      if ("parse" == n2) throw new Error("Invalid value for IncrementOperator");
      return e2[n2];
    };
  })(W || (W = {}));
  var R = class extends C {
    constructor(e2, t2) {
      super(), this.operator = e2, this.variable = t2;
    }
    get astNodeType() {
      return "increment";
    }
    search(e2) {
      this.variable.search(e2);
    }
  };
  ((e2) => {
    e2.assign = "=", e2.addAssign = "+=", e2.subtractAssin = "-=", e2.multiplyAssign = "*=", e2.divideAssign = "/=", e2.moduloAssign = "%=", e2.andAssign = "&=", e2.orAssign = "|=", e2.xorAssign = "^=", e2.shiftLeftAssign = "<<=", e2.shiftRightAssign = ">>=";
  })(q || (q = {})), ((e2) => {
    e2.parse = function(e3) {
      const t2 = e3;
      if ("parse" == t2) throw new Error("Invalid value for AssignOperator");
      return t2;
    };
  })(q || (q = {}));
  var G = class extends C {
    constructor(e2, t2, n2) {
      super(), this.operator = e2, this.variable = t2, this.value = n2;
    }
    get astNodeType() {
      return "assign";
    }
    search(e2) {
      this.variable.search(e2), this.value.search(e2);
    }
  };
  var X = class extends C {
    constructor(e2, t2) {
      super(), this.name = e2, this.args = t2;
    }
    get astNodeType() {
      return "call";
    }
    isBuiltin() {
      return L.has(this.name);
    }
    search(e2) {
      for (const t2 of this.args) t2.search(e2);
      e2(this);
    }
  };
  var j = class extends C {
    constructor(e2, t2) {
      super(), this.body = e2, this.continuing = t2;
    }
    get astNodeType() {
      return "loop";
    }
    search(e2) {
      var t2;
      this.searchBlock(this.body, e2), null === (t2 = this.continuing) || void 0 === t2 || t2.search(e2);
    }
  };
  var Z = class extends C {
    constructor(e2, t2) {
      super(), this.condition = e2, this.cases = t2;
    }
    get astNodeType() {
      return "switch";
    }
    search(e2) {
      e2(this);
      for (const t2 of this.cases) t2.search(e2);
    }
  };
  var Q = class extends C {
    constructor(e2, t2, n2, s2) {
      super(), this.condition = e2, this.body = t2, this.elseif = n2, this.else = s2;
    }
    get astNodeType() {
      return "if";
    }
    search(e2) {
      this.condition.search(e2), this.searchBlock(this.body, e2), this.searchBlock(this.elseif, e2), this.searchBlock(this.else, e2);
    }
  };
  var Y = class extends C {
    constructor(e2) {
      super(), this.value = e2;
    }
    get astNodeType() {
      return "return";
    }
    search(e2) {
      var t2;
      null === (t2 = this.value) || void 0 === t2 || t2.search(e2);
    }
  };
  var K = class extends C {
    constructor(e2) {
      super(), this.name = e2;
    }
    get astNodeType() {
      return "enable";
    }
  };
  var J = class extends C {
    constructor(e2) {
      super(), this.extensions = e2;
    }
    get astNodeType() {
      return "requires";
    }
  };
  var ee = class extends C {
    constructor(e2, t2) {
      super(), this.severity = e2, this.rule = t2;
    }
    get astNodeType() {
      return "diagnostic";
    }
  };
  var te = class extends C {
    constructor(e2, t2) {
      super(), this.name = e2, this.type = t2;
    }
    get astNodeType() {
      return "alias";
    }
  };
  var ne = class extends C {
    constructor() {
      super();
    }
    get astNodeType() {
      return "discard";
    }
  };
  var se = class extends C {
    constructor() {
      super(), this.condition = null, this.loopId = -1;
    }
    get astNodeType() {
      return "break";
    }
  };
  var re = class extends C {
    constructor() {
      super(), this.loopId = -1;
    }
    get astNodeType() {
      return "continue";
    }
  };
  var ae = class _ae extends C {
    constructor(e2) {
      super(), this.attributes = null, this.name = e2;
    }
    get astNodeType() {
      return "type";
    }
    get isStruct() {
      return false;
    }
    get isArray() {
      return false;
    }
    static maxFormatType(e2) {
      let t2 = e2[0];
      if ("f32" === t2.name) return t2;
      for (let n2 = 1; n2 < e2.length; ++n2) {
        const s2 = _ae._priority.get(t2.name);
        _ae._priority.get(e2[n2].name) < s2 && (t2 = e2[n2]);
      }
      return "x32" === t2.name ? _ae.i32 : t2;
    }
    getTypeName() {
      return this.name;
    }
  };
  ae.x32 = new ae("x32"), ae.f32 = new ae("f32"), ae.i32 = new ae("i32"), ae.u32 = new ae("u32"), ae.f16 = new ae("f16"), ae.bool = new ae("bool"), ae.void = new ae("void"), ae._priority = /* @__PURE__ */ new Map([["f32", 0], ["f16", 1], ["u32", 2], ["i32", 3], ["x32", 3]]);
  var ie = class extends ae {
    constructor(e2) {
      super(e2);
    }
  };
  var oe = class extends ae {
    constructor(e2, t2, n2, s2) {
      super(e2), this.members = t2, this.startLine = n2, this.endLine = s2;
    }
    get astNodeType() {
      return "struct";
    }
    get isStruct() {
      return true;
    }
    getMemberIndex(e2) {
      for (let t2 = 0; t2 < this.members.length; t2++) if (this.members[t2].name == e2) return t2;
      return -1;
    }
    search(e2) {
      for (const t2 of this.members) e2(t2);
    }
  };
  var ce = class extends ae {
    constructor(e2, t2, n2) {
      super(e2), this.format = t2, this.access = n2;
    }
    get astNodeType() {
      return "template";
    }
    getTypeName() {
      let e2 = this.name;
      if (null !== this.format) {
        if ("vec2" === e2 || "vec3" === e2 || "vec4" === e2 || "mat2x2" === e2 || "mat2x3" === e2 || "mat2x4" === e2 || "mat3x2" === e2 || "mat3x3" === e2 || "mat3x4" === e2 || "mat4x2" === e2 || "mat4x3" === e2 || "mat4x4" === e2) {
          if ("f32" === this.format.name) return e2 += "f", e2;
          if ("i32" === this.format.name) return e2 += "i", e2;
          if ("u32" === this.format.name) return e2 += "u", e2;
          if ("bool" === this.format.name) return e2 += "b", e2;
          if ("f16" === this.format.name) return e2 += "h", e2;
        }
        e2 += `<${this.format.name}>`;
      } else if ("vec2" === e2 || "vec3" === e2 || "vec4" === e2) return e2;
      return e2;
    }
  };
  ce.vec2f = new ce("vec2", ae.f32, null), ce.vec3f = new ce("vec3", ae.f32, null), ce.vec4f = new ce("vec4", ae.f32, null), ce.vec2i = new ce("vec2", ae.i32, null), ce.vec3i = new ce("vec3", ae.i32, null), ce.vec4i = new ce("vec4", ae.i32, null), ce.vec2u = new ce("vec2", ae.u32, null), ce.vec3u = new ce("vec3", ae.u32, null), ce.vec4u = new ce("vec4", ae.u32, null), ce.vec2h = new ce("vec2", ae.f16, null), ce.vec3h = new ce("vec3", ae.f16, null), ce.vec4h = new ce("vec4", ae.f16, null), ce.vec2b = new ce("vec2", ae.bool, null), ce.vec3b = new ce("vec3", ae.bool, null), ce.vec4b = new ce("vec4", ae.bool, null), ce.mat2x2f = new ce("mat2x2", ae.f32, null), ce.mat2x3f = new ce("mat2x3", ae.f32, null), ce.mat2x4f = new ce("mat2x4", ae.f32, null), ce.mat3x2f = new ce("mat3x2", ae.f32, null), ce.mat3x3f = new ce("mat3x3", ae.f32, null), ce.mat3x4f = new ce("mat3x4", ae.f32, null), ce.mat4x2f = new ce("mat4x2", ae.f32, null), ce.mat4x3f = new ce("mat4x3", ae.f32, null), ce.mat4x4f = new ce("mat4x4", ae.f32, null), ce.mat2x2h = new ce("mat2x2", ae.f16, null), ce.mat2x3h = new ce("mat2x3", ae.f16, null), ce.mat2x4h = new ce("mat2x4", ae.f16, null), ce.mat3x2h = new ce("mat3x2", ae.f16, null), ce.mat3x3h = new ce("mat3x3", ae.f16, null), ce.mat3x4h = new ce("mat3x4", ae.f16, null), ce.mat4x2h = new ce("mat4x2", ae.f16, null), ce.mat4x3h = new ce("mat4x3", ae.f16, null), ce.mat4x4h = new ce("mat4x4", ae.f16, null), ce.mat2x2i = new ce("mat2x2", ae.i32, null), ce.mat2x3i = new ce("mat2x3", ae.i32, null), ce.mat2x4i = new ce("mat2x4", ae.i32, null), ce.mat3x2i = new ce("mat3x2", ae.i32, null), ce.mat3x3i = new ce("mat3x3", ae.i32, null), ce.mat3x4i = new ce("mat3x4", ae.i32, null), ce.mat4x2i = new ce("mat4x2", ae.i32, null), ce.mat4x3i = new ce("mat4x3", ae.i32, null), ce.mat4x4i = new ce("mat4x4", ae.i32, null), ce.mat2x2u = new ce("mat2x2", ae.u32, null), ce.mat2x3u = new ce("mat2x3", ae.u32, null), ce.mat2x4u = new ce("mat2x4", ae.u32, null), ce.mat3x2u = new ce("mat3x2", ae.u32, null), ce.mat3x3u = new ce("mat3x3", ae.u32, null), ce.mat3x4u = new ce("mat3x4", ae.u32, null), ce.mat4x2u = new ce("mat4x2", ae.u32, null), ce.mat4x3u = new ce("mat4x3", ae.u32, null), ce.mat4x4u = new ce("mat4x4", ae.u32, null);
  var le = class extends ae {
    constructor(e2, t2, n2, s2) {
      super(e2), this.storage = t2, this.type = n2, this.access = s2;
    }
    get astNodeType() {
      return "pointer";
    }
  };
  var ue = class extends ae {
    constructor(e2, t2, n2, s2) {
      super(e2), this.attributes = t2, this.format = n2, this.count = s2;
    }
    get astNodeType() {
      return "array";
    }
    get isArray() {
      return true;
    }
  };
  var he = class extends ae {
    constructor(e2, t2, n2) {
      super(e2), this.format = t2, this.access = n2;
    }
    get astNodeType() {
      return "sampler";
    }
  };
  var fe = class extends A {
    constructor() {
      super(), this.postfix = null;
    }
  };
  var pe = class extends fe {
    constructor(e2) {
      super(), this.value = e2;
    }
    get astNodeType() {
      return "stringExpr";
    }
    toString() {
      return this.value;
    }
    constEvaluateString() {
      return this.value;
    }
  };
  var de = class extends fe {
    constructor(e2, t2) {
      super(), this.type = e2, this.args = t2;
    }
    get astNodeType() {
      return "createExpr";
    }
    search(e2) {
      if (e2(this), this.args) for (const t2 of this.args) t2.search(e2);
    }
    constEvaluate(e2, t2) {
      return t2 && (t2[0] = this.type), e2.evalExpression(this, e2.context);
    }
  };
  var me = class extends fe {
    constructor(e2, t2) {
      super(), this.cachedReturnValue = null, this.name = e2, this.args = t2;
    }
    get astNodeType() {
      return "callExpr";
    }
    setCachedReturnValue(e2) {
      this.cachedReturnValue = e2;
    }
    get isBuiltin() {
      return L.has(this.name);
    }
    constEvaluate(e2, t2) {
      return e2.evalExpression(this, e2.context);
    }
    search(e2) {
      for (const t2 of this.args) t2.search(e2);
      e2(this);
    }
  };
  var ge = class extends fe {
    constructor(e2) {
      super(), this.name = e2;
    }
    get astNodeType() {
      return "varExpr";
    }
    search(e2) {
      e2(this), this.postfix && this.postfix.search(e2);
    }
    constEvaluate(e2, t2) {
      return e2.evalExpression(this, e2.context);
    }
  };
  var _e = class extends fe {
    constructor(e2, t2) {
      super(), this.name = e2, this.initializer = t2;
    }
    get astNodeType() {
      return "constExpr";
    }
    constEvaluate(e2, t2) {
      if (this.initializer) {
        const t3 = e2.evalExpression(this.initializer, e2.context);
        return null !== t3 && this.postfix ? t3.getSubData(e2, this.postfix, e2.context) : t3;
      }
      return null;
    }
    search(e2) {
      this.initializer.search(e2);
    }
  };
  var xe = class extends fe {
    constructor(e2, t2) {
      super(), this.value = e2, this.type = t2;
    }
    get astNodeType() {
      return "literalExpr";
    }
    constEvaluate(e2, t2) {
      return void 0 !== t2 && (t2[0] = this.type), this.value;
    }
    get isScalar() {
      return this.value instanceof Be;
    }
    get isVector() {
      return this.value instanceof Me || this.value instanceof Ue;
    }
    get scalarValue() {
      return this.value instanceof Be ? this.value.value : (console.error("Value is not scalar."), 0);
    }
    get vectorValue() {
      return this.value instanceof Me || this.value instanceof Ue ? this.value.data : (console.error("Value is not a vector or matrix."), new Float32Array(0));
    }
  };
  var ye = class extends fe {
    constructor(e2, t2) {
      super(), this.type = e2, this.value = t2;
    }
    get astNodeType() {
      return "bitcastExpr";
    }
    search(e2) {
      this.value.search(e2);
    }
  };
  var ve = class extends fe {
    constructor(e2) {
      super(), this.index = e2;
    }
    search(e2) {
      this.index.search(e2);
    }
  };
  var we = class extends fe {
    constructor() {
      super();
    }
  };
  var ke = class extends we {
    constructor(e2, t2) {
      super(), this.operator = e2, this.right = t2;
    }
    get astNodeType() {
      return "unaryOp";
    }
    constEvaluate(e2, t2) {
      return e2.evalExpression(this, e2.context);
    }
    search(e2) {
      this.right.search(e2);
    }
  };
  var Ie = class extends we {
    constructor(e2, t2, n2) {
      super(), this.operator = e2, this.left = t2, this.right = n2;
    }
    get astNodeType() {
      return "binaryOp";
    }
    _getPromotedType(e2, t2) {
      return e2.name === t2.name ? e2 : "f32" === e2.name || "f32" === t2.name ? ae.f32 : "u32" === e2.name || "u32" === t2.name ? ae.u32 : ae.i32;
    }
    constEvaluate(e2, t2) {
      return e2.evalExpression(this, e2.context);
    }
    search(e2) {
      this.left.search(e2), this.right.search(e2);
    }
  };
  var Te = class extends A {
    constructor(e2) {
      super(), this.body = e2;
    }
    search(e2) {
      e2(this), this.searchBlock(this.body, e2);
    }
  };
  var Se = class extends fe {
    constructor() {
      super();
    }
    get astNodeType() {
      return "default";
    }
  };
  var Ae = class extends Te {
    constructor(e2, t2) {
      super(t2), this.selectors = e2;
    }
    get astNodeType() {
      return "case";
    }
    search(e2) {
      this.searchBlock(this.body, e2);
    }
  };
  var Ee = class extends Te {
    constructor(e2) {
      super(e2);
    }
    get astNodeType() {
      return "default";
    }
    search(e2) {
      this.searchBlock(this.body, e2);
    }
  };
  var $e = class extends A {
    constructor(e2, t2, n2) {
      super(), this.name = e2, this.type = t2, this.attributes = n2;
    }
    get astNodeType() {
      return "argument";
    }
  };
  var Le = class extends A {
    constructor(e2, t2) {
      super(), this.condition = e2, this.body = t2;
    }
    get astNodeType() {
      return "elseif";
    }
    search(e2) {
      this.condition.search(e2), this.searchBlock(this.body, e2);
    }
  };
  var Ce = class extends A {
    constructor(e2, t2, n2) {
      super(), this.name = e2, this.type = t2, this.attributes = n2;
    }
    get astNodeType() {
      return "member";
    }
  };
  var De = class extends A {
    constructor(e2, t2) {
      super(), this.name = e2, this.value = t2;
    }
    get astNodeType() {
      return "attribute";
    }
  };
  var Ne = class _Ne {
    constructor(e2, t2) {
      this.parent = null, this.typeInfo = e2, this.parent = t2, this.id = _Ne._id++;
    }
    clone() {
      throw `Clone: Not implemented for ${this.constructor.name}`;
    }
    setDataValue(e2, t2, n2, s2) {
      console.error(`SetDataValue: Not implemented for ${this.constructor.name}`);
    }
    getSubData(e2, t2, n2) {
      return console.error(`GetDataValue: Not implemented for ${this.constructor.name}`), null;
    }
    toString() {
      return `<${this.typeInfo.getTypeName()}>`;
    }
  };
  Ne._id = 0;
  var Ve = class extends Ne {
    constructor() {
      super(new e("void", null), null);
    }
    toString() {
      return "void";
    }
  };
  Ve.void = new Ve();
  var Oe = class extends Ne {
    constructor(e2) {
      super(new r("pointer", e2.typeInfo, null), null), this.reference = e2;
    }
    clone() {
      return this;
    }
    setDataValue(e2, t2, n2, s2) {
      this.reference.setDataValue(e2, t2, n2, s2);
    }
    getSubData(e2, t2, n2) {
      return t2 ? this.reference.getSubData(e2, t2, n2) : this;
    }
    toString() {
      return `&${this.reference.toString()}`;
    }
  };
  var Be = class _Be extends Ne {
    constructor(e2, t2, n2 = null) {
      super(t2, n2), e2 instanceof Int32Array || e2 instanceof Uint32Array || e2 instanceof Float32Array ? this.data = e2 : "x32" === this.typeInfo.name ? e2 - Math.floor(e2) !== 0 ? this.data = new Float32Array([e2]) : this.data = e2 >= 0 ? new Uint32Array([e2]) : new Int32Array([e2]) : "i32" === this.typeInfo.name || "bool" === this.typeInfo.name ? this.data = new Int32Array([e2]) : "u32" === this.typeInfo.name ? this.data = new Uint32Array([e2]) : "f32" === this.typeInfo.name || "f16" === this.typeInfo.name ? this.data = new Float32Array([e2]) : console.error("ScalarData2: Invalid type", t2);
    }
    clone() {
      if (this.data instanceof Float32Array) return new _Be(new Float32Array(this.data), this.typeInfo, null);
      if (this.data instanceof Int32Array) return new _Be(new Int32Array(this.data), this.typeInfo, null);
      if (this.data instanceof Uint32Array) return new _Be(new Uint32Array(this.data), this.typeInfo, null);
      throw "ScalarData: Invalid data type";
    }
    get value() {
      return this.data[0];
    }
    set value(e2) {
      this.data[0] = e2;
    }
    setDataValue(e2, t2, n2, s2) {
      if (n2) return void console.error("SetDataValue: Scalar data does not support postfix", n2);
      if (!(t2 instanceof _Be)) return void console.error("SetDataValue: Invalid value", t2);
      let r2 = t2.data[0];
      "i32" === this.typeInfo.name || "u32" === this.typeInfo.name ? r2 = Math.floor(r2) : "bool" === this.typeInfo.name && (r2 = r2 ? 1 : 0), this.data[0] = r2;
    }
    getSubData(e2, t2, n2) {
      return t2 ? (console.error("getSubData: Scalar data does not support postfix", t2), null) : this;
    }
    toString() {
      return `${this.value}`;
    }
  };
  function Fe(e2, t2, n2) {
    const s2 = t2.length;
    return 2 === s2 ? "f32" === n2 ? new Me(new Float32Array(t2), e2.getTypeInfo("vec2f")) : "i32" === n2 || "bool" === n2 ? new Me(new Int32Array(t2), e2.getTypeInfo("vec2i")) : "u32" === n2 ? new Me(new Uint32Array(t2), e2.getTypeInfo("vec2u")) : "f16" === n2 ? new Me(new Float32Array(t2), e2.getTypeInfo("vec2h")) : (console.error(`getSubData: Unknown format ${n2}`), null) : 3 === s2 ? "f32" === n2 ? new Me(new Float32Array(t2), e2.getTypeInfo("vec3f")) : "i32" === n2 || "bool" === n2 ? new Me(new Int32Array(t2), e2.getTypeInfo("vec3i")) : "u32" === n2 ? new Me(new Uint32Array(t2), e2.getTypeInfo("vec3u")) : "f16" === n2 ? new Me(new Float32Array(t2), e2.getTypeInfo("vec3h")) : (console.error(`getSubData: Unknown format ${n2}`), null) : 4 === s2 ? "f32" === n2 ? new Me(new Float32Array(t2), e2.getTypeInfo("vec4f")) : "i32" === n2 || "bool" === n2 ? new Me(new Int32Array(t2), e2.getTypeInfo("vec4i")) : "u32" === n2 ? new Me(new Uint32Array(t2), e2.getTypeInfo("vec4u")) : "f16" === n2 ? new Me(new Float32Array(t2), e2.getTypeInfo("vec4h")) : (console.error(`getSubData: Unknown format ${n2}`), null) : (console.error(`getSubData: Invalid vector size ${t2.length}`), null);
  }
  var Me = class _Me extends Ne {
    constructor(e2, t2, n2 = null) {
      if (super(t2, n2), e2 instanceof Float32Array || e2 instanceof Uint32Array || e2 instanceof Int32Array) this.data = e2;
      else {
        const t3 = this.typeInfo.name;
        "vec2f" === t3 || "vec3f" === t3 || "vec4f" === t3 ? this.data = new Float32Array(e2) : "vec2i" === t3 || "vec3i" === t3 || "vec4i" === t3 ? this.data = new Int32Array(e2) : "vec2u" === t3 || "vec3u" === t3 || "vec4u" === t3 ? this.data = new Uint32Array(e2) : "vec2h" === t3 || "vec3h" === t3 || "vec4h" === t3 ? this.data = new Float32Array(e2) : "vec2b" === t3 || "vec3b" === t3 || "vec4b" === t3 ? this.data = new Int32Array(e2) : "vec2" === t3 || "vec3" === t3 || "vec4" === t3 ? this.data = new Float32Array(e2) : console.error(`VectorData: Invalid type ${t3}`);
      }
    }
    clone() {
      if (this.data instanceof Float32Array) return new _Me(new Float32Array(this.data), this.typeInfo, null);
      if (this.data instanceof Int32Array) return new _Me(new Int32Array(this.data), this.typeInfo, null);
      if (this.data instanceof Uint32Array) return new _Me(new Uint32Array(this.data), this.typeInfo, null);
      throw "VectorData: Invalid data type";
    }
    setDataValue(e2, t2, n2, s2) {
      n2 instanceof pe ? console.error("TODO: Set vector postfix") : t2 instanceof _Me ? this.data = t2.data : console.error("SetDataValue: Invalid value", t2);
    }
    getSubData(e2, t2, n2) {
      if (null === t2) return this;
      let s2 = e2.getTypeInfo("f32");
      if (this.typeInfo instanceof a) s2 = this.typeInfo.format || s2;
      else {
        const t3 = this.typeInfo.name;
        "vec2f" === t3 || "vec3f" === t3 || "vec4f" === t3 ? s2 = e2.getTypeInfo("f32") : "vec2i" === t3 || "vec3i" === t3 || "vec4i" === t3 ? s2 = e2.getTypeInfo("i32") : "vec2b" === t3 || "vec3b" === t3 || "vec4b" === t3 ? s2 = e2.getTypeInfo("bool") : "vec2u" === t3 || "vec3u" === t3 || "vec4u" === t3 ? s2 = e2.getTypeInfo("u32") : "vec2h" === t3 || "vec3h" === t3 || "vec4h" === t3 ? s2 = e2.getTypeInfo("f16") : console.error(`GetSubData: Unknown type ${t3}`);
      }
      let r2 = this;
      for (; null !== t2 && null !== r2; ) {
        if (t2 instanceof ve) {
          const a2 = t2.index;
          let i2 = -1;
          if (a2 instanceof xe) {
            if (!(a2.value instanceof Be)) return console.error(`GetSubData: Invalid array index ${a2.value}`), null;
            i2 = a2.value.value;
          } else {
            const t3 = e2.evalExpression(a2, n2);
            if (!(t3 instanceof Be)) return console.error("GetSubData: Unknown index type", a2), null;
            i2 = t3.value;
          }
          if (i2 < 0 || i2 >= r2.data.length) return console.error("GetSubData: Index out of range", i2), null;
          if (r2.data instanceof Float32Array) {
            const e3 = new Float32Array(r2.data.buffer, r2.data.byteOffset + 4 * i2, 1);
            return new Be(e3, s2);
          }
          if (r2.data instanceof Int32Array) {
            const e3 = new Int32Array(r2.data.buffer, r2.data.byteOffset + 4 * i2, 1);
            return new Be(e3, s2);
          }
          if (r2.data instanceof Uint32Array) {
            const e3 = new Uint32Array(r2.data.buffer, r2.data.byteOffset + 4 * i2, 1);
            return new Be(e3, s2);
          }
          throw "GetSubData: Invalid data type";
        }
        if (!(t2 instanceof pe)) return console.error("GetSubData: Unknown postfix", t2), null;
        {
          const n3 = t2.value.toLowerCase();
          if (1 === n3.length) {
            let e3 = 0;
            if ("x" === n3 || "r" === n3) e3 = 0;
            else if ("y" === n3 || "g" === n3) e3 = 1;
            else if ("z" === n3 || "b" === n3) e3 = 2;
            else {
              if ("w" !== n3 && "a" !== n3) return console.error(`GetSubData: Unknown member ${n3}`), null;
              e3 = 3;
            }
            if (this.data instanceof Float32Array) {
              let t3 = new Float32Array(this.data.buffer, this.data.byteOffset + 4 * e3, 1);
              return new Be(t3, s2, this);
            }
            if (this.data instanceof Int32Array) {
              let t3 = new Int32Array(this.data.buffer, this.data.byteOffset + 4 * e3, 1);
              return new Be(t3, s2, this);
            }
            if (this.data instanceof Uint32Array) {
              let t3 = new Uint32Array(this.data.buffer, this.data.byteOffset + 4 * e3, 1);
              return new Be(t3, s2, this);
            }
          }
          const a2 = [];
          for (const e3 of n3) "x" === e3 || "r" === e3 ? a2.push(this.data[0]) : "y" === e3 || "g" === e3 ? a2.push(this.data[1]) : "z" === e3 || "b" === e3 ? a2.push(this.data[2]) : "w" === e3 || "a" === e3 ? a2.push(this.data[3]) : console.error(`GetDataValue: Unknown member ${e3}`);
          r2 = Fe(e2, a2, s2.name);
        }
        t2 = t2.postfix;
      }
      return r2;
    }
    toString() {
      let e2 = `${this.data[0]}`;
      for (let t2 = 1; t2 < this.data.length; ++t2) e2 += `, ${this.data[t2]}`;
      return e2;
    }
  };
  var Ue = class _Ue extends Ne {
    constructor(e2, t2, n2 = null) {
      super(t2, n2), e2 instanceof Float32Array ? this.data = e2 : this.data = new Float32Array(e2);
    }
    clone() {
      return new _Ue(new Float32Array(this.data), this.typeInfo, null);
    }
    setDataValue(e2, t2, n2, s2) {
      n2 instanceof pe ? console.error("TODO: Set matrix postfix") : t2 instanceof _Ue ? this.data = t2.data : console.error("SetDataValue: Invalid value", t2);
    }
    getSubData(e2, t2, n2) {
      if (null === t2) return this;
      const s2 = this.typeInfo.name;
      if (e2.getTypeInfo("f32"), this.typeInfo instanceof a) this.typeInfo.format;
      else if (s2.endsWith("f")) e2.getTypeInfo("f32");
      else if (s2.endsWith("i")) e2.getTypeInfo("i32");
      else if (s2.endsWith("u")) e2.getTypeInfo("u32");
      else {
        if (!s2.endsWith("h")) return console.error(`GetDataValue: Unknown type ${s2}`), null;
        e2.getTypeInfo("f16");
      }
      if (t2 instanceof ve) {
        const r2 = t2.index;
        let a2 = -1;
        if (r2 instanceof xe) {
          if (!(r2.value instanceof Be)) return console.error(`GetDataValue: Invalid array index ${r2.value}`), null;
          a2 = r2.value.value;
        } else {
          const t3 = e2.evalExpression(r2, n2);
          if (!(t3 instanceof Be)) return console.error("GetDataValue: Unknown index type", r2), null;
          a2 = t3.value;
        }
        if (a2 < 0 || a2 >= this.data.length) return console.error("GetDataValue: Index out of range", a2), null;
        const i2 = s2.endsWith("h") ? "h" : "f";
        let o2;
        if ("mat2x2" === s2 || "mat2x2f" === s2 || "mat2x2h" === s2 || "mat3x2" === s2 || "mat3x2f" === s2 || "mat3x2h" === s2 || "mat4x2" === s2 || "mat4x2f" === s2 || "mat4x2h" === s2) o2 = new Me(new Float32Array(this.data.buffer, this.data.byteOffset + 2 * a2 * 4, 2), e2.getTypeInfo(`vec2${i2}`));
        else if ("mat2x3" === s2 || "mat2x3f" === s2 || "mat2x3h" === s2 || "mat3x3" === s2 || "mat3x3f" === s2 || "mat3x3h" === s2 || "mat4x3" === s2 || "mat4x3f" === s2 || "mat4x3h" === s2) o2 = new Me(new Float32Array(this.data.buffer, this.data.byteOffset + 3 * a2 * 4, 3), e2.getTypeInfo(`vec3${i2}`));
        else {
          if ("mat2x4" !== s2 && "mat2x4f" !== s2 && "mat2x4h" !== s2 && "mat3x4" !== s2 && "mat3x4f" !== s2 && "mat3x4h" !== s2 && "mat4x4" !== s2 && "mat4x4f" !== s2 && "mat4x4h" !== s2) return console.error(`GetDataValue: Unknown type ${s2}`), null;
          o2 = new Me(new Float32Array(this.data.buffer, this.data.byteOffset + 4 * a2 * 4, 4), e2.getTypeInfo(`vec4${i2}`));
        }
        return t2.postfix ? o2.getSubData(e2, t2.postfix, n2) : o2;
      }
      return console.error("GetDataValue: Invalid postfix", t2), null;
    }
    toString() {
      let e2 = `${this.data[0]}`;
      for (let t2 = 1; t2 < this.data.length; ++t2) e2 += `, ${this.data[t2]}`;
      return e2;
    }
  };
  var Pe = class _Pe extends Ne {
    constructor(e2, t2, n2 = 0, s2 = null) {
      super(t2, s2), this.buffer = e2 instanceof ArrayBuffer ? e2 : e2.buffer, this.offset = n2;
    }
    clone() {
      const e2 = new Uint8Array(new Uint8Array(this.buffer, this.offset, this.typeInfo.size));
      return new _Pe(e2.buffer, this.typeInfo, 0, null);
    }
    setDataValue(t2, r2, a2, i2) {
      if (null === r2) return void console.log("setDataValue: NULL data.");
      let o2 = this.offset, c2 = this.typeInfo;
      for (; a2; ) {
        if (a2 instanceof ve) if (c2 instanceof s) {
          const e2 = a2.index;
          if (e2 instanceof xe) {
            if (!(e2.value instanceof Be)) return void console.error(`SetDataValue: Invalid index type ${e2.value}`);
            o2 += e2.value.value * c2.stride;
          } else {
            const n2 = t2.evalExpression(e2, i2);
            if (!(n2 instanceof Be)) return void console.error("SetDataValue: Unknown index type", e2);
            o2 += n2.value * c2.stride;
          }
          c2 = c2.format;
        } else console.error(`SetDataValue: Type ${c2.getTypeName()} is not an array`);
        else {
          if (!(a2 instanceof pe)) return void console.error("SetDataValue: Unknown postfix type", a2);
          {
            const t3 = a2.value;
            if (c2 instanceof n) {
              let e2 = false;
              for (const n2 of c2.members) if (n2.name === t3) {
                o2 += n2.offset, c2 = n2.type, e2 = true;
                break;
              }
              if (!e2) return void console.error(`SetDataValue: Member ${t3} not found`);
            } else if (c2 instanceof e) {
              const e2 = c2.getTypeName();
              let n2 = 0;
              if ("x" === t3 || "r" === t3) n2 = 0;
              else if ("y" === t3 || "g" === t3) n2 = 1;
              else if ("z" === t3 || "b" === t3) n2 = 2;
              else {
                if ("w" !== t3 && "a" !== t3) return void console.error(`SetDataValue: Unknown member ${t3}`);
                n2 = 3;
              }
              if (!(r2 instanceof Be)) return void console.error("SetDataValue: Invalid value", r2);
              const s2 = r2.value;
              return "vec2f" === e2 ? void (new Float32Array(this.buffer, o2, 2)[n2] = s2) : "vec3f" === e2 ? void (new Float32Array(this.buffer, o2, 3)[n2] = s2) : "vec4f" === e2 ? void (new Float32Array(this.buffer, o2, 4)[n2] = s2) : "vec2i" === e2 ? void (new Int32Array(this.buffer, o2, 2)[n2] = s2) : "vec3i" === e2 ? void (new Int32Array(this.buffer, o2, 3)[n2] = s2) : "vec4i" === e2 ? void (new Int32Array(this.buffer, o2, 4)[n2] = s2) : "vec2u" === e2 ? void (new Uint32Array(this.buffer, o2, 2)[n2] = s2) : "vec3u" === e2 ? void (new Uint32Array(this.buffer, o2, 3)[n2] = s2) : "vec4u" === e2 ? void (new Uint32Array(this.buffer, o2, 4)[n2] = s2) : void console.error(`SetDataValue: Type ${e2} is not a struct`);
            }
          }
        }
        a2 = a2.postfix;
      }
      this.setData(t2, r2, c2, o2, i2);
    }
    setData(e2, t2, n2, s2, r2) {
      const a2 = n2.getTypeName();
      if ("f32" !== a2 && "f16" !== a2) if ("i32" !== a2 && "atomic<i32>" !== a2 && "x32" !== a2) if ("u32" !== a2 && "atomic<u32>" !== a2) if ("bool" !== a2) {
        if ("vec2f" === a2 || "vec2h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 2);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1]) : (e3[0] = t2[0], e3[1] = t2[1]));
        }
        if ("vec3f" === a2 || "vec3h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 3);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2]));
        }
        if ("vec4f" === a2 || "vec4h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 4);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3]));
        }
        if ("vec2i" === a2) {
          const e3 = new Int32Array(this.buffer, s2, 2);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1]) : (e3[0] = t2[0], e3[1] = t2[1]));
        }
        if ("vec3i" === a2) {
          const e3 = new Int32Array(this.buffer, s2, 3);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2]));
        }
        if ("vec4i" === a2) {
          const e3 = new Int32Array(this.buffer, s2, 4);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3]));
        }
        if ("vec2u" === a2) {
          const e3 = new Uint32Array(this.buffer, s2, 2);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1]) : (e3[0] = t2[0], e3[1] = t2[1]));
        }
        if ("vec3u" === a2) {
          const e3 = new Uint32Array(this.buffer, s2, 3);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2]));
        }
        if ("vec4u" === a2) {
          const e3 = new Uint32Array(this.buffer, s2, 4);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3]));
        }
        if ("vec2b" === a2) {
          const e3 = new Uint32Array(this.buffer, s2, 2);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1]) : (e3[0] = t2[0], e3[1] = t2[1]));
        }
        if ("vec3b" === a2) {
          const e3 = new Uint32Array(this.buffer, s2, 3);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2]));
        }
        if ("vec4b" === a2) {
          const e3 = new Uint32Array(this.buffer, s2, 4);
          return void (t2 instanceof Me ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3]));
        }
        if ("mat2x2f" === a2 || "mat2x2h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 4);
          return void (t2 instanceof Ue ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3]));
        }
        if ("mat2x3f" === a2 || "mat2x3h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 6);
          return void (t2 instanceof Ue ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3], e3[4] = t2.data[4], e3[5] = t2.data[5]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3], e3[4] = t2[4], e3[5] = t2[5]));
        }
        if ("mat2x4f" === a2 || "mat2x4h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 8);
          return void (t2 instanceof Ue ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3], e3[4] = t2.data[4], e3[5] = t2.data[5], e3[6] = t2.data[6], e3[7] = t2.data[7]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3], e3[4] = t2[4], e3[5] = t2[5], e3[6] = t2[6], e3[7] = t2[7]));
        }
        if ("mat3x2f" === a2 || "mat3x2h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 6);
          return void (t2 instanceof Ue ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3], e3[4] = t2.data[4], e3[5] = t2.data[5]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3], e3[4] = t2[4], e3[5] = t2[5]));
        }
        if ("mat3x3f" === a2 || "mat3x3h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 9);
          return void (t2 instanceof Ue ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3], e3[4] = t2.data[4], e3[5] = t2.data[5], e3[6] = t2.data[6], e3[7] = t2.data[7], e3[8] = t2.data[8]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3], e3[4] = t2[4], e3[5] = t2[5], e3[6] = t2[6], e3[7] = t2[7], e3[8] = t2[8]));
        }
        if ("mat3x4f" === a2 || "mat3x4h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 12);
          return void (t2 instanceof Ue ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3], e3[4] = t2.data[4], e3[5] = t2.data[5], e3[6] = t2.data[6], e3[7] = t2.data[7], e3[8] = t2.data[8], e3[9] = t2.data[9], e3[10] = t2.data[10], e3[11] = t2.data[11]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3], e3[4] = t2[4], e3[5] = t2[5], e3[6] = t2[6], e3[7] = t2[7], e3[8] = t2[8], e3[9] = t2[9], e3[10] = t2[10], e3[11] = t2[11]));
        }
        if ("mat4x2f" === a2 || "mat4x2h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 8);
          return void (t2 instanceof Ue ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3], e3[4] = t2.data[4], e3[5] = t2.data[5], e3[6] = t2.data[6], e3[7] = t2.data[7]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3], e3[4] = t2[4], e3[5] = t2[5], e3[6] = t2[6], e3[7] = t2[7]));
        }
        if ("mat4x3f" === a2 || "mat4x3h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 12);
          return void (t2 instanceof Ue ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3], e3[4] = t2.data[4], e3[5] = t2.data[5], e3[6] = t2.data[6], e3[7] = t2.data[7], e3[8] = t2.data[8], e3[9] = t2.data[9], e3[10] = t2.data[10], e3[11] = t2.data[11]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3], e3[4] = t2[4], e3[5] = t2[5], e3[6] = t2[6], e3[7] = t2[7], e3[8] = t2[8], e3[9] = t2[9], e3[10] = t2[10], e3[11] = t2[11]));
        }
        if ("mat4x4f" === a2 || "mat4x4h" === a2) {
          const e3 = new Float32Array(this.buffer, s2, 16);
          return void (t2 instanceof Ue ? (e3[0] = t2.data[0], e3[1] = t2.data[1], e3[2] = t2.data[2], e3[3] = t2.data[3], e3[4] = t2.data[4], e3[5] = t2.data[5], e3[6] = t2.data[6], e3[7] = t2.data[7], e3[8] = t2.data[8], e3[9] = t2.data[9], e3[10] = t2.data[10], e3[11] = t2.data[11], e3[12] = t2.data[12], e3[13] = t2.data[13], e3[14] = t2.data[14], e3[15] = t2.data[15]) : (e3[0] = t2[0], e3[1] = t2[1], e3[2] = t2[2], e3[3] = t2[3], e3[4] = t2[4], e3[5] = t2[5], e3[6] = t2[6], e3[7] = t2[7], e3[8] = t2[8], e3[9] = t2[9], e3[10] = t2[10], e3[11] = t2[11], e3[12] = t2[12], e3[13] = t2[13], e3[14] = t2[14], e3[15] = t2[15]));
        }
        if (t2 instanceof _Pe) {
          if (n2 === t2.typeInfo) {
            return void new Uint8Array(this.buffer, s2, t2.buffer.byteLength).set(new Uint8Array(t2.buffer));
          }
          console.error("SetDataValue: Type mismatch", a2, t2.typeInfo.getTypeName());
        } else console.error(`SetData: Unknown type ${a2}`);
      } else t2 instanceof Be && (new Int32Array(this.buffer, s2, 1)[0] = t2.value);
      else t2 instanceof Be && (new Uint32Array(this.buffer, s2, 1)[0] = t2.value);
      else t2 instanceof Be && (new Int32Array(this.buffer, s2, 1)[0] = t2.value);
      else t2 instanceof Be && (new Float32Array(this.buffer, s2, 1)[0] = t2.value);
    }
    getSubData(t2, r2, i2) {
      var o2, c2, l2;
      if (null === r2) return this;
      let u2 = this.offset, h2 = this.typeInfo;
      for (; r2; ) {
        if (r2 instanceof ve) {
          const e2 = r2.index, n2 = e2 instanceof fe ? t2.evalExpression(e2, i2) : e2;
          let a2 = 0;
          if (n2 instanceof Be ? a2 = n2.value : "number" == typeof n2 ? a2 = n2 : console.error("GetDataValue: Invalid index type", e2), h2 instanceof s) u2 += a2 * h2.stride, h2 = h2.format;
          else {
            const e3 = h2.getTypeName();
            "mat4x4" === e3 || "mat4x4f" === e3 || "mat4x4h" === e3 ? (u2 += 16 * a2, h2 = t2.getTypeInfo("vec4f")) : console.error(`getDataValue: Type ${h2.getTypeName()} is not an array`);
          }
        } else {
          if (!(r2 instanceof pe)) return console.error("GetDataValue: Unknown postfix type", r2), null;
          {
            const s2 = r2.value;
            if (h2 instanceof n) {
              let e2 = false;
              for (const t3 of h2.members) if (t3.name === s2) {
                u2 += t3.offset, h2 = t3.type, e2 = true;
                break;
              }
              if (!e2) return console.error(`GetDataValue: Member ${s2} not found`), null;
            } else if (h2 instanceof e) {
              const e2 = h2.getTypeName();
              if ("vec2f" === e2 || "vec3f" === e2 || "vec4f" === e2 || "vec2i" === e2 || "vec3i" === e2 || "vec4i" === e2 || "vec2u" === e2 || "vec3u" === e2 || "vec4u" === e2 || "vec2b" === e2 || "vec3b" === e2 || "vec4b" === e2 || "vec2h" === e2 || "vec3h" === e2 || "vec4h" === e2 || "vec2" === e2 || "vec3" === e2 || "vec4" === e2) {
                if (s2.length > 0 && s2.length < 5) {
                  let n2 = "f";
                  const r3 = [];
                  for (let a2 = 0; a2 < s2.length; ++a2) {
                    const i3 = s2[a2].toLowerCase();
                    let o3 = 0;
                    if ("x" === i3 || "r" === i3) o3 = 0;
                    else if ("y" === i3 || "g" === i3) o3 = 1;
                    else if ("z" === i3 || "b" === i3) o3 = 2;
                    else {
                      if ("w" !== i3 && "a" !== i3) return console.error(`Unknown member ${s2}`), null;
                      o3 = 3;
                    }
                    if (1 === s2.length) {
                      if (e2.endsWith("f")) return this.buffer.byteLength < u2 + 4 * o3 + 4 ? (console.log("Insufficient buffer data"), null) : new Be(new Float32Array(this.buffer, u2 + 4 * o3, 1), t2.getTypeInfo("f32"), this);
                      if (e2.endsWith("h")) return new Be(new Float32Array(this.buffer, u2 + 4 * o3, 1), t2.getTypeInfo("f16"), this);
                      if (e2.endsWith("i")) return new Be(new Int32Array(this.buffer, u2 + 4 * o3, 1), t2.getTypeInfo("i32"), this);
                      if (e2.endsWith("b")) return new Be(new Int32Array(this.buffer, u2 + 4 * o3, 1), t2.getTypeInfo("bool"), this);
                      if (e2.endsWith("u")) return new Be(new Uint32Array(this.buffer, u2 + 4 * o3, 1), t2.getTypeInfo("i32"), this);
                    }
                    if ("vec2f" === e2) r3.push(new Float32Array(this.buffer, u2, 2)[o3]);
                    else if ("vec3f" === e2) {
                      if (u2 + 12 >= this.buffer.byteLength) return console.log("Insufficient buffer data"), null;
                      const e3 = new Float32Array(this.buffer, u2, 3);
                      r3.push(e3[o3]);
                    } else if ("vec4f" === e2) r3.push(new Float32Array(this.buffer, u2, 4)[o3]);
                    else if ("vec2i" === e2) n2 = "i", r3.push(new Int32Array(this.buffer, u2, 2)[o3]);
                    else if ("vec3i" === e2) n2 = "i", r3.push(new Int32Array(this.buffer, u2, 3)[o3]);
                    else if ("vec4i" === e2) n2 = "i", r3.push(new Int32Array(this.buffer, u2, 4)[o3]);
                    else if ("vec2u" === e2) {
                      n2 = "u";
                      const e3 = new Uint32Array(this.buffer, u2, 2);
                      r3.push(e3[o3]);
                    } else "vec3u" === e2 ? (n2 = "u", r3.push(new Uint32Array(this.buffer, u2, 3)[o3])) : "vec4u" === e2 && (n2 = "u", r3.push(new Uint32Array(this.buffer, u2, 4)[o3]));
                  }
                  return 2 === r3.length ? h2 = t2.getTypeInfo(`vec2${n2}`) : 3 === r3.length ? h2 = t2.getTypeInfo(`vec3${n2}`) : 4 === r3.length ? h2 = t2.getTypeInfo(`vec4${n2}`) : console.error(`GetDataValue: Invalid vector length ${r3.length}`), new Me(r3, h2, null);
                }
                return console.error(`GetDataValue: Unknown member ${s2}`), null;
              }
              return console.error(`GetDataValue: Type ${e2} is not a struct`), null;
            }
          }
        }
        r2 = r2.postfix;
      }
      const f2 = h2.getTypeName();
      return "f32" === f2 ? new Be(new Float32Array(this.buffer, u2, 1), h2, this) : "i32" === f2 ? new Be(new Int32Array(this.buffer, u2, 1), h2, this) : "u32" === f2 ? new Be(new Uint32Array(this.buffer, u2, 1), h2, this) : "vec2f" === f2 ? new Me(new Float32Array(this.buffer, u2, 2), h2, this) : "vec3f" === f2 ? new Me(new Float32Array(this.buffer, u2, 3), h2, this) : "vec4f" === f2 ? new Me(new Float32Array(this.buffer, u2, 4), h2, this) : "vec2i" === f2 ? new Me(new Int32Array(this.buffer, u2, 2), h2, this) : "vec3i" === f2 ? new Me(new Int32Array(this.buffer, u2, 3), h2, this) : "vec4i" === f2 ? new Me(new Int32Array(this.buffer, u2, 4), h2, this) : "vec2u" === f2 ? new Me(new Uint32Array(this.buffer, u2, 2), h2, this) : "vec3u" === f2 ? new Me(new Uint32Array(this.buffer, u2, 3), h2, this) : "vec4u" === f2 ? new Me(new Uint32Array(this.buffer, u2, 4), h2, this) : h2 instanceof a && "atomic" === h2.name ? "u32" === (null === (o2 = h2.format) || void 0 === o2 ? void 0 : o2.name) ? new Be(new Uint32Array(this.buffer, u2, 1)[0], h2.format, this) : "i32" === (null === (c2 = h2.format) || void 0 === c2 ? void 0 : c2.name) ? new Be(new Int32Array(this.buffer, u2, 1)[0], h2.format, this) : (console.error(`GetDataValue: Invalid atomic format ${null === (l2 = h2.format) || void 0 === l2 ? void 0 : l2.name}`), null) : new _Pe(this.buffer, h2, u2, this);
    }
    toString() {
      let e2 = "";
      if (this.typeInfo instanceof s) if ("f32" === this.typeInfo.format.name) {
        const t2 = new Float32Array(this.buffer, this.offset);
        e2 = `[${t2[0]}`;
        for (let n2 = 1; n2 < t2.length; ++n2) e2 += `, ${t2[n2]}`;
      } else if ("i32" === this.typeInfo.format.name) {
        const t2 = new Int32Array(this.buffer, this.offset);
        e2 = `[${t2[0]}`;
        for (let n2 = 1; n2 < t2.length; ++n2) e2 += `, ${t2[n2]}`;
      } else if ("u32" === this.typeInfo.format.name) {
        const t2 = new Uint32Array(this.buffer, this.offset);
        e2 = `[${t2[0]}`;
        for (let n2 = 1; n2 < t2.length; ++n2) e2 += `, ${t2[n2]}`;
      } else if ("vec2f" === this.typeInfo.format.name) {
        const t2 = new Float32Array(this.buffer, this.offset);
        e2 = `[${t2[0]}, ${t2[1]}]`;
        for (let n2 = 1; n2 < t2.length / 2; ++n2) e2 += `, [${t2[2 * n2]}, ${t2[2 * n2 + 1]}]`;
      } else if ("vec3f" === this.typeInfo.format.name) {
        const t2 = new Float32Array(this.buffer, this.offset);
        e2 = `[${t2[0]}, ${t2[1]}, ${t2[2]}]`;
        for (let n2 = 4; n2 < t2.length; n2 += 4) e2 += `, [${t2[n2]}, ${t2[n2 + 1]}, ${t2[n2 + 2]}]`;
      } else if ("vec4f" === this.typeInfo.format.name) {
        const t2 = new Float32Array(this.buffer, this.offset);
        e2 = `[${t2[0]}, ${t2[1]}, ${t2[2]}, ${t2[3]}]`;
        for (let n2 = 4; n2 < t2.length; n2 += 4) e2 += `, [${t2[n2]}, ${t2[n2 + 1]}, ${t2[n2 + 2]}, ${t2[n2 + 3]}]`;
      } else e2 = "[...]";
      else this.typeInfo instanceof n ? e2 += "{...}" : e2 = "[...]";
      return e2;
    }
  };
  var We = class _We extends Ne {
    constructor(e2, t2, n2, s2) {
      super(t2, null), this.data = e2, this.descriptor = n2, this.view = s2;
    }
    clone() {
      return new _We(this.data, this.typeInfo, this.descriptor, this.view);
    }
    get width() {
      var e2, t2;
      const n2 = this.descriptor.size;
      return n2 instanceof Array && n2.length > 0 ? null !== (e2 = n2[0]) && void 0 !== e2 ? e2 : 0 : n2 instanceof Object && null !== (t2 = n2.width) && void 0 !== t2 ? t2 : 0;
    }
    get height() {
      var e2, t2;
      const n2 = this.descriptor.size;
      return n2 instanceof Array && n2.length > 1 ? null !== (e2 = n2[1]) && void 0 !== e2 ? e2 : 0 : n2 instanceof Object && null !== (t2 = n2.height) && void 0 !== t2 ? t2 : 0;
    }
    get depthOrArrayLayers() {
      var e2, t2;
      const n2 = this.descriptor.size;
      return n2 instanceof Array && n2.length > 2 ? null !== (e2 = n2[2]) && void 0 !== e2 ? e2 : 0 : n2 instanceof Object && null !== (t2 = n2.depthOrArrayLayers) && void 0 !== t2 ? t2 : 0;
    }
    get format() {
      var e2;
      return this.descriptor && null !== (e2 = this.descriptor.format) && void 0 !== e2 ? e2 : "rgba8unorm";
    }
    get sampleCount() {
      var e2;
      return this.descriptor && null !== (e2 = this.descriptor.sampleCount) && void 0 !== e2 ? e2 : 1;
    }
    get mipLevelCount() {
      var e2;
      return this.descriptor && null !== (e2 = this.descriptor.mipLevelCount) && void 0 !== e2 ? e2 : 1;
    }
    get dimension() {
      var e2;
      return this.descriptor && null !== (e2 = this.descriptor.dimension) && void 0 !== e2 ? e2 : "2d";
    }
    getMipLevelSize(e2) {
      if (e2 >= this.mipLevelCount) return [0, 0, 0];
      const t2 = [this.width, this.height, this.depthOrArrayLayers];
      for (let n2 = 0; n2 < t2.length; ++n2) t2[n2] = Math.max(1, t2[n2] >> e2);
      return t2;
    }
    get texelByteSize() {
      const e2 = this.format, t2 = S[e2];
      return t2 ? t2.isDepthStencil ? 4 : t2.bytesPerBlock : 0;
    }
    get bytesPerRow() {
      return this.width * this.texelByteSize;
    }
    get isDepthStencil() {
      const e2 = this.format, t2 = S[e2];
      return !!t2 && t2.isDepthStencil;
    }
    getGpuSize() {
      const e2 = this.format, t2 = S[e2], n2 = this.width;
      if (!e2 || n2 <= 0 || !t2) return -1;
      const s2 = this.height, r2 = this.depthOrArrayLayers, a2 = this.dimension;
      return n2 / t2.blockWidth * ("1d" === a2 ? 1 : s2 / t2.blockHeight) * t2.bytesPerBlock * r2;
    }
    getPixel(e2, t2, n2 = 0, s2 = 0) {
      const r2 = this.texelByteSize, a2 = this.bytesPerRow, i2 = this.height, o2 = this.data[s2];
      return k(new Uint8Array(o2), e2, t2, n2, s2, i2, a2, r2, this.format);
    }
    setPixel(e2, t2, n2, s2, r2) {
      const a2 = this.texelByteSize, i2 = this.bytesPerRow, o2 = this.height, c2 = this.data[s2];
      !(function(e3, t3, n3, s3, r3, a3, i3, o3, c3, l2) {
        const u2 = s3 * (i3 >>= r3) * (a3 >>= r3) + n3 * i3 + t3 * o3;
        switch (c3) {
          case "r8unorm":
            return void T(e3, u2, "8unorm", 1, l2);
          case "r8snorm":
            return void T(e3, u2, "8snorm", 1, l2);
          case "r8uint":
            return void T(e3, u2, "8uint", 1, l2);
          case "r8sint":
            return void T(e3, u2, "8sint", 1, l2);
          case "rg8unorm":
            return void T(e3, u2, "8unorm", 2, l2);
          case "rg8snorm":
            return void T(e3, u2, "8snorm", 2, l2);
          case "rg8uint":
            return void T(e3, u2, "8uint", 2, l2);
          case "rg8sint":
            return void T(e3, u2, "8sint", 2, l2);
          case "rgba8unorm-srgb":
          case "rgba8unorm":
          case "bgra8unorm-srgb":
          case "bgra8unorm":
            return void T(e3, u2, "8unorm", 4, l2);
          case "rgba8snorm":
            return void T(e3, u2, "8snorm", 4, l2);
          case "rgba8uint":
            return void T(e3, u2, "8uint", 4, l2);
          case "rgba8sint":
            return void T(e3, u2, "8sint", 4, l2);
          case "r16uint":
            return void T(e3, u2, "16uint", 1, l2);
          case "r16sint":
            return void T(e3, u2, "16sint", 1, l2);
          case "r16float":
            return void T(e3, u2, "16float", 1, l2);
          case "rg16uint":
            return void T(e3, u2, "16uint", 2, l2);
          case "rg16sint":
            return void T(e3, u2, "16sint", 2, l2);
          case "rg16float":
            return void T(e3, u2, "16float", 2, l2);
          case "rgba16uint":
            return void T(e3, u2, "16uint", 4, l2);
          case "rgba16sint":
            return void T(e3, u2, "16sint", 4, l2);
          case "rgba16float":
            return void T(e3, u2, "16float", 4, l2);
          case "r32uint":
            return void T(e3, u2, "32uint", 1, l2);
          case "r32sint":
            return void T(e3, u2, "32sint", 1, l2);
          case "depth16unorm":
          case "depth24plus":
          case "depth24plus-stencil8":
          case "depth32float":
          case "depth32float-stencil8":
          case "r32float":
            return void T(e3, u2, "32float", 1, l2);
          case "rg32uint":
            return void T(e3, u2, "32uint", 2, l2);
          case "rg32sint":
            return void T(e3, u2, "32sint", 2, l2);
          case "rg32float":
            return void T(e3, u2, "32float", 2, l2);
          case "rgba32uint":
            return void T(e3, u2, "32uint", 4, l2);
          case "rgba32sint":
            return void T(e3, u2, "32sint", 4, l2);
          case "rgba32float":
            return void T(e3, u2, "32float", 4, l2);
          case "rg11b10ufloat":
            console.error("TODO: rg11b10ufloat not supported for writing");
        }
      })(new Uint8Array(c2), e2, t2, n2, s2, o2, i2, a2, this.format, r2);
    }
  };
  ((e2) => {
    e2[e2.token = 0] = "token", e2[e2.keyword = 1] = "keyword", e2[e2.reserved = 2] = "reserved";
  })(z || (z = {}));
  var qe = class {
    constructor(e2, t2, n2) {
      this.name = e2, this.type = t2, this.rule = n2;
    }
    toString() {
      return this.name;
    }
  };
  var He = class {
  };
  H = He, He.none = new qe("", z.reserved, ""), He.eof = new qe("EOF", z.token, ""), He.reserved = { asm: new qe("asm", z.reserved, "asm"), bf16: new qe("bf16", z.reserved, "bf16"), do: new qe("do", z.reserved, "do"), enum: new qe("enum", z.reserved, "enum"), f16: new qe("f16", z.reserved, "f16"), f64: new qe("f64", z.reserved, "f64"), handle: new qe("handle", z.reserved, "handle"), i8: new qe("i8", z.reserved, "i8"), i16: new qe("i16", z.reserved, "i16"), i64: new qe("i64", z.reserved, "i64"), mat: new qe("mat", z.reserved, "mat"), premerge: new qe("premerge", z.reserved, "premerge"), regardless: new qe("regardless", z.reserved, "regardless"), typedef: new qe("typedef", z.reserved, "typedef"), u8: new qe("u8", z.reserved, "u8"), u16: new qe("u16", z.reserved, "u16"), u64: new qe("u64", z.reserved, "u64"), unless: new qe("unless", z.reserved, "unless"), using: new qe("using", z.reserved, "using"), vec: new qe("vec", z.reserved, "vec"), void: new qe("void", z.reserved, "void") }, He.keywords = { array: new qe("array", z.keyword, "array"), atomic: new qe("atomic", z.keyword, "atomic"), bool: new qe("bool", z.keyword, "bool"), f32: new qe("f32", z.keyword, "f32"), i32: new qe("i32", z.keyword, "i32"), mat2x2: new qe("mat2x2", z.keyword, "mat2x2"), mat2x3: new qe("mat2x3", z.keyword, "mat2x3"), mat2x4: new qe("mat2x4", z.keyword, "mat2x4"), mat3x2: new qe("mat3x2", z.keyword, "mat3x2"), mat3x3: new qe("mat3x3", z.keyword, "mat3x3"), mat3x4: new qe("mat3x4", z.keyword, "mat3x4"), mat4x2: new qe("mat4x2", z.keyword, "mat4x2"), mat4x3: new qe("mat4x3", z.keyword, "mat4x3"), mat4x4: new qe("mat4x4", z.keyword, "mat4x4"), ptr: new qe("ptr", z.keyword, "ptr"), sampler: new qe("sampler", z.keyword, "sampler"), sampler_comparison: new qe("sampler_comparison", z.keyword, "sampler_comparison"), struct: new qe("struct", z.keyword, "struct"), texture_1d: new qe("texture_1d", z.keyword, "texture_1d"), texture_2d: new qe("texture_2d", z.keyword, "texture_2d"), texture_2d_array: new qe("texture_2d_array", z.keyword, "texture_2d_array"), texture_3d: new qe("texture_3d", z.keyword, "texture_3d"), texture_cube: new qe("texture_cube", z.keyword, "texture_cube"), texture_cube_array: new qe("texture_cube_array", z.keyword, "texture_cube_array"), texture_multisampled_2d: new qe("texture_multisampled_2d", z.keyword, "texture_multisampled_2d"), texture_storage_1d: new qe("texture_storage_1d", z.keyword, "texture_storage_1d"), texture_storage_2d: new qe("texture_storage_2d", z.keyword, "texture_storage_2d"), texture_storage_2d_array: new qe("texture_storage_2d_array", z.keyword, "texture_storage_2d_array"), texture_storage_3d: new qe("texture_storage_3d", z.keyword, "texture_storage_3d"), texture_depth_2d: new qe("texture_depth_2d", z.keyword, "texture_depth_2d"), texture_depth_2d_array: new qe("texture_depth_2d_array", z.keyword, "texture_depth_2d_array"), texture_depth_cube: new qe("texture_depth_cube", z.keyword, "texture_depth_cube"), texture_depth_cube_array: new qe("texture_depth_cube_array", z.keyword, "texture_depth_cube_array"), texture_depth_multisampled_2d: new qe("texture_depth_multisampled_2d", z.keyword, "texture_depth_multisampled_2d"), texture_external: new qe("texture_external", z.keyword, "texture_external"), u32: new qe("u32", z.keyword, "u32"), vec2: new qe("vec2", z.keyword, "vec2"), vec3: new qe("vec3", z.keyword, "vec3"), vec4: new qe("vec4", z.keyword, "vec4"), bitcast: new qe("bitcast", z.keyword, "bitcast"), block: new qe("block", z.keyword, "block"), break: new qe("break", z.keyword, "break"), case: new qe("case", z.keyword, "case"), continue: new qe("continue", z.keyword, "continue"), continuing: new qe("continuing", z.keyword, "continuing"), default: new qe("default", z.keyword, "default"), diagnostic: new qe("diagnostic", z.keyword, "diagnostic"), discard: new qe("discard", z.keyword, "discard"), else: new qe("else", z.keyword, "else"), enable: new qe("enable", z.keyword, "enable"), fallthrough: new qe("fallthrough", z.keyword, "fallthrough"), false: new qe("false", z.keyword, "false"), fn: new qe("fn", z.keyword, "fn"), for: new qe("for", z.keyword, "for"), function: new qe("function", z.keyword, "function"), if: new qe("if", z.keyword, "if"), let: new qe("let", z.keyword, "let"), const: new qe("const", z.keyword, "const"), loop: new qe("loop", z.keyword, "loop"), while: new qe("while", z.keyword, "while"), private: new qe("private", z.keyword, "private"), read: new qe("read", z.keyword, "read"), read_write: new qe("read_write", z.keyword, "read_write"), return: new qe("return", z.keyword, "return"), requires: new qe("requires", z.keyword, "requires"), storage: new qe("storage", z.keyword, "storage"), switch: new qe("switch", z.keyword, "switch"), true: new qe("true", z.keyword, "true"), alias: new qe("alias", z.keyword, "alias"), type: new qe("type", z.keyword, "type"), uniform: new qe("uniform", z.keyword, "uniform"), var: new qe("var", z.keyword, "var"), override: new qe("override", z.keyword, "override"), workgroup: new qe("workgroup", z.keyword, "workgroup"), write: new qe("write", z.keyword, "write"), r8unorm: new qe("r8unorm", z.keyword, "r8unorm"), r8snorm: new qe("r8snorm", z.keyword, "r8snorm"), r8uint: new qe("r8uint", z.keyword, "r8uint"), r8sint: new qe("r8sint", z.keyword, "r8sint"), r16uint: new qe("r16uint", z.keyword, "r16uint"), r16sint: new qe("r16sint", z.keyword, "r16sint"), r16float: new qe("r16float", z.keyword, "r16float"), rg8unorm: new qe("rg8unorm", z.keyword, "rg8unorm"), rg8snorm: new qe("rg8snorm", z.keyword, "rg8snorm"), rg8uint: new qe("rg8uint", z.keyword, "rg8uint"), rg8sint: new qe("rg8sint", z.keyword, "rg8sint"), r32uint: new qe("r32uint", z.keyword, "r32uint"), r32sint: new qe("r32sint", z.keyword, "r32sint"), r32float: new qe("r32float", z.keyword, "r32float"), rg16uint: new qe("rg16uint", z.keyword, "rg16uint"), rg16sint: new qe("rg16sint", z.keyword, "rg16sint"), rg16float: new qe("rg16float", z.keyword, "rg16float"), rgba8unorm: new qe("rgba8unorm", z.keyword, "rgba8unorm"), rgba8unorm_srgb: new qe("rgba8unorm_srgb", z.keyword, "rgba8unorm_srgb"), rgba8snorm: new qe("rgba8snorm", z.keyword, "rgba8snorm"), rgba8uint: new qe("rgba8uint", z.keyword, "rgba8uint"), rgba8sint: new qe("rgba8sint", z.keyword, "rgba8sint"), bgra8unorm: new qe("bgra8unorm", z.keyword, "bgra8unorm"), bgra8unorm_srgb: new qe("bgra8unorm_srgb", z.keyword, "bgra8unorm_srgb"), rgb10a2unorm: new qe("rgb10a2unorm", z.keyword, "rgb10a2unorm"), rg11b10float: new qe("rg11b10float", z.keyword, "rg11b10float"), rg32uint: new qe("rg32uint", z.keyword, "rg32uint"), rg32sint: new qe("rg32sint", z.keyword, "rg32sint"), rg32float: new qe("rg32float", z.keyword, "rg32float"), rgba16uint: new qe("rgba16uint", z.keyword, "rgba16uint"), rgba16sint: new qe("rgba16sint", z.keyword, "rgba16sint"), rgba16float: new qe("rgba16float", z.keyword, "rgba16float"), rgba32uint: new qe("rgba32uint", z.keyword, "rgba32uint"), rgba32sint: new qe("rgba32sint", z.keyword, "rgba32sint"), rgba32float: new qe("rgba32float", z.keyword, "rgba32float"), static_assert: new qe("static_assert", z.keyword, "static_assert") }, He.tokens = { decimal_float_literal: new qe("decimal_float_literal", z.token, /((-?[0-9]*\.[0-9]+|-?[0-9]+\.[0-9]*)((e|E)(\+|-)?[0-9]+)?[fh]?)|(-?[0-9]+(e|E)(\+|-)?[0-9]+[fh]?)|(-?[0-9]+[fh])/), hex_float_literal: new qe("hex_float_literal", z.token, /-?0x((([0-9a-fA-F]*\.[0-9a-fA-F]+|[0-9a-fA-F]+\.[0-9a-fA-F]*)((p|P)(\+|-)?[0-9]+[fh]?)?)|([0-9a-fA-F]+(p|P)(\+|-)?[0-9]+[fh]?))/), int_literal: new qe("int_literal", z.token, /-?0x[0-9a-fA-F]+|0i?|-?[1-9][0-9]*i?/), uint_literal: new qe("uint_literal", z.token, /0x[0-9a-fA-F]+u|0u|[1-9][0-9]*u/), name: new qe("name", z.token, /([_\p{XID_Start}][\p{XID_Continue}]+)|([\p{XID_Start}])/u), ident: new qe("ident", z.token, /[_a-zA-Z][0-9a-zA-Z_]*/), and: new qe("and", z.token, "&"), and_and: new qe("and_and", z.token, "&&"), arrow: new qe("arrow ", z.token, "->"), attr: new qe("attr", z.token, "@"), forward_slash: new qe("forward_slash", z.token, "/"), bang: new qe("bang", z.token, "!"), bracket_left: new qe("bracket_left", z.token, "["), bracket_right: new qe("bracket_right", z.token, "]"), brace_left: new qe("brace_left", z.token, "{"), brace_right: new qe("brace_right", z.token, "}"), colon: new qe("colon", z.token, ":"), comma: new qe("comma", z.token, ","), equal: new qe("equal", z.token, "="), equal_equal: new qe("equal_equal", z.token, "=="), not_equal: new qe("not_equal", z.token, "!="), greater_than: new qe("greater_than", z.token, ">"), greater_than_equal: new qe("greater_than_equal", z.token, ">="), shift_right: new qe("shift_right", z.token, ">>"), less_than: new qe("less_than", z.token, "<"), less_than_equal: new qe("less_than_equal", z.token, "<="), shift_left: new qe("shift_left", z.token, "<<"), modulo: new qe("modulo", z.token, "%"), minus: new qe("minus", z.token, "-"), minus_minus: new qe("minus_minus", z.token, "--"), period: new qe("period", z.token, "."), plus: new qe("plus", z.token, "+"), plus_plus: new qe("plus_plus", z.token, "++"), or: new qe("or", z.token, "|"), or_or: new qe("or_or", z.token, "||"), paren_left: new qe("paren_left", z.token, "("), paren_right: new qe("paren_right", z.token, ")"), semicolon: new qe("semicolon", z.token, ";"), star: new qe("star", z.token, "*"), tilde: new qe("tilde", z.token, "~"), underscore: new qe("underscore", z.token, "_"), xor: new qe("xor", z.token, "^"), plus_equal: new qe("plus_equal", z.token, "+="), minus_equal: new qe("minus_equal", z.token, "-="), times_equal: new qe("times_equal", z.token, "*="), division_equal: new qe("division_equal", z.token, "/="), modulo_equal: new qe("modulo_equal", z.token, "%="), and_equal: new qe("and_equal", z.token, "&="), or_equal: new qe("or_equal", z.token, "|="), xor_equal: new qe("xor_equal", z.token, "^="), shift_right_equal: new qe("shift_right_equal", z.token, ">>="), shift_left_equal: new qe("shift_left_equal", z.token, "<<=") }, He.simpleTokens = { "@": H.tokens.attr, "{": H.tokens.brace_left, "}": H.tokens.brace_right, ":": H.tokens.colon, ",": H.tokens.comma, "(": H.tokens.paren_left, ")": H.tokens.paren_right, ";": H.tokens.semicolon }, He.literalTokens = { "&": H.tokens.and, "&&": H.tokens.and_and, "->": H.tokens.arrow, "/": H.tokens.forward_slash, "!": H.tokens.bang, "[": H.tokens.bracket_left, "]": H.tokens.bracket_right, "=": H.tokens.equal, "==": H.tokens.equal_equal, "!=": H.tokens.not_equal, ">": H.tokens.greater_than, ">=": H.tokens.greater_than_equal, ">>": H.tokens.shift_right, "<": H.tokens.less_than, "<=": H.tokens.less_than_equal, "<<": H.tokens.shift_left, "%": H.tokens.modulo, "-": H.tokens.minus, "--": H.tokens.minus_minus, ".": H.tokens.period, "+": H.tokens.plus, "++": H.tokens.plus_plus, "|": H.tokens.or, "||": H.tokens.or_or, "*": H.tokens.star, "~": H.tokens.tilde, _: H.tokens.underscore, "^": H.tokens.xor, "+=": H.tokens.plus_equal, "-=": H.tokens.minus_equal, "*=": H.tokens.times_equal, "/=": H.tokens.division_equal, "%=": H.tokens.modulo_equal, "&=": H.tokens.and_equal, "|=": H.tokens.or_equal, "^=": H.tokens.xor_equal, ">>=": H.tokens.shift_right_equal, "<<=": H.tokens.shift_left_equal }, He.regexTokens = { decimal_float_literal: H.tokens.decimal_float_literal, hex_float_literal: H.tokens.hex_float_literal, int_literal: H.tokens.int_literal, uint_literal: H.tokens.uint_literal, ident: H.tokens.ident }, He.storage_class = [H.keywords.function, H.keywords.private, H.keywords.workgroup, H.keywords.uniform, H.keywords.storage], He.access_mode = [H.keywords.read, H.keywords.write, H.keywords.read_write], He.sampler_type = [H.keywords.sampler, H.keywords.sampler_comparison], He.sampled_texture_type = [H.keywords.texture_1d, H.keywords.texture_2d, H.keywords.texture_2d_array, H.keywords.texture_3d, H.keywords.texture_cube, H.keywords.texture_cube_array], He.multisampled_texture_type = [H.keywords.texture_multisampled_2d], He.storage_texture_type = [H.keywords.texture_storage_1d, H.keywords.texture_storage_2d, H.keywords.texture_storage_2d_array, H.keywords.texture_storage_3d], He.depth_texture_type = [H.keywords.texture_depth_2d, H.keywords.texture_depth_2d_array, H.keywords.texture_depth_cube, H.keywords.texture_depth_cube_array, H.keywords.texture_depth_multisampled_2d], He.texture_external_type = [H.keywords.texture_external], He.any_texture_type = [...H.sampled_texture_type, ...H.multisampled_texture_type, ...H.storage_texture_type, ...H.depth_texture_type, ...H.texture_external_type], He.texel_format = [H.keywords.r8unorm, H.keywords.r8snorm, H.keywords.r8uint, H.keywords.r8sint, H.keywords.r16uint, H.keywords.r16sint, H.keywords.r16float, H.keywords.rg8unorm, H.keywords.rg8snorm, H.keywords.rg8uint, H.keywords.rg8sint, H.keywords.r32uint, H.keywords.r32sint, H.keywords.r32float, H.keywords.rg16uint, H.keywords.rg16sint, H.keywords.rg16float, H.keywords.rgba8unorm, H.keywords.rgba8unorm_srgb, H.keywords.rgba8snorm, H.keywords.rgba8uint, H.keywords.rgba8sint, H.keywords.bgra8unorm, H.keywords.bgra8unorm_srgb, H.keywords.rgb10a2unorm, H.keywords.rg11b10float, H.keywords.rg32uint, H.keywords.rg32sint, H.keywords.rg32float, H.keywords.rgba16uint, H.keywords.rgba16sint, H.keywords.rgba16float, H.keywords.rgba32uint, H.keywords.rgba32sint, H.keywords.rgba32float], He.const_literal = [H.tokens.int_literal, H.tokens.uint_literal, H.tokens.decimal_float_literal, H.tokens.hex_float_literal, H.keywords.true, H.keywords.false], He.literal_or_ident = [H.tokens.ident, H.tokens.int_literal, H.tokens.uint_literal, H.tokens.decimal_float_literal, H.tokens.hex_float_literal, H.tokens.name], He.element_count_expression = [H.tokens.int_literal, H.tokens.uint_literal, H.tokens.ident], He.template_types = [H.keywords.vec2, H.keywords.vec3, H.keywords.vec4, H.keywords.mat2x2, H.keywords.mat2x3, H.keywords.mat2x4, H.keywords.mat3x2, H.keywords.mat3x3, H.keywords.mat3x4, H.keywords.mat4x2, H.keywords.mat4x3, H.keywords.mat4x4, H.keywords.atomic, H.keywords.bitcast, ...H.any_texture_type], He.attribute_name = [H.tokens.ident, H.keywords.block, H.keywords.diagnostic], He.assignment_operators = [H.tokens.equal, H.tokens.plus_equal, H.tokens.minus_equal, H.tokens.times_equal, H.tokens.division_equal, H.tokens.modulo_equal, H.tokens.and_equal, H.tokens.or_equal, H.tokens.xor_equal, H.tokens.shift_right_equal, H.tokens.shift_left_equal], He.increment_operators = [H.tokens.plus_plus, H.tokens.minus_minus];
  var ze = class {
    constructor(e2, t2, n2, s2, r2) {
      this.type = e2, this.lexeme = t2, this.line = n2, this.start = s2, this.end = r2;
    }
    toString() {
      return this.lexeme;
    }
    isTemplateType() {
      return -1 != He.template_types.indexOf(this.type);
    }
    isArrayType() {
      return this.type == He.keywords.array;
    }
    isArrayOrTemplateType() {
      return this.isArrayType() || this.isTemplateType();
    }
  };
  var Re = class {
    constructor(e2) {
      this._tokens = [], this._start = 0, this._current = 0, this._line = 1, this._source = null != e2 ? e2 : "";
    }
    scanTokens() {
      for (; !this._isAtEnd(); ) if (this._start = this._current, !this.scanToken()) throw `Invalid syntax at line ${this._line}`;
      return this._tokens.push(new ze(He.eof, "", this._line, this._current, this._current)), this._tokens;
    }
    scanToken() {
      let e2 = this._advance();
      if ("\n" == e2) return this._line++, true;
      if (this._isWhitespace(e2)) return true;
      if ("/" == e2) {
        if ("/" == this._peekAhead()) {
          for (; "\n" != e2; ) {
            if (this._isAtEnd()) return true;
            e2 = this._advance();
          }
          return this._line++, true;
        }
        if ("*" == this._peekAhead()) {
          this._advance();
          let t3 = 1;
          for (; t3 > 0; ) {
            if (this._isAtEnd()) return true;
            if (e2 = this._advance(), "\n" == e2) this._line++;
            else if ("*" == e2) {
              if ("/" == this._peekAhead() && (this._advance(), t3--, 0 == t3)) return true;
            } else "/" == e2 && "*" == this._peekAhead() && (this._advance(), t3++);
          }
          return true;
        }
      }
      const t2 = He.simpleTokens[e2];
      if (t2) return this._addToken(t2), true;
      let n2 = He.none;
      const s2 = this._isAlpha(e2), r2 = "_" === e2;
      if (this._isAlphaNumeric(e2)) {
        let t3 = this._peekAhead();
        for (; this._isAlphaNumeric(t3); ) e2 += this._advance(), t3 = this._peekAhead();
      }
      if (s2) {
        const t3 = He.keywords[e2];
        if (t3) return this._addToken(t3), true;
      }
      if (s2 || r2) return this._addToken(He.tokens.ident), true;
      for (; ; ) {
        let t3 = this._findType(e2);
        const s3 = this._peekAhead();
        if ("-" == e2 && this._tokens.length > 0) {
          if ("=" == s3) return this._current++, e2 += s3, this._addToken(He.tokens.minus_equal), true;
          if ("-" == s3) return this._current++, e2 += s3, this._addToken(He.tokens.minus_minus), true;
          const n3 = this._tokens.length - 1;
          if ((-1 != He.literal_or_ident.indexOf(this._tokens[n3].type) || this._tokens[n3].type == He.tokens.paren_right) && ">" != s3) return this._addToken(t3), true;
        }
        if (">" == e2 && (">" == s3 || "=" == s3)) {
          let e3 = false, n3 = this._tokens.length - 1;
          for (let t4 = 0; t4 < 5 && n3 >= 0 && -1 === He.assignment_operators.indexOf(this._tokens[n3].type); ++t4, --n3) if (this._tokens[n3].type === He.tokens.less_than) {
            n3 > 0 && this._tokens[n3 - 1].isArrayOrTemplateType() && (e3 = true);
            break;
          }
          if (e3) return this._addToken(t3), true;
        }
        if (t3 === He.none) {
          let s4 = e2, r3 = 0;
          const a2 = 2;
          for (let e3 = 0; e3 < a2; ++e3) if (s4 += this._peekAhead(e3), t3 = this._findType(s4), t3 !== He.none) {
            r3 = e3;
            break;
          }
          if (t3 === He.none) return n2 !== He.none && (this._current--, this._addToken(n2), true);
          e2 = s4, this._current += r3 + 1;
        }
        if (n2 = t3, this._isAtEnd()) break;
        e2 += this._advance();
      }
      return n2 !== He.none && (this._addToken(n2), true);
    }
    _findType(e2) {
      for (const t3 in He.regexTokens) {
        const n2 = He.regexTokens[t3];
        if (this._match(e2, n2.rule)) return n2;
      }
      const t2 = He.literalTokens[e2];
      return t2 || He.none;
    }
    _match(e2, t2) {
      const n2 = t2.exec(e2);
      return n2 && 0 == n2.index && n2[0] == e2;
    }
    _isAtEnd() {
      return this._current >= this._source.length;
    }
    _isAlpha(e2) {
      return !this._isNumeric(e2) && !this._isWhitespace(e2) && "_" !== e2 && "." !== e2 && "(" !== e2 && ")" !== e2 && "[" !== e2 && "]" !== e2 && "{" !== e2 && "}" !== e2 && "," !== e2 && ";" !== e2 && ":" !== e2 && "=" !== e2 && "!" !== e2 && "<" !== e2 && ">" !== e2 && "+" !== e2 && "-" !== e2 && "*" !== e2 && "/" !== e2 && "%" !== e2 && "&" !== e2 && "|" !== e2 && "^" !== e2 && "~" !== e2 && "@" !== e2 && "#" !== e2 && "?" !== e2 && "'" !== e2 && "`" !== e2 && '"' !== e2 && "\\" !== e2 && "\n" !== e2 && "\r" !== e2 && "	" !== e2 && "\0" !== e2;
    }
    _isNumeric(e2) {
      return e2 >= "0" && e2 <= "9";
    }
    _isAlphaNumeric(e2) {
      return this._isAlpha(e2) || this._isNumeric(e2) || "_" === e2;
    }
    _isWhitespace(e2) {
      return " " == e2 || "	" == e2 || "\r" == e2;
    }
    _advance(e2 = 0) {
      let t2 = this._source[this._current];
      return e2 = e2 || 0, e2++, this._current += e2, t2;
    }
    _peekAhead(e2 = 0) {
      return e2 = e2 || 0, this._current + e2 >= this._source.length ? "\0" : this._source[this._current + e2];
    }
    _addToken(e2) {
      const t2 = this._source.substring(this._start, this._current);
      this._tokens.push(new ze(e2, t2, this._line, this._start, this._current));
    }
  };
  function Ge(e2) {
    return Array.isArray(e2) || (null == e2 ? void 0 : e2.buffer) instanceof ArrayBuffer;
  }
  var Xe = new Float32Array(1);
  var je = new Uint32Array(Xe.buffer);
  var Ze = new Uint32Array(Xe.buffer);
  var Qe = new Int32Array(1);
  var Ye = new Float32Array(Qe.buffer);
  var Ke = new Uint32Array(Qe.buffer);
  var Je = new Uint32Array(1);
  var et = new Float32Array(Je.buffer);
  var tt = new Int32Array(Je.buffer);
  function nt(e2, t2, n2) {
    if (t2 === n2) return e2;
    if ("f32" === t2) {
      if ("i32" === n2 || "x32" === n2) return Xe[0] = e2, je[0];
      if ("u32" === n2) return Xe[0] = e2, Ze[0];
    } else if ("i32" === t2 || "x32" === t2) {
      if ("f32" === n2) return Qe[0] = e2, Ye[0];
      if ("u32" === n2) return Qe[0] = e2, Ke[0];
    } else if ("u32" === t2) {
      if ("f32" === n2) return Je[0] = e2, et[0];
      if ("i32" === n2 || "x32" === n2) return Je[0] = e2, tt[0];
    }
    return console.error(`Unsupported cast from ${t2} to ${n2}`), e2;
  }
  var st = class {
    constructor(e2) {
      this.resources = null, this.inUse = false, this.info = null, this.node = e2;
    }
  };
  var rt = class {
    constructor(e2, t2) {
      this.align = e2, this.size = t2;
    }
  };
  var at = class _at {
    constructor() {
      this.uniforms = [], this.storage = [], this.textures = [], this.samplers = [], this.aliases = [], this.overrides = [], this.structs = [], this.entry = new d(), this.functions = [], this._types = /* @__PURE__ */ new Map(), this._functions = /* @__PURE__ */ new Map();
    }
    _isStorageTexture(e2) {
      return "texture_storage_1d" == e2.name || "texture_storage_2d" == e2.name || "texture_storage_2d_array" == e2.name || "texture_storage_3d" == e2.name;
    }
    updateAST(e2) {
      for (const t2 of e2) t2 instanceof D && this._functions.set(t2.name, new st(t2));
      for (const t2 of e2) if (t2 instanceof oe) {
        const e3 = this.getTypeInfo(t2, null);
        e3 instanceof n && this.structs.push(e3);
      }
      for (const t2 of e2) if (t2 instanceof te) this.aliases.push(this._getAliasInfo(t2));
      else {
        if (t2 instanceof M) {
          const e3 = t2, n2 = this._getAttributeNum(e3.attributes, "id", 0), s2 = null != e3.type ? this.getTypeInfo(e3.type, e3.attributes) : null;
          this.overrides.push(new h(e3.name, s2, e3.attributes, n2));
          continue;
        }
        if (this._isUniformVar(t2)) {
          const e3 = t2, n2 = this._getAttributeNum(e3.attributes, "group", 0), s2 = this._getAttributeNum(e3.attributes, "binding", 0), r2 = this.getTypeInfo(e3.type, e3.attributes), a2 = new o(e3.name, r2, n2, s2, e3.attributes, i.Uniform, e3.access);
          a2.access || (a2.access = "read"), this.uniforms.push(a2);
          continue;
        }
        if (this._isStorageVar(t2)) {
          const e3 = t2, n2 = this._getAttributeNum(e3.attributes, "group", 0), s2 = this._getAttributeNum(e3.attributes, "binding", 0), r2 = this.getTypeInfo(e3.type, e3.attributes), a2 = this._isStorageTexture(r2), c2 = new o(e3.name, r2, n2, s2, e3.attributes, a2 ? i.StorageTexture : i.Storage, e3.access);
          c2.access || (c2.access = "read"), this.storage.push(c2);
          continue;
        }
        if (this._isTextureVar(t2)) {
          const e3 = t2, n2 = this._getAttributeNum(e3.attributes, "group", 0), s2 = this._getAttributeNum(e3.attributes, "binding", 0), r2 = this.getTypeInfo(e3.type, e3.attributes), a2 = this._isStorageTexture(r2), c2 = new o(e3.name, r2, n2, s2, e3.attributes, a2 ? i.StorageTexture : i.Texture, e3.access);
          c2.access || (c2.access = "read"), a2 ? this.storage.push(c2) : this.textures.push(c2);
          continue;
        }
        if (this._isSamplerVar(t2)) {
          const e3 = t2, n2 = this._getAttributeNum(e3.attributes, "group", 0), s2 = this._getAttributeNum(e3.attributes, "binding", 0), r2 = this.getTypeInfo(e3.type, e3.attributes), a2 = new o(e3.name, r2, n2, s2, e3.attributes, i.Sampler, e3.access);
          this.samplers.push(a2);
          continue;
        }
      }
      for (const t2 of e2) if (t2 instanceof D) {
        const e3 = this._getAttribute(t2, "vertex"), n2 = this._getAttribute(t2, "fragment"), s2 = this._getAttribute(t2, "compute"), r2 = e3 || n2 || s2, a2 = new p(t2.name, null == r2 ? void 0 : r2.name, t2.attributes);
        a2.attributes = t2.attributes, a2.startLine = t2.startLine, a2.endLine = t2.endLine, this.functions.push(a2), this._functions.get(t2.name).info = a2, r2 && (this._functions.get(t2.name).inUse = true, a2.inUse = true, a2.resources = this._findResources(t2, !!r2), a2.inputs = this._getInputs(t2.args), a2.outputs = this._getOutputs(t2.returnType), this.entry[r2.name].push(a2)), a2.arguments = t2.args.map((e4) => new f(e4.name, this.getTypeInfo(e4.type, e4.attributes), e4.attributes)), a2.returnType = t2.returnType ? this.getTypeInfo(t2.returnType, t2.attributes) : null;
        continue;
      }
      for (const e3 of this._functions.values()) e3.info && (e3.info.inUse = e3.inUse, this._addCalls(e3.node, e3.info.calls));
      for (const e3 of this._functions.values()) e3.node.search((t2) => {
        var n2, s2, r2;
        if (t2 instanceof De) {
          if (t2.value) if (Ge(t2.value)) for (const s3 of t2.value) for (const t3 of this.overrides) s3 === t3.name && (null === (n2 = e3.info) || void 0 === n2 || n2.overrides.push(t3));
          else for (const n3 of this.overrides) t2.value === n3.name && (null === (s2 = e3.info) || void 0 === s2 || s2.overrides.push(n3));
        } else if (t2 instanceof ge) for (const n3 of this.overrides) t2.name === n3.name && (null === (r2 = e3.info) || void 0 === r2 || r2.overrides.push(n3));
      });
      for (const e3 of this.uniforms) this._markStructsInUse(e3.type);
      for (const e3 of this.storage) this._markStructsInUse(e3.type);
    }
    getFunctionInfo(e2) {
      for (const t2 of this.functions) if (t2.name == e2) return t2;
      return null;
    }
    getStructInfo(e2) {
      for (const t2 of this.structs) if (t2.name == e2) return t2;
      return null;
    }
    getOverrideInfo(e2) {
      for (const t2 of this.overrides) if (t2.name == e2) return t2;
      return null;
    }
    _markStructsInUse(e2) {
      if (e2) if (e2.isStruct) {
        if (e2.inUse = true, e2.members) for (const t2 of e2.members) this._markStructsInUse(t2.type);
      } else if (e2.isArray) this._markStructsInUse(e2.format);
      else if (e2.isTemplate) e2.format && this._markStructsInUse(e2.format);
      else {
        const t2 = this._getAlias(e2.name);
        t2 && this._markStructsInUse(t2);
      }
    }
    _addCalls(e2, t2) {
      var n2;
      for (const s2 of e2.calls) {
        const e3 = null === (n2 = this._functions.get(s2.name)) || void 0 === n2 ? void 0 : n2.info;
        e3 && t2.add(e3);
      }
    }
    findResource(e2, t2, n2) {
      if (n2) {
        for (const s2 of this.entry.compute) if (s2.name === n2) {
          for (const n3 of s2.resources) if (n3.group == e2 && n3.binding == t2) return n3;
        }
        for (const s2 of this.entry.vertex) if (s2.name === n2) {
          for (const n3 of s2.resources) if (n3.group == e2 && n3.binding == t2) return n3;
        }
        for (const s2 of this.entry.fragment) if (s2.name === n2) {
          for (const n3 of s2.resources) if (n3.group == e2 && n3.binding == t2) return n3;
        }
      }
      for (const n3 of this.uniforms) if (n3.group == e2 && n3.binding == t2) return n3;
      for (const n3 of this.storage) if (n3.group == e2 && n3.binding == t2) return n3;
      for (const n3 of this.textures) if (n3.group == e2 && n3.binding == t2) return n3;
      for (const n3 of this.samplers) if (n3.group == e2 && n3.binding == t2) return n3;
      return null;
    }
    _findResource(e2) {
      for (const t2 of this.uniforms) if (t2.name == e2) return t2;
      for (const t2 of this.storage) if (t2.name == e2) return t2;
      for (const t2 of this.textures) if (t2.name == e2) return t2;
      for (const t2 of this.samplers) if (t2.name == e2) return t2;
      return null;
    }
    _markStructsFromAST(e2) {
      const t2 = this.getTypeInfo(e2, null);
      this._markStructsInUse(t2);
    }
    _findResources(e2, t2) {
      const n2 = [], s2 = this, r2 = [];
      return e2.search((a2) => {
        if (a2 instanceof E) r2.push({});
        else if (a2 instanceof $) r2.pop();
        else if (a2 instanceof F) {
          const e3 = a2;
          t2 && null !== e3.type && this._markStructsFromAST(e3.type), r2.length > 0 && (r2[r2.length - 1][e3.name] = e3);
        } else if (a2 instanceof de) {
          const e3 = a2;
          t2 && null !== e3.type && this._markStructsFromAST(e3.type);
        } else if (a2 instanceof U) {
          const e3 = a2;
          t2 && null !== e3.type && this._markStructsFromAST(e3.type), r2.length > 0 && (r2[r2.length - 1][e3.name] = e3);
        } else if (a2 instanceof ge) {
          const e3 = a2;
          if (r2.length > 0) {
            if (r2[r2.length - 1][e3.name]) return;
          }
          const t3 = s2._findResource(e3.name);
          t3 && n2.push(t3);
        } else if (a2 instanceof me) {
          const r3 = a2, i2 = s2._functions.get(r3.name);
          i2 && (t2 && (i2.inUse = true), e2.calls.add(i2.node), null === i2.resources && (i2.resources = s2._findResources(i2.node, t2)), n2.push(...i2.resources));
        } else if (a2 instanceof X) {
          const r3 = a2, i2 = s2._functions.get(r3.name);
          i2 && (t2 && (i2.inUse = true), e2.calls.add(i2.node), null === i2.resources && (i2.resources = s2._findResources(i2.node, t2)), n2.push(...i2.resources));
        }
      }), [...new Map(n2.map((e3) => [e3.name, e3])).values()];
    }
    getBindGroups() {
      const e2 = [];
      function t2(t3, n2) {
        t3 >= e2.length && (e2.length = t3 + 1), void 0 === e2[t3] && (e2[t3] = []), n2 >= e2[t3].length && (e2[t3].length = n2 + 1);
      }
      for (const n2 of this.uniforms) {
        t2(n2.group, n2.binding);
        e2[n2.group][n2.binding] = n2;
      }
      for (const n2 of this.storage) {
        t2(n2.group, n2.binding);
        e2[n2.group][n2.binding] = n2;
      }
      for (const n2 of this.textures) {
        t2(n2.group, n2.binding);
        e2[n2.group][n2.binding] = n2;
      }
      for (const n2 of this.samplers) {
        t2(n2.group, n2.binding);
        e2[n2.group][n2.binding] = n2;
      }
      return e2;
    }
    _getOutputs(e2, t2 = void 0) {
      if (void 0 === t2 && (t2 = []), e2 instanceof oe) this._getStructOutputs(e2, t2);
      else {
        const n2 = this._getOutputInfo(e2);
        null !== n2 && t2.push(n2);
      }
      return t2;
    }
    _getStructOutputs(e2, t2) {
      for (const n2 of e2.members) if (n2.type instanceof oe) this._getStructOutputs(n2.type, t2);
      else {
        const e3 = this._getAttribute(n2, "location") || this._getAttribute(n2, "builtin");
        if (null !== e3) {
          const s2 = this.getTypeInfo(n2.type, n2.type.attributes), r2 = this._parseInt(e3.value), a2 = new u(n2.name, s2, e3.name, r2);
          t2.push(a2);
        }
      }
    }
    _getOutputInfo(e2) {
      const t2 = this._getAttribute(e2, "location") || this._getAttribute(e2, "builtin");
      if (null !== t2) {
        const n2 = this.getTypeInfo(e2, e2.attributes), s2 = this._parseInt(t2.value);
        return new u("", n2, t2.name, s2);
      }
      return null;
    }
    _getInputs(e2, t2 = void 0) {
      void 0 === t2 && (t2 = []);
      for (const n2 of e2) if (n2.type instanceof oe) this._getStructInputs(n2.type, t2);
      else {
        const e3 = this._getInputInfo(n2);
        null !== e3 && t2.push(e3);
      }
      return t2;
    }
    _getStructInputs(e2, t2) {
      for (const n2 of e2.members) if (n2.type instanceof oe) this._getStructInputs(n2.type, t2);
      else {
        const e3 = this._getInputInfo(n2);
        null !== e3 && t2.push(e3);
      }
    }
    _getInputInfo(e2) {
      const t2 = this._getAttribute(e2, "location") || this._getAttribute(e2, "builtin");
      if (null !== t2) {
        const n2 = this._getAttribute(e2, "interpolation"), s2 = this.getTypeInfo(e2.type, e2.attributes), r2 = this._parseInt(t2.value), a2 = new l(e2.name, s2, t2.name, r2);
        return null !== n2 && (a2.interpolation = this._parseString(n2.value)), a2;
      }
      return null;
    }
    _parseString(e2) {
      return e2 instanceof Array && (e2 = e2[0]), e2;
    }
    _parseInt(e2) {
      e2 instanceof Array && (e2 = e2[0]);
      const t2 = parseInt(e2);
      return isNaN(t2) ? e2 : t2;
    }
    _getAlias(e2) {
      for (const t2 of this.aliases) if (t2.name == e2) return t2.type;
      return null;
    }
    _getAliasInfo(e2) {
      return new c(e2.name, this.getTypeInfo(e2.type, null));
    }
    getTypeInfoByName(e2) {
      for (const t2 of this.structs) if (t2.name == e2) return t2;
      for (const t2 of this.aliases) if (t2.name == e2) return t2.type;
      return null;
    }
    getTypeInfo(i2, o2 = null) {
      if (this._types.has(i2)) return this._types.get(i2);
      if (i2 instanceof le) {
        const e2 = i2.type ? this.getTypeInfo(i2.type, i2.attributes) : null, t2 = new r(i2.name, e2, o2);
        return this._types.set(i2, t2), this._updateTypeInfo(t2), t2;
      }
      if (i2 instanceof ue) {
        const e2 = i2, t2 = e2.format ? this.getTypeInfo(e2.format, e2.attributes) : null, n2 = new s(e2.name, o2);
        return n2.format = t2, n2.count = e2.count, this._types.set(i2, n2), this._updateTypeInfo(n2), n2;
      }
      if (i2 instanceof oe) {
        const e2 = i2, s2 = new n(e2.name, o2);
        s2.startLine = e2.startLine, s2.endLine = e2.endLine;
        for (const n2 of e2.members) {
          const e3 = this.getTypeInfo(n2.type, n2.attributes);
          s2.members.push(new t(n2.name, e3, n2.attributes));
        }
        return this._types.set(i2, s2), this._updateTypeInfo(s2), s2;
      }
      if (i2 instanceof he) {
        const t2 = i2, n2 = t2.format instanceof ae, s2 = t2.format ? n2 ? this.getTypeInfo(t2.format, null) : new e(t2.format, null) : null, r2 = new a(t2.name, s2, o2, t2.access);
        return this._types.set(i2, r2), this._updateTypeInfo(r2), r2;
      }
      if (i2 instanceof ce) {
        const e2 = i2, t2 = e2.format ? this.getTypeInfo(e2.format, null) : null, n2 = new a(e2.name, t2, o2, e2.access);
        return this._types.set(i2, n2), this._updateTypeInfo(n2), n2;
      }
      const c2 = new e(i2.name, o2);
      return this._types.set(i2, c2), this._updateTypeInfo(c2), c2;
    }
    _updateTypeInfo(e2) {
      var t2, a2, i2;
      const o2 = this._getTypeSize(e2);
      if (e2.size = null !== (t2 = null == o2 ? void 0 : o2.size) && void 0 !== t2 ? t2 : 0, e2 instanceof s && e2.format) {
        const t3 = this._getTypeSize(e2.format);
        e2.stride = Math.max(null !== (a2 = null == t3 ? void 0 : t3.size) && void 0 !== a2 ? a2 : 0, null !== (i2 = null == t3 ? void 0 : t3.align) && void 0 !== i2 ? i2 : 0), this._updateTypeInfo(e2.format);
      }
      e2 instanceof r && this._updateTypeInfo(e2.format), e2 instanceof n && this._updateStructInfo(e2);
    }
    _updateStructInfo(e2) {
      var t2;
      let n2 = 0, s2 = 0, r2 = 0, a2 = 0;
      for (let i2 = 0, o2 = e2.members.length; i2 < o2; ++i2) {
        const o3 = e2.members[i2], c2 = this._getTypeSize(o3);
        if (!c2) continue;
        null !== (t2 = this._getAlias(o3.type.name)) && void 0 !== t2 || o3.type;
        const l2 = c2.align, u2 = c2.size;
        n2 = this._roundUp(l2, n2 + s2), s2 = u2, r2 = n2, a2 = Math.max(a2, l2), o3.offset = n2, o3.size = u2, this._updateTypeInfo(o3.type);
      }
      e2.size = this._roundUp(a2, r2 + s2), e2.align = a2;
    }
    _getTypeSize(r2) {
      var a2, i2;
      if (null == r2) return null;
      const o2 = this._getAttributeNum(r2.attributes, "size", 0), c2 = this._getAttributeNum(r2.attributes, "align", 0);
      if (r2 instanceof t && (r2 = r2.type), r2 instanceof e) {
        const e2 = this._getAlias(r2.name);
        null !== e2 && (r2 = e2);
      }
      {
        const e2 = _at._typeInfo[r2.name];
        if (void 0 !== e2) {
          const t2 = "f16" === (null === (a2 = r2.format) || void 0 === a2 ? void 0 : a2.name) ? 2 : 1;
          return new rt(Math.max(c2, e2.align / t2), Math.max(o2, e2.size / t2));
        }
      }
      {
        const e2 = _at._typeInfo[r2.name.substring(0, r2.name.length - 1)];
        if (e2) {
          const t2 = "h" === r2.name[r2.name.length - 1] ? 2 : 1;
          return new rt(Math.max(c2, e2.align / t2), Math.max(o2, e2.size / t2));
        }
      }
      if (r2 instanceof s) {
        let e2 = r2, t2 = 8, n2 = 8;
        const s2 = this._getTypeSize(e2.format);
        null !== s2 && (n2 = s2.size, t2 = s2.align);
        return n2 = e2.count * this._getAttributeNum(null !== (i2 = null == r2 ? void 0 : r2.attributes) && void 0 !== i2 ? i2 : null, "stride", this._roundUp(t2, n2)), o2 && (n2 = o2), new rt(Math.max(c2, t2), Math.max(o2, n2));
      }
      if (r2 instanceof n) {
        let e2 = 0, t2 = 0, n2 = 0, s2 = 0, a3 = 0;
        for (const t3 of r2.members) {
          const r3 = this._getTypeSize(t3.type);
          null !== r3 && (e2 = Math.max(r3.align, e2), n2 = this._roundUp(r3.align, n2 + s2), s2 = r3.size, a3 = n2);
        }
        return t2 = this._roundUp(e2, a3 + s2), new rt(Math.max(c2, e2), Math.max(o2, t2));
      }
      return null;
    }
    _isUniformVar(e2) {
      return e2 instanceof F && "uniform" == e2.storage;
    }
    _isStorageVar(e2) {
      return e2 instanceof F && "storage" == e2.storage;
    }
    _isTextureVar(e2) {
      return e2 instanceof F && null !== e2.type && -1 != _at._textureTypes.indexOf(e2.type.name);
    }
    _isSamplerVar(e2) {
      return e2 instanceof F && null !== e2.type && -1 != _at._samplerTypes.indexOf(e2.type.name);
    }
    _getAttribute(e2, t2) {
      const n2 = e2;
      if (!n2 || !n2.attributes) return null;
      const s2 = n2.attributes;
      for (let e3 of s2) if (e3.name == t2) return e3;
      return null;
    }
    _getAttributeNum(e2, t2, n2) {
      if (null === e2) return n2;
      for (let s2 of e2) if (s2.name == t2) {
        let e3 = null !== s2 && null !== s2.value ? s2.value : n2;
        return e3 instanceof Array && (e3 = e3[0]), "number" == typeof e3 ? e3 : "string" == typeof e3 ? parseInt(e3) : n2;
      }
      return n2;
    }
    _roundUp(e2, t2) {
      return Math.ceil(t2 / e2) * e2;
    }
  };
  at._typeInfo = { f16: { align: 2, size: 2 }, i32: { align: 4, size: 4 }, u32: { align: 4, size: 4 }, f32: { align: 4, size: 4 }, atomic: { align: 4, size: 4 }, vec2: { align: 8, size: 8 }, vec3: { align: 16, size: 12 }, vec4: { align: 16, size: 16 }, mat2x2: { align: 8, size: 16 }, mat3x2: { align: 8, size: 24 }, mat4x2: { align: 8, size: 32 }, mat2x3: { align: 16, size: 32 }, mat3x3: { align: 16, size: 48 }, mat4x3: { align: 16, size: 64 }, mat2x4: { align: 16, size: 32 }, mat3x4: { align: 16, size: 48 }, mat4x4: { align: 16, size: 64 } }, at._textureTypes = He.any_texture_type.map((e2) => e2.name), at._samplerTypes = He.sampler_type.map((e2) => e2.name);
  var it = 0;
  var ot = class _ot {
    constructor(e2, t2, n2) {
      this.id = it++, this.name = e2, this.value = t2, this.node = n2;
    }
    clone() {
      return new _ot(this.name, this.value, this.node);
    }
  };
  var ct = class _ct {
    constructor(e2) {
      this.id = it++, this.name = e2.name, this.node = e2;
    }
    clone() {
      return new _ct(this.node);
    }
  };
  var lt = class _lt {
    constructor(e2) {
      this.parent = null, this.variables = /* @__PURE__ */ new Map(), this.functions = /* @__PURE__ */ new Map(), this.currentFunctionName = "", this.id = it++, e2 && (this.parent = e2, this.currentFunctionName = e2.currentFunctionName);
    }
    getVariable(e2) {
      var t2;
      return this.variables.has(e2) ? null !== (t2 = this.variables.get(e2)) && void 0 !== t2 ? t2 : null : this.parent ? this.parent.getVariable(e2) : null;
    }
    getFunction(e2) {
      var t2;
      return this.functions.has(e2) ? null !== (t2 = this.functions.get(e2)) && void 0 !== t2 ? t2 : null : this.parent ? this.parent.getFunction(e2) : null;
    }
    createVariable(e2, t2, n2) {
      this.variables.set(e2, new ot(e2, t2, null != n2 ? n2 : null));
    }
    setVariable(e2, t2, n2) {
      const s2 = this.getVariable(e2);
      null !== s2 ? s2.value = t2 : this.createVariable(e2, t2, n2);
    }
    getVariableValue(e2) {
      var t2;
      const n2 = this.getVariable(e2);
      return null !== (t2 = null == n2 ? void 0 : n2.value) && void 0 !== t2 ? t2 : null;
    }
    clone() {
      return new _lt(this);
    }
  };
  var ut = class {
    evalExpression(e2, t2) {
      return null;
    }
    getTypeInfo(e2) {
      return null;
    }
    getVariableName(e2, t2) {
      return "";
    }
  };
  var ht = class {
    constructor(e2) {
      this.exec = e2;
    }
    getTypeInfo(e2) {
      return this.exec.getTypeInfo(e2);
    }
    All(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      let s2 = true;
      if (n2 instanceof Me) return n2.data.forEach((e3) => {
        e3 || (s2 = false);
      }), new Be(s2 ? 1 : 0, this.getTypeInfo("bool"));
      throw new Error(`All() expects a vector argument. Line ${e2.line}`);
    }
    Any(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) {
        const e3 = n2.data.some((e4) => e4);
        return new Be(e3 ? 1 : 0, this.getTypeInfo("bool"));
      }
      throw new Error(`Any() expects a vector argument. Line ${e2.line}`);
    }
    Select(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[2], t2);
      if (!(n2 instanceof Be)) throw new Error(`Select() expects a bool condition. Line ${e2.line}`);
      return n2.value ? this.exec.evalExpression(e2.args[1], t2) : this.exec.evalExpression(e2.args[0], t2);
    }
    ArrayLength(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.evalExpression(n2, t2);
      if (s2 instanceof Pe && 0 === s2.typeInfo.size) {
        const e3 = s2.typeInfo, t3 = s2.buffer.byteLength / e3.stride;
        return new Be(t3, this.getTypeInfo("u32"));
      }
      return new Be(s2.typeInfo.size, this.getTypeInfo("u32"));
    }
    Abs(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.abs(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.abs(s2.value), s2.typeInfo);
    }
    Acos(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.acos(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.acos(s2.value), n2.typeInfo);
    }
    Acosh(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.acosh(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.acosh(s2.value), n2.typeInfo);
    }
    Asin(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.asin(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.asin(s2.value), n2.typeInfo);
    }
    Asinh(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.asinh(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.asinh(s2.value), n2.typeInfo);
    }
    Atan(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.atan(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.atan(s2.value), n2.typeInfo);
    }
    Atanh(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.atanh(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.atanh(s2.value), n2.typeInfo);
    }
    Atan2(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2);
      if (n2 instanceof Me && s2 instanceof Me) return new Me(n2.data.map((e3, t3) => Math.atan2(e3, s2.data[t3])), n2.typeInfo);
      const r2 = n2, a2 = s2;
      return new Be(Math.atan2(r2.value, a2.value), n2.typeInfo);
    }
    Ceil(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.ceil(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.ceil(s2.value), n2.typeInfo);
    }
    _clamp(e2, t2, n2) {
      return Math.min(Math.max(e2, t2), n2);
    }
    Clamp(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2), r2 = this.exec.evalExpression(e2.args[2], t2);
      if (n2 instanceof Me && s2 instanceof Me && r2 instanceof Me) return new Me(n2.data.map((e3, t3) => this._clamp(e3, s2.data[t3], r2.data[t3])), n2.typeInfo);
      const a2 = n2, i2 = s2, o2 = r2;
      return new Be(this._clamp(a2.value, i2.value, o2.value), n2.typeInfo);
    }
    Cos(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.cos(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.cos(s2.value), n2.typeInfo);
    }
    Cosh(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.cosh(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.cos(s2.value), n2.typeInfo);
    }
    CountLeadingZeros(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.clz32(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.clz32(s2.value), n2.typeInfo);
    }
    _countOneBits(e2) {
      let t2 = 0;
      for (; 0 !== e2; ) 1 & e2 && t2++, e2 >>= 1;
      return t2;
    }
    CountOneBits(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => this._countOneBits(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(this._countOneBits(s2.value), n2.typeInfo);
    }
    _countTrailingZeros(e2) {
      if (0 === e2) return 32;
      let t2 = 0;
      for (; !(1 & e2); ) e2 >>= 1, t2++;
      return t2;
    }
    CountTrailingZeros(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => this._countTrailingZeros(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(this._countTrailingZeros(s2.value), n2.typeInfo);
    }
    Cross(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2);
      if (n2 instanceof Me && s2 instanceof Me) {
        if (3 !== n2.data.length || 3 !== s2.data.length) return console.error(`Cross() expects 3D vectors. Line ${e2.line}`), null;
        const t3 = n2.data, r2 = s2.data;
        return new Me([t3[1] * r2[2] - r2[1] * t3[2], t3[2] * r2[0] - r2[2] * t3[0], t3[0] * r2[1] - r2[0] * t3[1]], n2.typeInfo);
      }
      return console.error(`Cross() expects vector arguments. Line ${e2.line}`), null;
    }
    Degrees(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = 180 / Math.PI;
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => e3 * s2), n2.typeInfo);
      return new Be(n2.value * s2, this.getTypeInfo("f32"));
    }
    Determinant(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Ue) {
        const e3 = n2.data, t3 = n2.typeInfo.getTypeName(), s2 = t3.endsWith("h") ? this.getTypeInfo("f16") : this.getTypeInfo("f32");
        if ("mat2x2" === t3 || "mat2x2f" === t3 || "mat2x2h" === t3) return new Be(e3[0] * e3[3] - e3[1] * e3[2], s2);
        if ("mat2x3" === t3 || "mat2x3f" === t3 || "mat2x3h" === t3) return new Be(e3[0] * (e3[4] * e3[8] - e3[5] * e3[7]) - e3[1] * (e3[3] * e3[8] - e3[5] * e3[6]) + e3[2] * (e3[3] * e3[7] - e3[4] * e3[6]), s2);
        if ("mat2x4" === t3 || "mat2x4f" === t3 || "mat2x4h" === t3) console.error(`TODO: Determinant for ${t3}`);
        else if ("mat3x2" === t3 || "mat3x2f" === t3 || "mat3x2h" === t3) console.error(`TODO: Determinant for ${t3}`);
        else {
          if ("mat3x3" === t3 || "mat3x3f" === t3 || "mat3x3h" === t3) return new Be(e3[0] * (e3[4] * e3[8] - e3[5] * e3[7]) - e3[1] * (e3[3] * e3[8] - e3[5] * e3[6]) + e3[2] * (e3[3] * e3[7] - e3[4] * e3[6]), s2);
          "mat3x4" === t3 || "mat3x4f" === t3 || "mat3x4h" === t3 || "mat4x2" === t3 || "mat4x2f" === t3 || "mat4x2h" === t3 || "mat4x3" === t3 || "mat4x3f" === t3 || "mat4x3h" === t3 ? console.error(`TODO: Determinant for ${t3}`) : "mat4x4" !== t3 && "mat4x4f" !== t3 && "mat4x4h" !== t3 || console.error(`TODO: Determinant for ${t3}`);
        }
      }
      return console.error(`Determinant expects a matrix argument. Line ${e2.line}`), null;
    }
    Distance(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2);
      if (n2 instanceof Me && s2 instanceof Me) {
        let e3 = 0;
        for (let t3 = 0; t3 < n2.data.length; ++t3) e3 += (n2.data[t3] - s2.data[t3]) * (n2.data[t3] - s2.data[t3]);
        return new Be(Math.sqrt(e3), this.getTypeInfo("f32"));
      }
      const r2 = n2, a2 = s2;
      return new Be(Math.abs(r2.value - a2.value), n2.typeInfo);
    }
    _dot(e2, t2) {
      let n2 = 0;
      for (let s2 = 0; s2 < e2.length; ++s2) n2 += t2[s2] * e2[s2];
      return n2;
    }
    Dot(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2);
      return n2 instanceof Me && s2 instanceof Me ? new Be(this._dot(n2.data, s2.data), this.getTypeInfo("f32")) : (console.error(`Dot() expects vector arguments. Line ${e2.line}`), null);
    }
    Dot4U8Packed(e2, t2) {
      return console.error(`TODO: dot4U8Packed. Line ${e2.line}`), null;
    }
    Dot4I8Packed(e2, t2) {
      return console.error(`TODO: dot4I8Packed. Line ${e2.line}`), null;
    }
    Exp(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.exp(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.exp(s2.value), n2.typeInfo);
    }
    Exp2(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.pow(2, e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.pow(2, s2.value), n2.typeInfo);
    }
    ExtractBits(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2), r2 = this.exec.evalExpression(e2.args[2], t2);
      if ("u32" !== s2.typeInfo.name && "x32" !== s2.typeInfo.name) return console.error(`ExtractBits() expects an i32 offset argument. Line ${e2.line}`), null;
      if ("u32" !== r2.typeInfo.name && "x32" !== r2.typeInfo.name) return console.error(`ExtractBits() expects an i32 count argument. Line ${e2.line}`), null;
      const a2 = s2.value, i2 = r2.value;
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => e3 >> a2 & (1 << i2) - 1), n2.typeInfo);
      if ("i32" !== n2.typeInfo.name && "x32" !== n2.typeInfo.name) return console.error(`ExtractBits() expects an i32 argument. Line ${e2.line}`), null;
      const o2 = n2.value;
      return new Be(o2 >> a2 & (1 << i2) - 1, this.getTypeInfo("i32"));
    }
    FaceForward(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2), r2 = this.exec.evalExpression(e2.args[2], t2);
      if (n2 instanceof Me && s2 instanceof Me && r2 instanceof Me) {
        const e3 = this._dot(s2.data, r2.data);
        return new Me(e3 < 0 ? Array.from(n2.data) : n2.data.map((e4) => -e4), n2.typeInfo);
      }
      return console.error(`FaceForward() expects vector arguments. Line ${e2.line}`), null;
    }
    _firstLeadingBit(e2) {
      return 0 === e2 ? -1 : 31 - Math.clz32(e2);
    }
    FirstLeadingBit(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => this._firstLeadingBit(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(this._firstLeadingBit(s2.value), n2.typeInfo);
    }
    _firstTrailingBit(e2) {
      return 0 === e2 ? -1 : Math.log2(e2 & -e2);
    }
    FirstTrailingBit(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => this._firstTrailingBit(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(this._firstTrailingBit(s2.value), n2.typeInfo);
    }
    Floor(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.floor(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.floor(s2.value), n2.typeInfo);
    }
    Fma(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2), r2 = this.exec.evalExpression(e2.args[2], t2);
      if (n2 instanceof Me && s2 instanceof Me && r2 instanceof Me) return n2.data.length !== s2.data.length || n2.data.length !== r2.data.length ? (console.error(`Fma() expects vectors of the same length. Line ${e2.line}`), null) : new Me(n2.data.map((e3, t3) => e3 * s2.data[t3] + r2.data[t3]), n2.typeInfo);
      const a2 = n2, i2 = s2, o2 = r2;
      return new Be(a2.value * i2.value + o2.value, a2.typeInfo);
    }
    Fract(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => e3 - Math.floor(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(s2.value - Math.floor(s2.value), n2.typeInfo);
    }
    Frexp(e2, t2) {
      return console.error(`TODO: frexp. Line ${e2.line}`), null;
    }
    InsertBits(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2), r2 = this.exec.evalExpression(e2.args[2], t2), a2 = this.exec.evalExpression(e2.args[3], t2);
      if ("u32" !== r2.typeInfo.name && "x32" !== r2.typeInfo.name) return console.error(`InsertBits() expects an i32 offset argument. Line ${e2.line}`), null;
      const i2 = r2.value, o2 = (1 << a2.value) - 1 << i2, c2 = ~o2;
      if (n2 instanceof Me && s2 instanceof Me) return new Me(n2.data.map((e3, t3) => e3 & c2 | s2.data[t3] << i2 & o2), n2.typeInfo);
      const l2 = n2.value, u2 = s2.value;
      return new Be(l2 & c2 | u2 << i2 & o2, n2.typeInfo);
    }
    InverseSqrt(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => 1 / Math.sqrt(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(1 / Math.sqrt(s2.value), n2.typeInfo);
    }
    Ldexp(e2, t2) {
      return console.error(`TODO: ldexp. Line ${e2.line}`), null;
    }
    Length(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) {
        let e3 = 0;
        return n2.data.forEach((t3) => {
          e3 += t3 * t3;
        }), new Be(Math.sqrt(e3), this.getTypeInfo("f32"));
      }
      const s2 = n2;
      return new Be(Math.abs(s2.value), n2.typeInfo);
    }
    Log(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.log(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.log(s2.value), n2.typeInfo);
    }
    Log2(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.log2(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.log2(s2.value), n2.typeInfo);
    }
    Max(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2);
      if (n2 instanceof Me && s2 instanceof Me) return new Me(n2.data.map((e3, t3) => Math.max(e3, s2.data[t3])), n2.typeInfo);
      const r2 = n2, a2 = s2;
      return new Be(Math.max(r2.value, a2.value), n2.typeInfo);
    }
    Min(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2);
      if (n2 instanceof Me && s2 instanceof Me) return new Me(n2.data.map((e3, t3) => Math.min(e3, s2.data[t3])), n2.typeInfo);
      const r2 = n2, a2 = s2;
      return new Be(Math.min(r2.value, a2.value), n2.typeInfo);
    }
    Mix(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2), r2 = this.exec.evalExpression(e2.args[2], t2);
      if (n2 instanceof Me && s2 instanceof Me && r2 instanceof Me) return new Me(n2.data.map((e3, t3) => n2.data[t3] * (1 - r2.data[t3]) + s2.data[t3] * r2.data[t3]), n2.typeInfo);
      const a2 = s2, i2 = r2;
      return new Be(n2.value * (1 - i2.value) + a2.value * i2.value, n2.typeInfo);
    }
    Modf(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2);
      if (n2 instanceof Me && s2 instanceof Me) return new Me(n2.data.map((e3, t3) => e3 % s2.data[t3]), n2.typeInfo);
      const r2 = s2;
      return new Be(n2.value % r2.value, n2.typeInfo);
    }
    Normalize(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) {
        const s2 = this.Length(e2, t2).value;
        return new Me(n2.data.map((e3) => e3 / s2), n2.typeInfo);
      }
      return console.error(`Normalize() expects a vector argument. Line ${e2.line}`), null;
    }
    Pow(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2);
      if (n2 instanceof Me && s2 instanceof Me) return new Me(n2.data.map((e3, t3) => Math.pow(e3, s2.data[t3])), n2.typeInfo);
      const r2 = n2, a2 = s2;
      return new Be(Math.pow(r2.value, a2.value), n2.typeInfo);
    }
    QuantizeToF16(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => e3), n2.typeInfo);
      return new Be(n2.value, n2.typeInfo);
    }
    Radians(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => e3 * Math.PI / 180), n2.typeInfo);
      return new Be(n2.value * Math.PI / 180, this.getTypeInfo("f32"));
    }
    Reflect(e2, t2) {
      let n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2);
      if (n2 instanceof Me && s2 instanceof Me) {
        const e3 = this._dot(n2.data, s2.data);
        return new Me(n2.data.map((t3, n3) => t3 - 2 * e3 * s2.data[n3]), n2.typeInfo);
      }
      return console.error(`Reflect() expects vector arguments. Line ${e2.line}`), null;
    }
    Refract(e2, t2) {
      let n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2), r2 = this.exec.evalExpression(e2.args[2], t2);
      if (n2 instanceof Me && s2 instanceof Me && r2 instanceof Be) {
        const e3 = this._dot(s2.data, n2.data);
        return new Me(n2.data.map((t3, n3) => {
          const a2 = 1 - r2.value * r2.value * (1 - e3 * e3);
          if (a2 < 0) return 0;
          const i2 = Math.sqrt(a2);
          return r2.value * t3 - (r2.value * e3 + i2) * s2.data[n3];
        }), n2.typeInfo);
      }
      return console.error(`Refract() expects vector arguments and a scalar argument. Line ${e2.line}`), null;
    }
    ReverseBits(e2, t2) {
      return console.error(`TODO: reverseBits. Line ${e2.line}`), null;
    }
    Round(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.round(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.round(s2.value), n2.typeInfo);
    }
    Saturate(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.min(Math.max(e3, 0), 1)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.min(Math.max(s2.value, 0), 1), n2.typeInfo);
    }
    Sign(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.sign(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.sign(s2.value), n2.typeInfo);
    }
    Sin(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.sin(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.sin(s2.value), n2.typeInfo);
    }
    Sinh(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.sinh(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.sinh(s2.value), n2.typeInfo);
    }
    _smoothstep(e2, t2, n2) {
      const s2 = Math.min(Math.max((n2 - e2) / (t2 - e2), 0), 1);
      return s2 * s2 * (3 - 2 * s2);
    }
    SmoothStep(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2), r2 = this.exec.evalExpression(e2.args[2], t2);
      if (r2 instanceof Me && n2 instanceof Me && s2 instanceof Me) return new Me(r2.data.map((e3, t3) => this._smoothstep(n2.data[t3], s2.data[t3], e3)), r2.typeInfo);
      const a2 = n2, i2 = s2, o2 = r2;
      return new Be(this._smoothstep(a2.value, i2.value, o2.value), r2.typeInfo);
    }
    Sqrt(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.sqrt(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.sqrt(s2.value), n2.typeInfo);
    }
    Step(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2), s2 = this.exec.evalExpression(e2.args[1], t2);
      if (s2 instanceof Me && n2 instanceof Me) return new Me(s2.data.map((e3, t3) => e3 < n2.data[t3] ? 0 : 1), s2.typeInfo);
      const r2 = n2;
      return new Be(s2.value < r2.value ? 0 : 1, r2.typeInfo);
    }
    Tan(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.tan(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.tan(s2.value), n2.typeInfo);
    }
    Tanh(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.tanh(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.tanh(s2.value), n2.typeInfo);
    }
    _getTransposeType(e2) {
      const t2 = e2.getTypeName();
      return "mat2x2f" === t2 || "mat2x2h" === t2 ? e2 : "mat2x3f" === t2 ? this.getTypeInfo("mat3x2f") : "mat2x3h" === t2 ? this.getTypeInfo("mat3x2h") : "mat2x4f" === t2 ? this.getTypeInfo("mat4x2f") : "mat2x4h" === t2 ? this.getTypeInfo("mat4x2h") : "mat3x2f" === t2 ? this.getTypeInfo("mat2x3f") : "mat3x2h" === t2 ? this.getTypeInfo("mat2x3h") : "mat3x3f" === t2 || "mat3x3h" === t2 ? e2 : "mat3x4f" === t2 ? this.getTypeInfo("mat4x3f") : "mat3x4h" === t2 ? this.getTypeInfo("mat4x3h") : "mat4x2f" === t2 ? this.getTypeInfo("mat2x4f") : "mat4x2h" === t2 ? this.getTypeInfo("mat2x4h") : "mat4x3f" === t2 ? this.getTypeInfo("mat3x4f") : "mat4x3h" === t2 ? this.getTypeInfo("mat3x4h") : ("mat4x4f" === t2 || "mat4x4h" === t2 || console.error(`Invalid matrix type ${t2}`), e2);
    }
    Transpose(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (!(n2 instanceof Ue)) return console.error(`Transpose() expects a matrix argument. Line ${e2.line}`), null;
      const s2 = this._getTransposeType(n2.typeInfo);
      if ("mat2x2" === n2.typeInfo.name || "mat2x2f" === n2.typeInfo.name || "mat2x2h" === n2.typeInfo.name) {
        const e3 = n2.data;
        return new Ue([e3[0], e3[2], e3[1], e3[3]], s2);
      }
      if ("mat2x3" === n2.typeInfo.name || "mat2x3f" === n2.typeInfo.name || "mat2x3h" === n2.typeInfo.name) {
        const e3 = n2.data;
        return new Ue([e3[0], e3[3], e3[6], e3[1], e3[4], e3[7]], s2);
      }
      if ("mat2x4" === n2.typeInfo.name || "mat2x4f" === n2.typeInfo.name || "mat2x4h" === n2.typeInfo.name) {
        const e3 = n2.data;
        return new Ue([e3[0], e3[4], e3[8], e3[12], e3[1], e3[5], e3[9], e3[13]], s2);
      }
      if ("mat3x2" === n2.typeInfo.name || "mat3x2f" === n2.typeInfo.name || "mat3x2h" === n2.typeInfo.name) {
        const e3 = n2.data;
        return new Ue([e3[0], e3[3], e3[1], e3[4], e3[2], e3[5]], s2);
      }
      if ("mat3x3" === n2.typeInfo.name || "mat3x3f" === n2.typeInfo.name || "mat3x3h" === n2.typeInfo.name) {
        const e3 = n2.data;
        return new Ue([e3[0], e3[3], e3[6], e3[1], e3[4], e3[7], e3[2], e3[5], e3[8]], s2);
      }
      if ("mat3x4" === n2.typeInfo.name || "mat3x4f" === n2.typeInfo.name || "mat3x4h" === n2.typeInfo.name) {
        const e3 = n2.data;
        return new Ue([e3[0], e3[4], e3[8], e3[12], e3[1], e3[5], e3[9], e3[13], e3[2], e3[6], e3[10], e3[14]], s2);
      }
      if ("mat4x2" === n2.typeInfo.name || "mat4x2f" === n2.typeInfo.name || "mat4x2h" === n2.typeInfo.name) {
        const e3 = n2.data;
        return new Ue([e3[0], e3[4], e3[1], e3[5], e3[2], e3[6]], s2);
      }
      if ("mat4x3" === n2.typeInfo.name || "mat4x3f" === n2.typeInfo.name || "mat4x3h" === n2.typeInfo.name) {
        const e3 = n2.data;
        return new Ue([e3[0], e3[4], e3[8], e3[1], e3[5], e3[9], e3[2], e3[6], e3[10]], s2);
      }
      if ("mat4x4" === n2.typeInfo.name || "mat4x4f" === n2.typeInfo.name || "mat4x4h" === n2.typeInfo.name) {
        const e3 = n2.data;
        return new Ue([e3[0], e3[4], e3[8], e3[12], e3[1], e3[5], e3[9], e3[13], e3[2], e3[6], e3[10], e3[14], e3[3], e3[7], e3[11], e3[15]], s2);
      }
      return console.error(`Invalid matrix type ${n2.typeInfo.name}`), null;
    }
    Trunc(e2, t2) {
      const n2 = this.exec.evalExpression(e2.args[0], t2);
      if (n2 instanceof Me) return new Me(n2.data.map((e3) => Math.trunc(e3)), n2.typeInfo);
      const s2 = n2;
      return new Be(Math.trunc(s2.value), n2.typeInfo);
    }
    Dpdx(e2, t2) {
      return console.error(`TODO: dpdx. Line ${e2.line}`), null;
    }
    DpdxCoarse(e2, t2) {
      return console.error(`TODO: dpdxCoarse. Line ${e2.line}`), null;
    }
    DpdxFine(e2, t2) {
      return console.error("TODO: dpdxFine"), null;
    }
    Dpdy(e2, t2) {
      return console.error("TODO: dpdy"), null;
    }
    DpdyCoarse(e2, t2) {
      return console.error("TODO: dpdyCoarse"), null;
    }
    DpdyFine(e2, t2) {
      return console.error("TODO: dpdyFine"), null;
    }
    Fwidth(e2, t2) {
      return console.error("TODO: fwidth"), null;
    }
    FwidthCoarse(e2, t2) {
      return console.error("TODO: fwidthCoarse"), null;
    }
    FwidthFine(e2, t2) {
      return console.error("TODO: fwidthFine"), null;
    }
    TextureDimensions(e2, t2) {
      const n2 = e2.args[0], s2 = e2.args.length > 1 ? this.exec.evalExpression(e2.args[1], t2).value : 0;
      if (n2 instanceof ge) {
        const r2 = n2.name, a2 = t2.getVariableValue(r2);
        if (a2 instanceof We) {
          if (s2 < 0 || s2 >= a2.mipLevelCount) return console.error(`Invalid mip level for textureDimensions. Line ${e2.line}`), null;
          const t3 = a2.getMipLevelSize(s2), n3 = a2.dimension;
          return "1d" === n3 ? new Be(t3[0], this.getTypeInfo("u32")) : "3d" === n3 ? new Me(t3, this.getTypeInfo("vec3u")) : "2d" === n3 ? new Me(t3.slice(0, 2), this.getTypeInfo("vec2u")) : (console.error(`Invalid texture dimension ${n3} not found. Line ${e2.line}`), null);
        }
        return console.error(`Texture ${r2} not found. Line ${e2.line}`), null;
      }
      return console.error(`Invalid texture argument for textureDimensions. Line ${e2.line}`), null;
    }
    TextureGather(e2, t2) {
      return console.error("TODO: textureGather"), null;
    }
    TextureGatherCompare(e2, t2) {
      return console.error("TODO: textureGatherCompare"), null;
    }
    TextureLoad(e2, t2) {
      const n2 = e2.args[0], s2 = this.exec.evalExpression(e2.args[1], t2), r2 = e2.args.length > 2 ? this.exec.evalExpression(e2.args[2], t2).value : 0;
      if (!(s2 instanceof Me) || 2 !== s2.data.length) return console.error(`Invalid UV argument for textureLoad. Line ${e2.line}`), null;
      if (n2 instanceof ge) {
        const a2 = n2.name, i2 = t2.getVariableValue(a2);
        if (i2 instanceof We) {
          const t3 = Math.floor(s2.data[0]), n3 = Math.floor(s2.data[1]);
          if (t3 < 0 || t3 >= i2.width || n3 < 0 || n3 >= i2.height) return console.error(`Texture ${a2} out of bounds. Line ${e2.line}`), null;
          const o2 = i2.getPixel(t3, n3, 0, r2);
          return null === o2 ? (console.error(`Invalid texture format for textureLoad. Line ${e2.line}`), null) : new Me(o2, this.getTypeInfo("vec4f"));
        }
        return console.error(`Texture ${a2} not found. Line ${e2.line}`), null;
      }
      return console.error(`Invalid texture argument for textureLoad. Line ${e2.line}`), null;
    }
    TextureNumLayers(e2, t2) {
      const n2 = e2.args[0];
      if (n2 instanceof ge) {
        const s2 = n2.name, r2 = t2.getVariableValue(s2);
        return r2 instanceof We ? new Be(r2.depthOrArrayLayers, this.getTypeInfo("u32")) : (console.error(`Texture ${s2} not found. Line ${e2.line}`), null);
      }
      return console.error(`Invalid texture argument for textureNumLayers. Line ${e2.line}`), null;
    }
    TextureNumLevels(e2, t2) {
      const n2 = e2.args[0];
      if (n2 instanceof ge) {
        const s2 = n2.name, r2 = t2.getVariableValue(s2);
        return r2 instanceof We ? new Be(r2.mipLevelCount, this.getTypeInfo("u32")) : (console.error(`Texture ${s2} not found. Line ${e2.line}`), null);
      }
      return console.error(`Invalid texture argument for textureNumLevels. Line ${e2.line}`), null;
    }
    TextureNumSamples(e2, t2) {
      const n2 = e2.args[0];
      if (n2 instanceof ge) {
        const s2 = n2.name, r2 = t2.getVariableValue(s2);
        return r2 instanceof We ? new Be(r2.sampleCount, this.getTypeInfo("u32")) : (console.error(`Texture ${s2} not found. Line ${e2.line}`), null);
      }
      return console.error(`Invalid texture argument for textureNumSamples. Line ${e2.line}`), null;
    }
    TextureSample(e2, t2) {
      return console.error("TODO: textureSample"), null;
    }
    TextureSampleBias(e2, t2) {
      return console.error("TODO: textureSampleBias"), null;
    }
    TextureSampleCompare(e2, t2) {
      return console.error("TODO: textureSampleCompare"), null;
    }
    TextureSampleCompareLevel(e2, t2) {
      return console.error("TODO: textureSampleCompareLevel"), null;
    }
    TextureSampleGrad(e2, t2) {
      return console.error("TODO: textureSampleGrad"), null;
    }
    TextureSampleLevel(e2, t2) {
      return console.error("TODO: textureSampleLevel"), null;
    }
    TextureSampleBaseClampToEdge(e2, t2) {
      return console.error("TODO: textureSampleBaseClampToEdge"), null;
    }
    TextureStore(e2, t2) {
      const n2 = e2.args[0], s2 = this.exec.evalExpression(e2.args[1], t2), r2 = 4 === e2.args.length ? this.exec.evalExpression(e2.args[2], t2).value : 0, a2 = 4 === e2.args.length ? this.exec.evalExpression(e2.args[3], t2).data : this.exec.evalExpression(e2.args[2], t2).data;
      if (4 !== a2.length) return console.error(`Invalid value argument for textureStore. Line ${e2.line}`), null;
      if (!(s2 instanceof Me) || 2 !== s2.data.length) return console.error(`Invalid UV argument for textureStore. Line ${e2.line}`), null;
      if (n2 instanceof ge) {
        const i2 = n2.name, o2 = t2.getVariableValue(i2);
        if (o2 instanceof We) {
          const t3 = o2.getMipLevelSize(0), n3 = Math.floor(s2.data[0]), c2 = Math.floor(s2.data[1]);
          return n3 < 0 || n3 >= t3[0] || c2 < 0 || c2 >= t3[1] ? (console.error(`Texture ${i2} out of bounds. Line ${e2.line}`), null) : (o2.setPixel(n3, c2, 0, r2, Array.from(a2)), null);
        }
        return console.error(`Texture ${i2} not found. Line ${e2.line}`), null;
      }
      return console.error(`Invalid texture argument for textureStore. Line ${e2.line}`), null;
    }
    AtomicLoad(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.getVariableName(n2, t2);
      return t2.getVariable(s2).value.getSubData(this.exec, n2.postfix, t2);
    }
    AtomicStore(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.getVariableName(n2, t2), r2 = t2.getVariable(s2);
      let a2 = e2.args[1];
      const i2 = this.exec.evalExpression(a2, t2), o2 = r2.value.getSubData(this.exec, n2.postfix, t2);
      return o2 instanceof Be && i2 instanceof Be && (o2.value = i2.value), r2.value instanceof Pe && r2.value.setDataValue(this.exec, o2, n2.postfix, t2), null;
    }
    AtomicAdd(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.getVariableName(n2, t2), r2 = t2.getVariable(s2);
      let a2 = e2.args[1];
      const i2 = this.exec.evalExpression(a2, t2), o2 = r2.value.getSubData(this.exec, n2.postfix, t2), c2 = new Be(o2.value, o2.typeInfo);
      return o2 instanceof Be && i2 instanceof Be && (o2.value += i2.value), r2.value instanceof Pe && r2.value.setDataValue(this.exec, o2, n2.postfix, t2), c2;
    }
    AtomicSub(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.getVariableName(n2, t2), r2 = t2.getVariable(s2);
      let a2 = e2.args[1];
      const i2 = this.exec.evalExpression(a2, t2), o2 = r2.value.getSubData(this.exec, n2.postfix, t2), c2 = new Be(o2.value, o2.typeInfo);
      return o2 instanceof Be && i2 instanceof Be && (o2.value -= i2.value), r2.value instanceof Pe && r2.value.setDataValue(this.exec, o2, n2.postfix, t2), c2;
    }
    AtomicMax(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.getVariableName(n2, t2), r2 = t2.getVariable(s2);
      let a2 = e2.args[1];
      const i2 = this.exec.evalExpression(a2, t2), o2 = r2.value.getSubData(this.exec, n2.postfix, t2), c2 = new Be(o2.value, o2.typeInfo);
      return o2 instanceof Be && i2 instanceof Be && (o2.value = Math.max(o2.value, i2.value)), r2.value instanceof Pe && r2.value.setDataValue(this.exec, o2, n2.postfix, t2), c2;
    }
    AtomicMin(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.getVariableName(n2, t2), r2 = t2.getVariable(s2);
      let a2 = e2.args[1];
      const i2 = this.exec.evalExpression(a2, t2), o2 = r2.value.getSubData(this.exec, n2.postfix, t2), c2 = new Be(o2.value, o2.typeInfo);
      return o2 instanceof Be && i2 instanceof Be && (o2.value = Math.min(o2.value, i2.value)), r2.value instanceof Pe && r2.value.setDataValue(this.exec, o2, n2.postfix, t2), c2;
    }
    AtomicAnd(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.getVariableName(n2, t2), r2 = t2.getVariable(s2);
      let a2 = e2.args[1];
      const i2 = this.exec.evalExpression(a2, t2), o2 = r2.value.getSubData(this.exec, n2.postfix, t2), c2 = new Be(o2.value, o2.typeInfo);
      return o2 instanceof Be && i2 instanceof Be && (o2.value = o2.value & i2.value), r2.value instanceof Pe && r2.value.setDataValue(this.exec, o2, n2.postfix, t2), c2;
    }
    AtomicOr(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.getVariableName(n2, t2), r2 = t2.getVariable(s2);
      let a2 = e2.args[1];
      const i2 = this.exec.evalExpression(a2, t2), o2 = r2.value.getSubData(this.exec, n2.postfix, t2), c2 = new Be(o2.value, o2.typeInfo);
      return o2 instanceof Be && i2 instanceof Be && (o2.value = o2.value | i2.value), r2.value instanceof Pe && r2.value.setDataValue(this.exec, o2, n2.postfix, t2), c2;
    }
    AtomicXor(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.getVariableName(n2, t2), r2 = t2.getVariable(s2);
      let a2 = e2.args[1];
      const i2 = this.exec.evalExpression(a2, t2), o2 = r2.value.getSubData(this.exec, n2.postfix, t2), c2 = new Be(o2.value, o2.typeInfo);
      return o2 instanceof Be && i2 instanceof Be && (o2.value = o2.value ^ i2.value), r2.value instanceof Pe && r2.value.setDataValue(this.exec, o2, n2.postfix, t2), c2;
    }
    AtomicExchange(e2, t2) {
      let n2 = e2.args[0];
      n2 instanceof ke && (n2 = n2.right);
      const s2 = this.exec.getVariableName(n2, t2), r2 = t2.getVariable(s2);
      let a2 = e2.args[1];
      const i2 = this.exec.evalExpression(a2, t2), o2 = r2.value.getSubData(this.exec, n2.postfix, t2), c2 = new Be(o2.value, o2.typeInfo);
      return o2 instanceof Be && i2 instanceof Be && (o2.value = i2.value), r2.value instanceof Pe && r2.value.setDataValue(this.exec, o2, n2.postfix, t2), c2;
    }
    AtomicCompareExchangeWeak(e2, t2) {
      return console.error("TODO: atomicCompareExchangeWeak"), null;
    }
    Pack4x8snorm(e2, t2) {
      return console.error("TODO: pack4x8snorm"), null;
    }
    Pack4x8unorm(e2, t2) {
      return console.error("TODO: pack4x8unorm"), null;
    }
    Pack4xI8(e2, t2) {
      return console.error("TODO: pack4xI8"), null;
    }
    Pack4xU8(e2, t2) {
      return console.error("TODO: pack4xU8"), null;
    }
    Pack4x8Clamp(e2, t2) {
      return console.error("TODO: pack4x8Clamp"), null;
    }
    Pack4xU8Clamp(e2, t2) {
      return console.error("TODO: pack4xU8Clamp"), null;
    }
    Pack2x16snorm(e2, t2) {
      return console.error("TODO: pack2x16snorm"), null;
    }
    Pack2x16unorm(e2, t2) {
      return console.error("TODO: pack2x16unorm"), null;
    }
    Pack2x16float(e2, t2) {
      return console.error("TODO: pack2x16float"), null;
    }
    Unpack4x8snorm(e2, t2) {
      return console.error("TODO: unpack4x8snorm"), null;
    }
    Unpack4x8unorm(e2, t2) {
      return console.error("TODO: unpack4x8unorm"), null;
    }
    Unpack4xI8(e2, t2) {
      return console.error("TODO: unpack4xI8"), null;
    }
    Unpack4xU8(e2, t2) {
      return console.error("TODO: unpack4xU8"), null;
    }
    Unpack2x16snorm(e2, t2) {
      return console.error("TODO: unpack2x16snorm"), null;
    }
    Unpack2x16unorm(e2, t2) {
      return console.error("TODO: unpack2x16unorm"), null;
    }
    Unpack2x16float(e2, t2) {
      return console.error("TODO: unpack2x16float"), null;
    }
    StorageBarrier(e2, t2) {
      return null;
    }
    TextureBarrier(e2, t2) {
      return null;
    }
    WorkgroupBarrier(e2, t2) {
      return null;
    }
    WorkgroupUniformLoad(e2, t2) {
      return null;
    }
    SubgroupAdd(e2, t2) {
      return console.error("TODO: subgroupAdd"), null;
    }
    SubgroupExclusiveAdd(e2, t2) {
      return console.error("TODO: subgroupExclusiveAdd"), null;
    }
    SubgroupInclusiveAdd(e2, t2) {
      return console.error("TODO: subgroupInclusiveAdd"), null;
    }
    SubgroupAll(e2, t2) {
      return console.error("TODO: subgroupAll"), null;
    }
    SubgroupAnd(e2, t2) {
      return console.error("TODO: subgroupAnd"), null;
    }
    SubgroupAny(e2, t2) {
      return console.error("TODO: subgroupAny"), null;
    }
    SubgroupBallot(e2, t2) {
      return console.error("TODO: subgroupBallot"), null;
    }
    SubgroupBroadcast(e2, t2) {
      return console.error("TODO: subgroupBroadcast"), null;
    }
    SubgroupBroadcastFirst(e2, t2) {
      return console.error("TODO: subgroupBroadcastFirst"), null;
    }
    SubgroupElect(e2, t2) {
      return console.error("TODO: subgroupElect"), null;
    }
    SubgroupMax(e2, t2) {
      return console.error("TODO: subgroupMax"), null;
    }
    SubgroupMin(e2, t2) {
      return console.error("TODO: subgroupMin"), null;
    }
    SubgroupMul(e2, t2) {
      return console.error("TODO: subgroupMul"), null;
    }
    SubgroupExclusiveMul(e2, t2) {
      return console.error("TODO: subgroupExclusiveMul"), null;
    }
    SubgroupInclusiveMul(e2, t2) {
      return console.error("TODO: subgroupInclusiveMul"), null;
    }
    SubgroupOr(e2, t2) {
      return console.error("TODO: subgroupOr"), null;
    }
    SubgroupShuffle(e2, t2) {
      return console.error("TODO: subgroupShuffle"), null;
    }
    SubgroupShuffleDown(e2, t2) {
      return console.error("TODO: subgroupShuffleDown"), null;
    }
    SubgroupShuffleUp(e2, t2) {
      return console.error("TODO: subgroupShuffleUp"), null;
    }
    SubgroupShuffleXor(e2, t2) {
      return console.error("TODO: subgroupShuffleXor"), null;
    }
    SubgroupXor(e2, t2) {
      return console.error("TODO: subgroupXor"), null;
    }
    QuadBroadcast(e2, t2) {
      return console.error("TODO: quadBroadcast"), null;
    }
    QuadSwapDiagonal(e2, t2) {
      return console.error("TODO: quadSwapDiagonal"), null;
    }
    QuadSwapX(e2, t2) {
      return console.error("TODO: quadSwapX"), null;
    }
    QuadSwapY(e2, t2) {
      return console.error("TODO: quadSwapY"), null;
    }
  };
  var ft = { vec2: 2, vec2f: 2, vec2i: 2, vec2u: 2, vec2b: 2, vec2h: 2, vec3: 3, vec3f: 3, vec3i: 3, vec3u: 3, vec3b: 3, vec3h: 3, vec4: 4, vec4f: 4, vec4i: 4, vec4u: 4, vec4b: 4, vec4h: 4 };
  var pt = { mat2x2: [2, 2, 4], mat2x2f: [2, 2, 4], mat2x2h: [2, 2, 4], mat2x3: [2, 3, 6], mat2x3f: [2, 3, 6], mat2x3h: [2, 3, 6], mat2x4: [2, 4, 8], mat2x4f: [2, 4, 8], mat2x4h: [2, 4, 8], mat3x2: [3, 2, 6], mat3x2f: [3, 2, 6], mat3x2h: [3, 2, 6], mat3x3: [3, 3, 9], mat3x3f: [3, 3, 9], mat3x3h: [3, 3, 9], mat3x4: [3, 4, 12], mat3x4f: [3, 4, 12], mat3x4h: [3, 4, 12], mat4x2: [4, 2, 8], mat4x2f: [4, 2, 8], mat4x2h: [4, 2, 8], mat4x3: [4, 3, 12], mat4x3f: [4, 3, 12], mat4x3h: [4, 3, 12], mat4x4: [4, 4, 16], mat4x4f: [4, 4, 16], mat4x4h: [4, 4, 16] };
  var dt = class _dt extends ut {
    constructor(e2, t2) {
      var n2;
      super(), this.ast = null != e2 ? e2 : [], this.reflection = new at(), this.reflection.updateAST(this.ast), this.context = null !== (n2 = null == t2 ? void 0 : t2.clone()) && void 0 !== n2 ? n2 : new lt(), this.builtins = new ht(this), this.typeInfo = { bool: this.getTypeInfo(ae.bool), i32: this.getTypeInfo(ae.i32), u32: this.getTypeInfo(ae.u32), f32: this.getTypeInfo(ae.f32), f16: this.getTypeInfo(ae.f16), vec2f: this.getTypeInfo(ce.vec2f), vec2u: this.getTypeInfo(ce.vec2u), vec2i: this.getTypeInfo(ce.vec2i), vec2h: this.getTypeInfo(ce.vec2h), vec3f: this.getTypeInfo(ce.vec3f), vec3u: this.getTypeInfo(ce.vec3u), vec3i: this.getTypeInfo(ce.vec3i), vec3h: this.getTypeInfo(ce.vec3h), vec4f: this.getTypeInfo(ce.vec4f), vec4u: this.getTypeInfo(ce.vec4u), vec4i: this.getTypeInfo(ce.vec4i), vec4h: this.getTypeInfo(ce.vec4h), mat2x2f: this.getTypeInfo(ce.mat2x2f), mat2x3f: this.getTypeInfo(ce.mat2x3f), mat2x4f: this.getTypeInfo(ce.mat2x4f), mat3x2f: this.getTypeInfo(ce.mat3x2f), mat3x3f: this.getTypeInfo(ce.mat3x3f), mat3x4f: this.getTypeInfo(ce.mat3x4f), mat4x2f: this.getTypeInfo(ce.mat4x2f), mat4x3f: this.getTypeInfo(ce.mat4x3f), mat4x4f: this.getTypeInfo(ce.mat4x4f) };
    }
    getVariableValue(e2) {
      var t2, n2;
      const r2 = null !== (n2 = null === (t2 = this.context.getVariable(e2)) || void 0 === t2 ? void 0 : t2.value) && void 0 !== n2 ? n2 : null;
      if (null === r2) return null;
      if (r2 instanceof Be) return r2.value;
      if (r2 instanceof Me) return Array.from(r2.data);
      if (r2 instanceof Ue) return Array.from(r2.data);
      if (r2 instanceof Pe && r2.typeInfo instanceof s) {
        if ("u32" === r2.typeInfo.format.name) return Array.from(new Uint32Array(r2.buffer, r2.offset, r2.typeInfo.count));
        if ("i32" === r2.typeInfo.format.name) return Array.from(new Int32Array(r2.buffer, r2.offset, r2.typeInfo.count));
        if ("f32" === r2.typeInfo.format.name) return Array.from(new Float32Array(r2.buffer, r2.offset, r2.typeInfo.count));
      }
      return console.error(`Unsupported return variable type ${r2.typeInfo.name}`), null;
    }
    execute(e2) {
      (e2 = null != e2 ? e2 : {}).constants && this._setOverrides(e2.constants, this.context), this._execStatements(this.ast, this.context);
    }
    dispatchWorkgroups(e2, t2, n2, s2) {
      const r2 = this.context.clone();
      (s2 = null != s2 ? s2 : {}).constants && this._setOverrides(s2.constants, r2), this._execStatements(this.ast, r2);
      const a2 = r2.getFunction(e2);
      if (!a2) return void console.error(`Function ${e2} not found`);
      if ("number" == typeof t2) t2 = [t2, 1, 1];
      else {
        if (0 === t2.length) return void console.error("Invalid dispatch count");
        1 === t2.length ? t2 = [t2[0], 1, 1] : 2 === t2.length ? t2 = [t2[0], t2[1], 1] : t2.length > 3 && (t2 = [t2[0], t2[1], t2[2]]);
      }
      const i2 = t2[0], o2 = t2[1], c2 = t2[2], l2 = this.getTypeInfo("vec3u");
      r2.setVariable("@num_workgroups", new Me(t2, l2));
      const u2 = this.reflection.getFunctionInfo(e2);
      null === u2 && console.error(`Function ${e2} not found in reflection data`);
      for (const e3 in n2) for (const t3 in n2[e3]) {
        const s3 = n2[e3][t3];
        r2.variables.forEach((n3) => {
          var r3;
          const a3 = n3.node;
          if (null == a3 ? void 0 : a3.attributes) {
            let i3 = null, o3 = null;
            for (const e4 of a3.attributes) "binding" === e4.name ? i3 = e4.value : "group" === e4.name && (o3 = e4.value);
            if (t3 == i3 && e3 == o3) {
              let i4 = false;
              for (const s4 of u2.resources) if (s4.name === n3.name && s4.group === parseInt(e3) && s4.binding === parseInt(t3)) {
                i4 = true;
                break;
              }
              if (i4) if (void 0 !== s3.texture && void 0 !== s3.descriptor) {
                const e4 = new We(s3.texture, this.getTypeInfo(a3.type), s3.descriptor, null !== (r3 = s3.texture.view) && void 0 !== r3 ? r3 : null);
                n3.value = e4;
              } else void 0 !== s3.uniform ? n3.value = new Pe(s3.uniform, this.getTypeInfo(a3.type)) : n3.value = new Pe(s3, this.getTypeInfo(a3.type));
            }
          }
        });
      }
      for (let e3 = 0; e3 < c2; ++e3) for (let t3 = 0; t3 < o2; ++t3) for (let n3 = 0; n3 < i2; ++n3) r2.setVariable("@workgroup_id", new Me([n3, t3, e3], this.getTypeInfo("vec3u"))), this._dispatchWorkgroup(a2, [n3, t3, e3], r2);
    }
    execStatement(e2, t2) {
      if (e2 instanceof Y) return this.evalExpression(e2.value, t2);
      if (e2 instanceof se) {
        if (e2.condition) {
          const n2 = this.evalExpression(e2.condition, t2);
          if (!(n2 instanceof Be)) throw new Error("Invalid break-if condition");
          if (!n2.value) return null;
        }
        return _dt._breakObj;
      }
      if (e2 instanceof re) return _dt._continueObj;
      if (e2 instanceof U) this._let(e2, t2);
      else if (e2 instanceof F) this._var(e2, t2);
      else if (e2 instanceof P) this._const(e2, t2);
      else if (e2 instanceof D) this._function(e2, t2);
      else {
        if (e2 instanceof Q) return this._if(e2, t2);
        if (e2 instanceof Z) return this._switch(e2, t2);
        if (e2 instanceof B) return this._for(e2, t2);
        if (e2 instanceof V) return this._while(e2, t2);
        if (e2 instanceof j) return this._loop(e2, t2);
        if (e2 instanceof O) {
          const n2 = t2.clone();
          return n2.currentFunctionName = t2.currentFunctionName, this._execStatements(e2.body, n2);
        }
        if (e2 instanceof G) this._assign(e2, t2);
        else if (e2 instanceof R) this._increment(e2, t2);
        else {
          if (e2 instanceof oe) return null;
          if (e2 instanceof M) {
            const n2 = e2.name;
            null === t2.getVariable(n2) && t2.setVariable(n2, new Be(0, this.getTypeInfo("u32")));
          } else if (e2 instanceof X) this._call(e2, t2);
          else {
            if (e2 instanceof ee) return null;
            if (e2 instanceof te) return null;
            console.error("Invalid statement type.", e2, `Line ${e2.line}`);
          }
        }
      }
      return null;
    }
    evalExpression(e2, t2) {
      return e2 instanceof Ie ? this._evalBinaryOp(e2, t2) : e2 instanceof xe ? this._evalLiteral(e2, t2) : e2 instanceof ge ? this._evalVariable(e2, t2) : e2 instanceof me ? this._evalCall(e2, t2) : e2 instanceof de ? this._evalCreate(e2, t2) : e2 instanceof _e ? this._evalConst(e2, t2) : e2 instanceof ye ? this._evalBitcast(e2, t2) : e2 instanceof ke ? this._evalUnaryOp(e2, t2) : (console.error("Invalid expression type", e2, `Line ${e2.line}`), null);
    }
    getTypeInfo(e2) {
      var t2;
      if (e2 instanceof ae) {
        const t3 = this.reflection.getTypeInfo(e2);
        if (null !== t3) return t3;
      }
      let n2 = null !== (t2 = this.typeInfo[e2]) && void 0 !== t2 ? t2 : null;
      return null !== n2 || (n2 = this.reflection.getTypeInfoByName(e2)), n2;
    }
    _setOverrides(e2, t2) {
      for (const n2 in e2) {
        const s2 = e2[n2], r2 = this.reflection.getOverrideInfo(n2);
        null !== r2 ? (null === r2.type && (r2.type = this.getTypeInfo("u32")), "u32" === r2.type.name || "i32" === r2.type.name || "f32" === r2.type.name || "f16" === r2.type.name ? t2.setVariable(n2, new Be(s2, r2.type)) : "bool" === r2.type.name ? t2.setVariable(n2, new Be(s2 ? 1 : 0, r2.type)) : "vec2" === r2.type.name || "vec3" === r2.type.name || "vec4" === r2.type.name || "vec2f" === r2.type.name || "vec3f" === r2.type.name || "vec4f" === r2.type.name || "vec2i" === r2.type.name || "vec3i" === r2.type.name || "vec4i" === r2.type.name || "vec2u" === r2.type.name || "vec3u" === r2.type.name || "vec4u" === r2.type.name || "vec2h" === r2.type.name || "vec3h" === r2.type.name || "vec4h" === r2.type.name ? t2.setVariable(n2, new Me(s2, r2.type)) : console.error(`Invalid constant type for ${n2}`)) : console.error(`Override ${n2} does not exist in the shader.`);
      }
    }
    _dispatchWorkgroup(e2, t2, n2) {
      const s2 = [1, 1, 1];
      for (const t3 of e2.node.attributes) if ("workgroup_size" === t3.name) {
        if (t3.value.length > 0) {
          const e3 = n2.getVariableValue(t3.value[0]);
          s2[0] = e3 instanceof Be ? e3.value : parseInt(t3.value[0]);
        }
        if (t3.value.length > 1) {
          const e3 = n2.getVariableValue(t3.value[1]);
          s2[1] = e3 instanceof Be ? e3.value : parseInt(t3.value[1]);
        }
        if (t3.value.length > 2) {
          const e3 = n2.getVariableValue(t3.value[2]);
          s2[2] = e3 instanceof Be ? e3.value : parseInt(t3.value[2]);
        }
      }
      const r2 = this.getTypeInfo("vec3u"), a2 = this.getTypeInfo("u32");
      n2.setVariable("@workgroup_size", new Me(s2, r2));
      const i2 = s2[0], o2 = s2[1], c2 = s2[2];
      for (let l2 = 0, u2 = 0; l2 < c2; ++l2) for (let c3 = 0; c3 < o2; ++c3) for (let o3 = 0; o3 < i2; ++o3, ++u2) {
        const i3 = [o3, c3, l2], h2 = [o3 + t2[0] * s2[0], c3 + t2[1] * s2[1], l2 + t2[2] * s2[2]];
        n2.setVariable("@local_invocation_id", new Me(i3, r2)), n2.setVariable("@global_invocation_id", new Me(h2, r2)), n2.setVariable("@local_invocation_index", new Be(u2, a2)), this._dispatchExec(e2, n2);
      }
    }
    _dispatchExec(e2, t2) {
      for (const n2 of e2.node.args) for (const e3 of n2.attributes) if ("builtin" === e3.name) {
        const s2 = `@${e3.value}`, r2 = t2.getVariable(s2);
        void 0 !== r2 && t2.variables.set(n2.name, r2);
      }
      this._execStatements(e2.node.body, t2);
    }
    getVariableName(e2, t2) {
      for (; e2 instanceof ke; ) e2 = e2.right;
      return e2 instanceof ge ? e2.name : (console.error("Unknown variable type", e2, "Line", e2.line), null);
    }
    _execStatements(e2, t2) {
      for (const n2 of e2) {
        if (n2 instanceof Array) {
          const e4 = t2.clone(), s2 = this._execStatements(n2, e4);
          if (s2) return s2;
          continue;
        }
        const e3 = this.execStatement(n2, t2);
        if (e3) return e3;
      }
      return null;
    }
    _call(e2, t2) {
      const n2 = t2.clone();
      n2.currentFunctionName = e2.name;
      const s2 = t2.getFunction(e2.name);
      if (s2) {
        for (let t3 = 0; t3 < s2.node.args.length; ++t3) {
          const r2 = s2.node.args[t3], a2 = this.evalExpression(e2.args[t3], n2);
          n2.setVariable(r2.name, a2, r2);
        }
        this._execStatements(s2.node.body, n2);
      } else if (e2.isBuiltin) this._callBuiltinFunction(e2, n2);
      else {
        this.getTypeInfo(e2.name) && this._evalCreate(e2, t2);
      }
    }
    _increment(e2, t2) {
      const n2 = this.getVariableName(e2.variable, t2), s2 = t2.getVariable(n2);
      s2 ? "++" === e2.operator ? s2.value instanceof Be ? s2.value.value++ : console.error(`Variable ${n2} is not a scalar. Line ${e2.line}`) : "--" === e2.operator ? s2.value instanceof Be ? s2.value.value-- : console.error(`Variable ${n2} is not a scalar. Line ${e2.line}`) : console.error(`Unknown increment operator ${e2.operator}. Line ${e2.line}`) : console.error(`Variable ${n2} not found. Line ${e2.line}`);
    }
    _getVariableData(e2, t2) {
      if (e2 instanceof ge) {
        const n2 = this.getVariableName(e2, t2), s2 = t2.getVariable(n2);
        return null === s2 ? (console.error(`Variable ${n2} not found. Line ${e2.line}`), null) : s2.value.getSubData(this, e2.postfix, t2);
      }
      if (e2 instanceof ke) {
        if ("*" === e2.operator) {
          const n2 = this._getVariableData(e2.right, t2);
          return n2 instanceof Oe ? n2.reference.getSubData(this, e2.postfix, t2) : (console.error(`Variable ${e2.right} is not a pointer. Line ${e2.line}`), null);
        }
        if ("&" === e2.operator) {
          const n2 = this._getVariableData(e2.right, t2);
          return new Oe(n2);
        }
      }
      return null;
    }
    _assign(e2, t2) {
      let n2 = null, s2 = "<var>", r2 = null;
      if (e2.variable instanceof ke) {
        const n3 = this._getVariableData(e2.variable, t2), s3 = this.evalExpression(e2.value, t2), r3 = e2.operator;
        if ("=" === r3) {
          if (n3 instanceof Be || n3 instanceof Me || n3 instanceof Ue) {
            if (s3 instanceof Be || s3 instanceof Me || s3 instanceof Ue && n3.data.length === s3.data.length) return void n3.data.set(s3.data);
            console.error(`Invalid assignment. Line ${e2.line}`);
          } else if (n3 instanceof Pe && s3 instanceof Pe && n3.buffer.byteLength - n3.offset >= s3.buffer.byteLength - s3.offset) return void (n3.buffer.byteLength % 4 == 0 ? new Uint32Array(n3.buffer, n3.offset, n3.typeInfo.size / 4).set(new Uint32Array(s3.buffer, s3.offset, s3.typeInfo.size / 4)) : new Uint8Array(n3.buffer, n3.offset, n3.typeInfo.size).set(new Uint8Array(s3.buffer, s3.offset, s3.typeInfo.size)));
          return console.error(`Invalid assignment. Line ${e2.line}`), null;
        }
        if ("+=" === r3) return n3 instanceof Be || n3 instanceof Me || n3 instanceof Ue ? s3 instanceof Be || s3 instanceof Me || s3 instanceof Ue ? void n3.data.set(s3.data.map((e3, t3) => n3.data[t3] + e3)) : void console.error(`Invalid assignment . Line ${e2.line}`) : void console.error(`Invalid assignment. Line ${e2.line}`);
        if ("-=" === r3) return (n3 instanceof Be || n3 instanceof Me || n3 instanceof Ue) && (s3 instanceof Be || s3 instanceof Me || s3 instanceof Ue) ? void n3.data.set(s3.data.map((e3, t3) => n3.data[t3] - e3)) : void console.error(`Invalid assignment. Line ${e2.line}`);
      }
      if (e2.variable instanceof ke) {
        if ("*" === e2.variable.operator) {
          s2 = this.getVariableName(e2.variable.right, t2);
          const r3 = t2.getVariable(s2);
          if (!(r3 && r3.value instanceof Oe)) return void console.error(`Variable ${s2} is not a pointer. Line ${e2.line}`);
          n2 = r3.value.reference;
          let a3 = e2.variable.postfix;
          if (!a3) {
            let t3 = e2.variable.right;
            for (; t3 instanceof ke; ) {
              if (t3.postfix) {
                a3 = t3.postfix;
                break;
              }
              t3 = t3.right;
            }
          }
          a3 && (n2 = n2.getSubData(this, a3, t2));
        }
      } else {
        r2 = e2.variable.postfix, s2 = this.getVariableName(e2.variable, t2);
        const a3 = t2.getVariable(s2);
        if (null === a3) return void console.error(`Variable ${s2} not found. Line ${e2.line}`);
        n2 = a3.value;
      }
      if (n2 instanceof Oe && (n2 = n2.reference), null === n2) return void console.error(`Variable ${s2} not found. Line ${e2.line}`);
      const a2 = this.evalExpression(e2.value, t2), i2 = e2.operator;
      if ("=" !== i2) {
        const s3 = n2.getSubData(this, r2, t2);
        if (s3 instanceof Me && a2 instanceof Be) {
          const t3 = s3.data, n3 = a2.value;
          if ("+=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] += n3;
          else if ("-=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] -= n3;
          else if ("*=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] *= n3;
          else if ("/=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] /= n3;
          else if ("%=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] %= n3;
          else if ("&=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] &= n3;
          else if ("|=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] |= n3;
          else if ("^=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] ^= n3;
          else if ("<<=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] <<= n3;
          else if (">>=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] >>= n3;
          else console.error(`Invalid operator ${i2}. Line ${e2.line}`);
        } else if (s3 instanceof Me && a2 instanceof Me) {
          const t3 = s3.data, n3 = a2.data;
          if (t3.length !== n3.length) return void console.error(`Vector length mismatch. Line ${e2.line}`);
          if ("+=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] += n3[e3];
          else if ("-=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] -= n3[e3];
          else if ("*=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] *= n3[e3];
          else if ("/=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] /= n3[e3];
          else if ("%=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] %= n3[e3];
          else if ("&=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] &= n3[e3];
          else if ("|=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] |= n3[e3];
          else if ("^=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] ^= n3[e3];
          else if ("<<=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] <<= n3[e3];
          else if (">>=" === i2) for (let e3 = 0; e3 < t3.length; ++e3) t3[e3] >>= n3[e3];
          else console.error(`Invalid operator ${i2}. Line ${e2.line}`);
        } else {
          if (!(s3 instanceof Be && a2 instanceof Be)) return void console.error(`Invalid type for ${e2.operator} operator. Line ${e2.line}`);
          "+=" === i2 ? s3.value += a2.value : "-=" === i2 ? s3.value -= a2.value : "*=" === i2 ? s3.value *= a2.value : "/=" === i2 ? s3.value /= a2.value : "%=" === i2 ? s3.value %= a2.value : "&=" === i2 ? s3.value &= a2.value : "|=" === i2 ? s3.value |= a2.value : "^=" === i2 ? s3.value ^= a2.value : "<<=" === i2 ? s3.value <<= a2.value : ">>=" === i2 ? s3.value >>= a2.value : console.error(`Invalid operator ${i2}. Line ${e2.line}`);
        }
        return void (n2 instanceof Pe && n2.setDataValue(this, s3, r2, t2));
      }
      if (n2 instanceof Pe) n2.setDataValue(this, a2, r2, t2);
      else if (r2) {
        if (!(n2 instanceof Me || n2 instanceof Ue)) return void console.error(`Variable ${s2} is not a vector or matrix. Line ${e2.line}`);
        if (r2 instanceof ve) {
          const i3 = this.evalExpression(r2.index, t2).value;
          if (n2 instanceof Me) {
            if (!(a2 instanceof Be)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
            n2.data[i3] = a2.value;
          } else {
            if (!(n2 instanceof Ue)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
            {
              const i4 = this.evalExpression(r2.index, t2).value;
              if (i4 < 0) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
              if (!(a2 instanceof Me)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
              {
                const t3 = n2.typeInfo.getTypeName();
                if ("mat2x2" === t3 || "mat2x2f" === t3 || "mat2x2h" === t3) {
                  if (!(i4 < 2 && 2 === a2.data.length)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
                  n2.data[2 * i4] = a2.data[0], n2.data[2 * i4 + 1] = a2.data[1];
                } else if ("mat2x3" === t3 || "mat2x3f" === t3 || "mat2x3h" === t3) {
                  if (!(i4 < 2 && 3 === a2.data.length)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
                  n2.data[3 * i4] = a2.data[0], n2.data[3 * i4 + 1] = a2.data[1], n2.data[3 * i4 + 2] = a2.data[2];
                } else if ("mat2x4" === t3 || "mat2x4f" === t3 || "mat2x4h" === t3) {
                  if (!(i4 < 2 && 4 === a2.data.length)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
                  n2.data[4 * i4] = a2.data[0], n2.data[4 * i4 + 1] = a2.data[1], n2.data[4 * i4 + 2] = a2.data[2], n2.data[4 * i4 + 3] = a2.data[3];
                } else if ("mat3x2" === t3 || "mat3x2f" === t3 || "mat3x2h" === t3) {
                  if (!(i4 < 3 && 2 === a2.data.length)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
                  n2.data[2 * i4] = a2.data[0], n2.data[2 * i4 + 1] = a2.data[1];
                } else if ("mat3x3" === t3 || "mat3x3f" === t3 || "mat3x3h" === t3) {
                  if (!(i4 < 3 && 3 === a2.data.length)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
                  n2.data[3 * i4] = a2.data[0], n2.data[3 * i4 + 1] = a2.data[1], n2.data[3 * i4 + 2] = a2.data[2];
                } else if ("mat3x4" === t3 || "mat3x4f" === t3 || "mat3x4h" === t3) {
                  if (!(i4 < 3 && 4 === a2.data.length)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
                  n2.data[4 * i4] = a2.data[0], n2.data[4 * i4 + 1] = a2.data[1], n2.data[4 * i4 + 2] = a2.data[2], n2.data[4 * i4 + 3] = a2.data[3];
                } else if ("mat4x2" === t3 || "mat4x2f" === t3 || "mat4x2h" === t3) {
                  if (!(i4 < 4 && 2 === a2.data.length)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
                  n2.data[2 * i4] = a2.data[0], n2.data[2 * i4 + 1] = a2.data[1];
                } else if ("mat4x3" === t3 || "mat4x3f" === t3 || "mat4x3h" === t3) {
                  if (!(i4 < 4 && 3 === a2.data.length)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
                  n2.data[3 * i4] = a2.data[0], n2.data[3 * i4 + 1] = a2.data[1], n2.data[3 * i4 + 2] = a2.data[2];
                } else {
                  if ("mat4x4" !== t3 && "mat4x4f" !== t3 && "mat4x4h" !== t3) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
                  if (!(i4 < 4 && 4 === a2.data.length)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
                  n2.data[4 * i4] = a2.data[0], n2.data[4 * i4 + 1] = a2.data[1], n2.data[4 * i4 + 2] = a2.data[2], n2.data[4 * i4 + 3] = a2.data[3];
                }
              }
            }
          }
        } else if (r2 instanceof pe) {
          const t3 = r2.value;
          if (!(n2 instanceof Me)) return void console.error(`Invalid assignment to ${t3}. Variable ${s2} is not a vector. Line ${e2.line}`);
          if (a2 instanceof Be) {
            if (t3.length > 1) return void console.error(`Invalid assignment to ${t3} for variable ${s2}. Line ${e2.line}`);
            if ("x" === t3) n2.data[0] = a2.value;
            else if ("y" === t3) {
              if (n2.data.length < 2) return void console.error(`Invalid assignment to ${t3} for variable ${s2}. Line ${e2.line}`);
              n2.data[1] = a2.value;
            } else if ("z" === t3) {
              if (n2.data.length < 3) return void console.error(`Invalid assignment to ${t3} for variable ${s2}. Line ${e2.line}`);
              n2.data[2] = a2.value;
            } else if ("w" === t3) {
              if (n2.data.length < 4) return void console.error(`Invalid assignment to ${t3} for variable ${s2}. Line ${e2.line}`);
              n2.data[3] = a2.value;
            }
          } else {
            if (!(a2 instanceof Me)) return void console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
            if (t3.length !== a2.data.length) return void console.error(`Invalid assignment to ${t3} for variable ${s2}. Line ${e2.line}`);
            for (let r3 = 0; r3 < t3.length; ++r3) {
              const i3 = t3[r3];
              if ("x" === i3 || "r" === i3) n2.data[0] = a2.data[r3];
              else if ("y" === i3 || "g" === i3) {
                if (a2.data.length < 2) return void console.error(`Invalid assignment to ${i3} for variable ${s2}. Line ${e2.line}`);
                n2.data[1] = a2.data[r3];
              } else if ("z" === i3 || "b" === i3) {
                if (a2.data.length < 3) return void console.error(`Invalid assignment to ${i3} for variable ${s2}. Line ${e2.line}`);
                n2.data[2] = a2.data[r3];
              } else {
                if ("w" !== i3 && "a" !== i3) return void console.error(`Invalid assignment to ${i3} for variable ${s2}. Line ${e2.line}`);
                if (a2.data.length < 4) return void console.error(`Invalid assignment to ${i3} for variable ${s2}. Line ${e2.line}`);
                n2.data[3] = a2.data[r3];
              }
            }
          }
        }
      } else n2 instanceof Be && a2 instanceof Be ? n2.value = a2.value : n2 instanceof Me && a2 instanceof Me || n2 instanceof Ue && a2 instanceof Ue ? n2.data.set(a2.data) : console.error(`Invalid assignment to ${s2}. Line ${e2.line}`);
    }
    _function(e2, t2) {
      const n2 = new ct(e2);
      t2.functions.set(e2.name, n2);
    }
    _const(e2, t2) {
      let n2 = null;
      null !== e2.value && (n2 = this.evalExpression(e2.value, t2)), t2.createVariable(e2.name, n2, e2);
    }
    _let(e2, t2) {
      let n2 = null;
      if (null !== e2.value) {
        if (n2 = this.evalExpression(e2.value, t2), null === n2) return void console.error(`Invalid value for variable ${e2.name}. Line ${e2.line}`);
        e2.value instanceof ke || (n2 = n2.clone());
      } else {
        const s2 = e2.type.name;
        if ("f32" === s2 || "i32" === s2 || "u32" === s2 || "bool" === s2 || "f16" === s2 || "vec2" === s2 || "vec3" === s2 || "vec4" === s2 || "vec2f" === s2 || "vec3f" === s2 || "vec4f" === s2 || "vec2i" === s2 || "vec3i" === s2 || "vec4i" === s2 || "vec2u" === s2 || "vec3u" === s2 || "vec4u" === s2 || "vec2h" === s2 || "vec3h" === s2 || "vec4h" === s2 || "vec2b" === s2 || "vec3b" === s2 || "vec4b" === s2 || "mat2x2" === s2 || "mat2x3" === s2 || "mat2x4" === s2 || "mat3x2" === s2 || "mat3x3" === s2 || "mat3x4" === s2 || "mat4x2" === s2 || "mat4x3" === s2 || "mat4x4" === s2 || "mat2x2f" === s2 || "mat2x3f" === s2 || "mat2x4f" === s2 || "mat3x2f" === s2 || "mat3x3f" === s2 || "mat3x4f" === s2 || "mat4x2f" === s2 || "mat4x3f" === s2 || "mat4x4f" === s2 || "mat2x2h" === s2 || "mat2x3h" === s2 || "mat2x4h" === s2 || "mat3x2h" === s2 || "mat3x3h" === s2 || "mat3x4h" === s2 || "mat4x2h" === s2 || "mat4x3h" === s2 || "mat4x4h" === s2 || "array" === s2) {
          const s3 = new de(e2.type, []);
          n2 = this._evalCreate(s3, t2);
        }
      }
      t2.createVariable(e2.name, n2, e2);
    }
    _var(e2, t2) {
      let n2 = null;
      if (null !== e2.value) {
        if (n2 = this.evalExpression(e2.value, t2), null === n2) return void console.error(`Invalid value for variable ${e2.name}. Line ${e2.line}`);
        e2.value instanceof ke || (n2 = n2.clone());
      } else {
        if (null === e2.type) return void console.error(`Variable ${e2.name} has no type. Line ${e2.line}`);
        const s2 = e2.type.name;
        if ("f32" === s2 || "i32" === s2 || "u32" === s2 || "bool" === s2 || "f16" === s2 || "vec2" === s2 || "vec3" === s2 || "vec4" === s2 || "vec2f" === s2 || "vec3f" === s2 || "vec4f" === s2 || "vec2i" === s2 || "vec3i" === s2 || "vec4i" === s2 || "vec2u" === s2 || "vec3u" === s2 || "vec4u" === s2 || "vec2h" === s2 || "vec3h" === s2 || "vec4h" === s2 || "vec2b" === s2 || "vec3b" === s2 || "vec4b" === s2 || "mat2x2" === s2 || "mat2x3" === s2 || "mat2x4" === s2 || "mat3x2" === s2 || "mat3x3" === s2 || "mat3x4" === s2 || "mat4x2" === s2 || "mat4x3" === s2 || "mat4x4" === s2 || "mat2x2f" === s2 || "mat2x3f" === s2 || "mat2x4f" === s2 || "mat3x2f" === s2 || "mat3x3f" === s2 || "mat3x4f" === s2 || "mat4x2f" === s2 || "mat4x3f" === s2 || "mat4x4f" === s2 || "mat2x2h" === s2 || "mat2x3h" === s2 || "mat2x4h" === s2 || "mat3x2h" === s2 || "mat3x3h" === s2 || "mat3x4h" === s2 || "mat4x2h" === s2 || "mat4x3h" === s2 || "mat4x4h" === s2 || e2.type instanceof ue || e2.type instanceof oe || e2.type instanceof ce) {
          const s3 = new de(e2.type, []);
          n2 = this._evalCreate(s3, t2);
        }
      }
      t2.createVariable(e2.name, n2, e2);
    }
    _switch(e2, t2) {
      t2 = t2.clone();
      const n2 = this.evalExpression(e2.condition, t2);
      if (!(n2 instanceof Be)) return console.error(`Invalid if condition. Line ${e2.line}`), null;
      let s2 = null;
      for (const r2 of e2.cases) if (r2 instanceof Ae) for (const a2 of r2.selectors) {
        if (a2 instanceof Se) {
          s2 = r2;
          continue;
        }
        const i2 = this.evalExpression(a2, t2);
        if (!(i2 instanceof Be)) return console.error(`Invalid case selector. Line ${e2.line}`), null;
        if (i2.value === n2.value) return this._execStatements(r2.body, t2);
      }
      else r2 instanceof Ee && (s2 = r2);
      return s2 ? this._execStatements(s2.body, t2) : null;
    }
    _if(e2, t2) {
      t2 = t2.clone();
      const n2 = this.evalExpression(e2.condition, t2);
      if (!(n2 instanceof Be)) return console.error(`Invalid if condition. Line ${e2.line}`), null;
      if (n2.value) return this._execStatements(e2.body, t2);
      for (const n3 of e2.elseif) {
        const s2 = this.evalExpression(n3.condition, t2);
        if (!(s2 instanceof Be)) return console.error(`Invalid if condition. Line ${e2.line}`), null;
        if (s2.value) return this._execStatements(n3.body, t2);
      }
      return e2.else ? this._execStatements(e2.else, t2) : null;
    }
    _getScalarValue(e2) {
      return e2 instanceof Be ? e2.value : (console.error("Expected scalar value.", e2), 0);
    }
    _for(e2, t2) {
      for (t2 = t2.clone(), this.execStatement(e2.init, t2); this._getScalarValue(this.evalExpression(e2.condition, t2)); ) {
        const n2 = this._execStatements(e2.body, t2);
        if (n2 === _dt._breakObj) break;
        if (null !== n2 && n2 !== _dt._continueObj) return n2;
        this.execStatement(e2.increment, t2);
      }
      return null;
    }
    _loop(e2, t2) {
      for (t2 = t2.clone(); ; ) {
        const n2 = this._execStatements(e2.body, t2);
        if (n2 === _dt._breakObj) break;
        if (n2 === _dt._continueObj) {
          if (e2.continuing) {
            if (this._execStatements(e2.continuing.body, t2) === _dt._breakObj) break;
          }
        } else if (null !== n2) return n2;
      }
      return null;
    }
    _while(e2, t2) {
      for (t2 = t2.clone(); this._getScalarValue(this.evalExpression(e2.condition, t2)); ) {
        const n2 = this._execStatements(e2.body, t2);
        if (n2 === _dt._breakObj) break;
        if (n2 !== _dt._continueObj && null !== n2) return n2;
      }
      return null;
    }
    _evalBitcast(e2, t2) {
      const n2 = this.evalExpression(e2.value, t2), s2 = e2.type;
      if (n2 instanceof Be) {
        const e3 = nt(n2.value, n2.typeInfo.name, s2.name);
        return new Be(e3, this.getTypeInfo(s2));
      }
      if (n2 instanceof Me) {
        const t3 = n2.typeInfo.getTypeName();
        let r2 = "";
        if (t3.endsWith("f")) r2 = "f32";
        else if (t3.endsWith("i")) r2 = "i32";
        else if (t3.endsWith("u")) r2 = "u32";
        else if (t3.endsWith("b")) r2 = "bool";
        else {
          if (!t3.endsWith("h")) return console.error(`Unknown vector type ${t3}. Line ${e2.line}`), null;
          r2 = "f16";
        }
        const a2 = s2.getTypeName();
        let i2 = "";
        if (a2.endsWith("f")) i2 = "f32";
        else if (a2.endsWith("i")) i2 = "i32";
        else if (a2.endsWith("u")) i2 = "u32";
        else if (a2.endsWith("b")) i2 = "bool";
        else {
          if (!a2.endsWith("h")) return console.error(`Unknown vector type ${i2}. Line ${e2.line}`), null;
          i2 = "f16";
        }
        const o2 = (function(e3, t4, n3) {
          if (t4 === n3) return e3;
          const s3 = new Array(e3.length);
          for (let r3 = 0; r3 < e3.length; r3++) s3[r3] = nt(e3[r3], t4, n3);
          return s3;
        })(Array.from(n2.data), r2, i2);
        return new Me(o2, this.getTypeInfo(s2));
      }
      return console.error(`TODO: bitcast for ${n2.typeInfo.name}. Line ${e2.line}`), null;
    }
    _evalConst(e2, t2) {
      return t2.getVariableValue(e2.name).clone().getSubData(this, e2.postfix, t2);
    }
    _evalCreate(e2, t2) {
      var r2;
      if (e2 instanceof de) {
        if (null === e2.type) return Ve.void;
        switch (e2.type.getTypeName()) {
          case "bool":
          case "i32":
          case "u32":
          case "f32":
          case "f16":
            return this._callConstructorValue(e2, t2);
          case "vec2":
          case "vec3":
          case "vec4":
          case "vec2f":
          case "vec3f":
          case "vec4f":
          case "vec2h":
          case "vec3h":
          case "vec4h":
          case "vec2i":
          case "vec3i":
          case "vec4i":
          case "vec2u":
          case "vec3u":
          case "vec4u":
          case "vec2b":
          case "vec3b":
          case "vec4b":
            return this._callConstructorVec(e2, t2);
          case "mat2x2":
          case "mat2x2f":
          case "mat2x2h":
          case "mat2x3":
          case "mat2x3f":
          case "mat2x3h":
          case "mat2x4":
          case "mat2x4f":
          case "mat2x4h":
          case "mat3x2":
          case "mat3x2f":
          case "mat3x2h":
          case "mat3x3":
          case "mat3x3f":
          case "mat3x3h":
          case "mat3x4":
          case "mat3x4f":
          case "mat3x4h":
          case "mat4x2":
          case "mat4x2f":
          case "mat4x2h":
          case "mat4x3":
          case "mat4x3f":
          case "mat4x3h":
          case "mat4x4":
          case "mat4x4f":
          case "mat4x4h":
            return this._callConstructorMatrix(e2, t2);
        }
      }
      const a2 = e2 instanceof de ? e2.type.name : e2.name, i2 = e2 instanceof de ? this.getTypeInfo(e2.type) : this.getTypeInfo(e2.name);
      if (null === i2) return console.error(`Unknown type ${a2}. Line ${e2.line}`), null;
      if (0 === i2.size) return null;
      const o2 = new Pe(new ArrayBuffer(i2.size), i2, 0);
      if (i2 instanceof n) {
        if (e2.args) for (let n2 = 0; n2 < e2.args.length; ++n2) {
          const s2 = i2.members[n2], r3 = e2.args[n2], a3 = this.evalExpression(r3, t2);
          o2.setData(this, a3, s2.type, s2.offset, t2);
        }
      } else if (i2 instanceof s) {
        let n2 = 0;
        if (e2.args) for (let s2 = 0; s2 < e2.args.length; ++s2) {
          const a3 = e2.args[s2], c2 = this.evalExpression(a3, t2);
          null === i2.format && ("x32" === (null === (r2 = c2.typeInfo) || void 0 === r2 ? void 0 : r2.name) ? i2.format = this.getTypeInfo("i32") : i2.format = c2.typeInfo), o2.setData(this, c2, i2.format, n2, t2), n2 += i2.stride;
        }
      } else console.error(`Unknown type "${a2}". Line ${e2.line}`);
      return e2 instanceof de ? o2.getSubData(this, e2.postfix, t2) : o2;
    }
    _evalLiteral(e2, t2) {
      const n2 = this.getTypeInfo(e2.type), s2 = n2.name;
      if ("x32" === s2 || "u32" === s2 || "f32" === s2 || "f16" === s2 || "i32" === s2 || "bool" === s2) {
        return new Be(e2.scalarValue, n2);
      }
      return "vec2" === s2 || "vec3" === s2 || "vec4" === s2 || "vec2f" === s2 || "vec3f" === s2 || "vec4f" === s2 || "vec2h" === s2 || "vec3h" === s2 || "vec4h" === s2 || "vec2i" === s2 || "vec3i" === s2 || "vec4i" === s2 || "vec2u" === s2 || "vec3u" === s2 || "vec4u" === s2 ? this._callConstructorVec(e2, t2) : "mat2x2" === s2 || "mat2x3" === s2 || "mat2x4" === s2 || "mat3x2" === s2 || "mat3x3" === s2 || "mat3x4" === s2 || "mat4x2" === s2 || "mat4x3" === s2 || "mat4x4" === s2 || "mat2x2f" === s2 || "mat2x3f" === s2 || "mat2x4f" === s2 || "mat3x2f" === s2 || "mat3x3f" === s2 || "mat3x4f" === s2 || "mat4x2f" === s2 || "mat4x3f" === s2 || "mat4x4f" === s2 || "mat2x2h" === s2 || "mat2x3h" === s2 || "mat2x4h" === s2 || "mat3x2h" === s2 || "mat3x3h" === s2 || "mat3x4h" === s2 || "mat4x2h" === s2 || "mat4x3h" === s2 || "mat4x4h" === s2 ? this._callConstructorMatrix(e2, t2) : e2.value;
    }
    _evalVariable(e2, t2) {
      const n2 = t2.getVariableValue(e2.name);
      return null === n2 ? n2 : n2.getSubData(this, e2.postfix, t2);
    }
    _maxFormatTypeInfo(e2) {
      let t2 = e2[0];
      if ("f32" === t2.name) return t2;
      for (let n2 = 1; n2 < e2.length; ++n2) {
        const s2 = _dt._priority.get(t2.name);
        _dt._priority.get(e2[n2].name) < s2 && (t2 = e2[n2]);
      }
      return "x32" === t2.name ? this.getTypeInfo("i32") : t2;
    }
    _evalUnaryOp(e2, t2) {
      const n2 = this.evalExpression(e2.right, t2);
      if ("&" === e2.operator) return new Oe(n2);
      if ("*" === e2.operator) return n2 instanceof Oe ? n2.reference.getSubData(this, e2.postfix, t2) : (console.error(`Invalid dereference. Line ${e2.line}`), null);
      const s2 = n2 instanceof Be ? n2.value : n2 instanceof Me ? Array.from(n2.data) : null;
      switch (e2.operator) {
        case "+": {
          if (Ge(s2)) {
            const e4 = s2.map((e5, t4) => +e5);
            return new Me(e4, n2.typeInfo);
          }
          const e3 = s2, t3 = this._maxFormatTypeInfo([n2.typeInfo, n2.typeInfo]);
          return new Be(+e3, t3);
        }
        case "-": {
          if (Ge(s2)) {
            const e4 = s2.map((e5, t4) => -e5);
            return new Me(e4, n2.typeInfo);
          }
          const e3 = s2, t3 = this._maxFormatTypeInfo([n2.typeInfo, n2.typeInfo]);
          return new Be(-e3, t3);
        }
        case "!": {
          if (Ge(s2)) {
            const e4 = s2.map((e5, t4) => e5 ? 0 : 1);
            return new Me(e4, n2.typeInfo);
          }
          const e3 = s2, t3 = this._maxFormatTypeInfo([n2.typeInfo, n2.typeInfo]);
          return new Be(e3 ? 0 : 1, t3);
        }
        case "~": {
          if (Ge(s2)) {
            const e4 = s2.map((e5, t4) => ~e5);
            return new Me(e4, n2.typeInfo);
          }
          const e3 = s2, t3 = this._maxFormatTypeInfo([n2.typeInfo, n2.typeInfo]);
          return new Be(~e3, t3);
        }
      }
      return console.error(`Invalid unary operator ${e2.operator}. Line ${e2.line}`), null;
    }
    _evalBinaryOp(e2, t2) {
      const n2 = this.evalExpression(e2.left, t2), s2 = this.evalExpression(e2.right, t2), r2 = n2 instanceof Be ? n2.value : n2 instanceof Me || n2 instanceof Ue ? Array.from(n2.data) : null, a2 = s2 instanceof Be ? s2.value : s2 instanceof Me || s2 instanceof Ue ? Array.from(s2.data) : null;
      switch (e2.operator) {
        case "+": {
          if (Ge(r2) && Ge(a2)) {
            const t4 = r2, s3 = a2;
            if (t4.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i3 = t4.map((e3, t5) => e3 + s3[t5]);
            return new Me(i3, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t4 = r2.map((t5, n3) => t5 + e3);
            return new Me(t4, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t4 = a2.map((t5, n3) => e3 + t5);
            return new Me(t4, s2.typeInfo);
          }
          const t3 = r2, i2 = a2, o2 = this._maxFormatTypeInfo([n2.typeInfo, s2.typeInfo]);
          return new Be(t3 + i2, o2);
        }
        case "-": {
          if (Ge(r2) && Ge(a2)) {
            const t4 = r2, s3 = a2;
            if (t4.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i3 = t4.map((e3, t5) => e3 - s3[t5]);
            return new Me(i3, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t4 = r2.map((t5, n3) => t5 - e3);
            return new Me(t4, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t4 = a2.map((t5, n3) => e3 - t5);
            return new Me(t4, s2.typeInfo);
          }
          const t3 = r2, i2 = a2, o2 = this._maxFormatTypeInfo([n2.typeInfo, s2.typeInfo]);
          return new Be(t3 - i2, o2);
        }
        case "*": {
          if (Ge(r2) && Ge(a2)) {
            const t4 = r2, i3 = a2;
            if (n2 instanceof Ue && s2 instanceof Ue) {
              const r3 = (function(e3, t5, n3, s3) {
                if (void 0 === pt[t5.name] || void 0 === pt[s3.name]) return null;
                const r4 = pt[t5.name][0], a4 = pt[t5.name][1], i4 = pt[s3.name][0];
                if (r4 !== pt[s3.name][1]) return null;
                const o4 = new Array(i4 * a4);
                for (let t6 = 0; t6 < a4; t6++) for (let s4 = 0; s4 < i4; s4++) {
                  let c3 = 0;
                  for (let i5 = 0; i5 < r4; i5++) c3 += e3[i5 * a4 + t6] * n3[s4 * r4 + i5];
                  o4[t6 * i4 + s4] = c3;
                }
                return o4;
              })(t4, n2.typeInfo, i3, s2.typeInfo);
              if (null === r3) return console.error(`Matrix multiplication failed. Line ${e2.line}.`), null;
              const a3 = pt[s2.typeInfo.name][0], o3 = pt[n2.typeInfo.name][1], c2 = this.getTypeInfo(`mat${a3}x${o3}f`);
              return new Ue(r3, c2);
            }
            if (n2 instanceof Ue && s2 instanceof Me) {
              const r3 = (function(e3, t5, n3, s3) {
                if (void 0 === pt[t5.name] || void 0 === ft[s3.name]) return null;
                const r4 = pt[t5.name][0], a3 = pt[t5.name][1];
                if (r4 !== n3.length) return null;
                const i4 = new Array(a3);
                for (let t6 = 0; t6 < a3; t6++) {
                  let s4 = 0;
                  for (let i5 = 0; i5 < r4; i5++) s4 += e3[i5 * a3 + t6] * n3[i5];
                  i4[t6] = s4;
                }
                return i4;
              })(t4, n2.typeInfo, i3, s2.typeInfo);
              return null === r3 ? (console.error(`Matrix vector multiplication failed. Line ${e2.line}.`), null) : new Me(r3, s2.typeInfo);
            }
            if (n2 instanceof Me && s2 instanceof Ue) {
              const r3 = (function(e3, t5, n3, s3) {
                if (void 0 === ft[t5.name] || void 0 === pt[s3.name]) return null;
                const r4 = pt[s3.name][0], a3 = pt[s3.name][1];
                if (a3 !== e3.length) return null;
                const i4 = [];
                for (let t6 = 0; t6 < r4; t6++) {
                  let s4 = 0;
                  for (let i5 = 0; i5 < a3; i5++) s4 += e3[i5] * n3[i5 * r4 + t6];
                  i4[t6] = s4;
                }
                return i4;
              })(t4, n2.typeInfo, i3, s2.typeInfo);
              return null === r3 ? (console.error(`Matrix vector multiplication failed. Line ${e2.line}.`), null) : new Me(r3, n2.typeInfo);
            }
            {
              if (t4.length !== i3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
              const s3 = t4.map((e3, t5) => e3 * i3[t5]);
              return new Me(s3, n2.typeInfo);
            }
          }
          if (Ge(r2)) {
            const e3 = a2, t4 = r2.map((t5, n3) => t5 * e3);
            return n2 instanceof Ue ? new Ue(t4, n2.typeInfo) : new Me(t4, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t4 = a2.map((t5, n3) => e3 * t5);
            return s2 instanceof Ue ? new Ue(t4, s2.typeInfo) : new Me(t4, s2.typeInfo);
          }
          const t3 = r2, i2 = a2, o2 = this._maxFormatTypeInfo([n2.typeInfo, s2.typeInfo]);
          return new Be(t3 * i2, o2);
        }
        case "%": {
          if (Ge(r2) && Ge(a2)) {
            const t4 = r2, s3 = a2;
            if (t4.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i3 = t4.map((e3, t5) => e3 % s3[t5]);
            return new Me(i3, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t4 = r2.map((t5, n3) => t5 % e3);
            return new Me(t4, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t4 = a2.map((t5, n3) => e3 % t5);
            return new Me(t4, s2.typeInfo);
          }
          const t3 = r2, i2 = a2, o2 = this._maxFormatTypeInfo([n2.typeInfo, s2.typeInfo]);
          return new Be(t3 % i2, o2);
        }
        case "/": {
          if (Ge(r2) && Ge(a2)) {
            const t4 = r2, s3 = a2;
            if (t4.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i3 = t4.map((e3, t5) => e3 / s3[t5]);
            return new Me(i3, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t4 = r2.map((t5, n3) => t5 / e3);
            return new Me(t4, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t4 = a2.map((t5, n3) => e3 / t5);
            return new Me(t4, s2.typeInfo);
          }
          const t3 = r2, i2 = a2, o2 = this._maxFormatTypeInfo([n2.typeInfo, s2.typeInfo]);
          return new Be(t3 / i2, o2);
        }
        case "&": {
          if (Ge(r2) && Ge(a2)) {
            const t4 = r2, s3 = a2;
            if (t4.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i3 = t4.map((e3, t5) => e3 & s3[t5]);
            return new Me(i3, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t4 = r2.map((t5, n3) => t5 & e3);
            return new Me(t4, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t4 = a2.map((t5, n3) => e3 & t5);
            return new Me(t4, s2.typeInfo);
          }
          const t3 = r2, i2 = a2, o2 = this._maxFormatTypeInfo([n2.typeInfo, s2.typeInfo]);
          return new Be(t3 & i2, o2);
        }
        case "|": {
          if (Ge(r2) && Ge(a2)) {
            const t4 = r2, s3 = a2;
            if (t4.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i3 = t4.map((e3, t5) => e3 | s3[t5]);
            return new Me(i3, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t4 = r2.map((t5, n3) => t5 | e3);
            return new Me(t4, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t4 = a2.map((t5, n3) => e3 | t5);
            return new Me(t4, s2.typeInfo);
          }
          const t3 = r2, i2 = a2, o2 = this._maxFormatTypeInfo([n2.typeInfo, s2.typeInfo]);
          return new Be(t3 | i2, o2);
        }
        case "^": {
          if (Ge(r2) && Ge(a2)) {
            const t4 = r2, s3 = a2;
            if (t4.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i3 = t4.map((e3, t5) => e3 ^ s3[t5]);
            return new Me(i3, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t4 = r2.map((t5, n3) => t5 ^ e3);
            return new Me(t4, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t4 = a2.map((t5, n3) => e3 ^ t5);
            return new Me(t4, s2.typeInfo);
          }
          const t3 = r2, i2 = a2, o2 = this._maxFormatTypeInfo([n2.typeInfo, s2.typeInfo]);
          return new Be(t3 ^ i2, o2);
        }
        case "<<": {
          if (Ge(r2) && Ge(a2)) {
            const t4 = r2, s3 = a2;
            if (t4.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i3 = t4.map((e3, t5) => e3 << s3[t5]);
            return new Me(i3, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t4 = r2.map((t5, n3) => t5 << e3);
            return new Me(t4, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t4 = a2.map((t5, n3) => e3 << t5);
            return new Me(t4, s2.typeInfo);
          }
          const t3 = r2, i2 = a2, o2 = this._maxFormatTypeInfo([n2.typeInfo, s2.typeInfo]);
          return new Be(t3 << i2, o2);
        }
        case ">>": {
          if (Ge(r2) && Ge(a2)) {
            const t4 = r2, s3 = a2;
            if (t4.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i3 = t4.map((e3, t5) => e3 >> s3[t5]);
            return new Me(i3, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t4 = r2.map((t5, n3) => t5 >> e3);
            return new Me(t4, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t4 = a2.map((t5, n3) => e3 >> t5);
            return new Me(t4, s2.typeInfo);
          }
          const t3 = r2, i2 = a2, o2 = this._maxFormatTypeInfo([n2.typeInfo, s2.typeInfo]);
          return new Be(t3 >> i2, o2);
        }
        case ">":
          if (Ge(r2) && Ge(a2)) {
            const t3 = r2, s3 = a2;
            if (t3.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i2 = t3.map((e3, t4) => e3 > s3[t4] ? 1 : 0);
            return new Me(i2, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t3 = r2.map((t4, n3) => t4 > e3 ? 1 : 0);
            return new Me(t3, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t3 = a2.map((t4, n3) => e3 > t4 ? 1 : 0);
            return new Me(t3, s2.typeInfo);
          }
          return new Be(r2 > a2 ? 1 : 0, this.getTypeInfo("bool"));
        case "<":
          if (Ge(r2) && Ge(a2)) {
            const t3 = r2, s3 = a2;
            if (t3.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i2 = t3.map((e3, t4) => e3 < s3[t4] ? 1 : 0);
            return new Me(i2, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t3 = r2.map((t4, n3) => t4 < e3 ? 1 : 0);
            return new Me(t3, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t3 = a2.map((t4, n3) => e3 < t4 ? 1 : 0);
            return new Me(t3, s2.typeInfo);
          }
          return new Be(r2 < a2 ? 1 : 0, this.getTypeInfo("bool"));
        case "==":
          if (Ge(r2) && Ge(a2)) {
            const t3 = r2, s3 = a2;
            if (t3.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i2 = t3.map((e3, t4) => e3 === s3[t4] ? 1 : 0);
            return new Me(i2, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t3 = r2.map((t4, n3) => t4 == e3 ? 1 : 0);
            return new Me(t3, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t3 = a2.map((t4, n3) => e3 == t4 ? 1 : 0);
            return new Me(t3, s2.typeInfo);
          }
          return new Be(r2 === a2 ? 1 : 0, this.getTypeInfo("bool"));
        case "!=":
          if (Ge(r2) && Ge(a2)) {
            const t3 = r2, s3 = a2;
            if (t3.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i2 = t3.map((e3, t4) => e3 !== s3[t4] ? 1 : 0);
            return new Me(i2, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t3 = r2.map((t4, n3) => t4 !== e3 ? 1 : 0);
            return new Me(t3, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t3 = a2.map((t4, n3) => e3 !== t4 ? 1 : 0);
            return new Me(t3, s2.typeInfo);
          }
          return new Be(r2 !== a2 ? 1 : 0, this.getTypeInfo("bool"));
        case ">=":
          if (Ge(r2) && Ge(a2)) {
            const t3 = r2, s3 = a2;
            if (t3.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i2 = t3.map((e3, t4) => e3 >= s3[t4] ? 1 : 0);
            return new Me(i2, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t3 = r2.map((t4, n3) => t4 >= e3 ? 1 : 0);
            return new Me(t3, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t3 = a2.map((t4, n3) => e3 >= t4 ? 1 : 0);
            return new Me(t3, s2.typeInfo);
          }
          return new Be(r2 >= a2 ? 1 : 0, this.getTypeInfo("bool"));
        case "<=":
          if (Ge(r2) && Ge(a2)) {
            const t3 = r2, s3 = a2;
            if (t3.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i2 = t3.map((e3, t4) => e3 <= s3[t4] ? 1 : 0);
            return new Me(i2, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t3 = r2.map((t4, n3) => t4 <= e3 ? 1 : 0);
            return new Me(t3, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t3 = a2.map((t4, n3) => e3 <= t4 ? 1 : 0);
            return new Me(t3, s2.typeInfo);
          }
          return new Be(r2 <= a2 ? 1 : 0, this.getTypeInfo("bool"));
        case "&&":
          if (Ge(r2) && Ge(a2)) {
            const t3 = r2, s3 = a2;
            if (t3.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i2 = t3.map((e3, t4) => e3 && s3[t4] ? 1 : 0);
            return new Me(i2, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t3 = r2.map((t4, n3) => t4 && e3 ? 1 : 0);
            return new Me(t3, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t3 = a2.map((t4, n3) => e3 && t4 ? 1 : 0);
            return new Me(t3, s2.typeInfo);
          }
          return new Be(r2 && a2 ? 1 : 0, this.getTypeInfo("bool"));
        case "||":
          if (Ge(r2) && Ge(a2)) {
            const t3 = r2, s3 = a2;
            if (t3.length !== s3.length) return console.error(`Vector length mismatch. Line ${e2.line}.`), null;
            const i2 = t3.map((e3, t4) => e3 || s3[t4] ? 1 : 0);
            return new Me(i2, n2.typeInfo);
          }
          if (Ge(r2)) {
            const e3 = a2, t3 = r2.map((t4, n3) => t4 || e3 ? 1 : 0);
            return new Me(t3, n2.typeInfo);
          }
          if (Ge(a2)) {
            const e3 = r2, t3 = a2.map((t4, n3) => e3 || t4 ? 1 : 0);
            return new Me(t3, s2.typeInfo);
          }
          return new Be(r2 || a2 ? 1 : 0, this.getTypeInfo("bool"));
      }
      return console.error(`Unknown operator ${e2.operator}. Line ${e2.line}`), null;
    }
    _evalCall(e2, t2) {
      if (null !== e2.cachedReturnValue) return e2.cachedReturnValue;
      const n2 = t2.clone();
      n2.currentFunctionName = e2.name;
      const s2 = t2.getFunction(e2.name);
      if (!s2) {
        if (e2.isBuiltin) return this._callBuiltinFunction(e2, n2);
        return this.getTypeInfo(e2.name) ? this._evalCreate(e2, t2) : (console.error(`Unknown function "${e2.name}". Line ${e2.line}`), null);
      }
      for (let t3 = 0; t3 < s2.node.args.length; ++t3) {
        const r2 = s2.node.args[t3], a2 = this.evalExpression(e2.args[t3], n2);
        n2.createVariable(r2.name, a2, r2);
      }
      return this._execStatements(s2.node.body, n2);
    }
    _callBuiltinFunction(e2, t2) {
      switch (e2.name) {
        case "all":
          return this.builtins.All(e2, t2);
        case "any":
          return this.builtins.Any(e2, t2);
        case "select":
          return this.builtins.Select(e2, t2);
        case "arrayLength":
          return this.builtins.ArrayLength(e2, t2);
        case "abs":
          return this.builtins.Abs(e2, t2);
        case "acos":
          return this.builtins.Acos(e2, t2);
        case "acosh":
          return this.builtins.Acosh(e2, t2);
        case "asin":
          return this.builtins.Asin(e2, t2);
        case "asinh":
          return this.builtins.Asinh(e2, t2);
        case "atan":
          return this.builtins.Atan(e2, t2);
        case "atanh":
          return this.builtins.Atanh(e2, t2);
        case "atan2":
          return this.builtins.Atan2(e2, t2);
        case "ceil":
          return this.builtins.Ceil(e2, t2);
        case "clamp":
          return this.builtins.Clamp(e2, t2);
        case "cos":
          return this.builtins.Cos(e2, t2);
        case "cosh":
          return this.builtins.Cosh(e2, t2);
        case "countLeadingZeros":
          return this.builtins.CountLeadingZeros(e2, t2);
        case "countOneBits":
          return this.builtins.CountOneBits(e2, t2);
        case "countTrailingZeros":
          return this.builtins.CountTrailingZeros(e2, t2);
        case "cross":
          return this.builtins.Cross(e2, t2);
        case "degrees":
          return this.builtins.Degrees(e2, t2);
        case "determinant":
          return this.builtins.Determinant(e2, t2);
        case "distance":
          return this.builtins.Distance(e2, t2);
        case "dot":
          return this.builtins.Dot(e2, t2);
        case "dot4U8Packed":
          return this.builtins.Dot4U8Packed(e2, t2);
        case "dot4I8Packed":
          return this.builtins.Dot4I8Packed(e2, t2);
        case "exp":
          return this.builtins.Exp(e2, t2);
        case "exp2":
          return this.builtins.Exp2(e2, t2);
        case "extractBits":
          return this.builtins.ExtractBits(e2, t2);
        case "faceForward":
          return this.builtins.FaceForward(e2, t2);
        case "firstLeadingBit":
          return this.builtins.FirstLeadingBit(e2, t2);
        case "firstTrailingBit":
          return this.builtins.FirstTrailingBit(e2, t2);
        case "floor":
          return this.builtins.Floor(e2, t2);
        case "fma":
          return this.builtins.Fma(e2, t2);
        case "fract":
          return this.builtins.Fract(e2, t2);
        case "frexp":
          return this.builtins.Frexp(e2, t2);
        case "insertBits":
          return this.builtins.InsertBits(e2, t2);
        case "inverseSqrt":
          return this.builtins.InverseSqrt(e2, t2);
        case "ldexp":
          return this.builtins.Ldexp(e2, t2);
        case "length":
          return this.builtins.Length(e2, t2);
        case "log":
          return this.builtins.Log(e2, t2);
        case "log2":
          return this.builtins.Log2(e2, t2);
        case "max":
          return this.builtins.Max(e2, t2);
        case "min":
          return this.builtins.Min(e2, t2);
        case "mix":
          return this.builtins.Mix(e2, t2);
        case "modf":
          return this.builtins.Modf(e2, t2);
        case "normalize":
          return this.builtins.Normalize(e2, t2);
        case "pow":
          return this.builtins.Pow(e2, t2);
        case "quantizeToF16":
          return this.builtins.QuantizeToF16(e2, t2);
        case "radians":
          return this.builtins.Radians(e2, t2);
        case "reflect":
          return this.builtins.Reflect(e2, t2);
        case "refract":
          return this.builtins.Refract(e2, t2);
        case "reverseBits":
          return this.builtins.ReverseBits(e2, t2);
        case "round":
          return this.builtins.Round(e2, t2);
        case "saturate":
          return this.builtins.Saturate(e2, t2);
        case "sign":
          return this.builtins.Sign(e2, t2);
        case "sin":
          return this.builtins.Sin(e2, t2);
        case "sinh":
          return this.builtins.Sinh(e2, t2);
        case "smoothstep":
          return this.builtins.SmoothStep(e2, t2);
        case "sqrt":
          return this.builtins.Sqrt(e2, t2);
        case "step":
          return this.builtins.Step(e2, t2);
        case "tan":
          return this.builtins.Tan(e2, t2);
        case "tanh":
          return this.builtins.Tanh(e2, t2);
        case "transpose":
          return this.builtins.Transpose(e2, t2);
        case "trunc":
          return this.builtins.Trunc(e2, t2);
        case "dpdx":
          return this.builtins.Dpdx(e2, t2);
        case "dpdxCoarse":
          return this.builtins.DpdxCoarse(e2, t2);
        case "dpdxFine":
          return this.builtins.DpdxFine(e2, t2);
        case "dpdy":
          return this.builtins.Dpdy(e2, t2);
        case "dpdyCoarse":
          return this.builtins.DpdyCoarse(e2, t2);
        case "dpdyFine":
          return this.builtins.DpdyFine(e2, t2);
        case "fwidth":
          return this.builtins.Fwidth(e2, t2);
        case "fwidthCoarse":
          return this.builtins.FwidthCoarse(e2, t2);
        case "fwidthFine":
          return this.builtins.FwidthFine(e2, t2);
        case "textureDimensions":
          return this.builtins.TextureDimensions(e2, t2);
        case "textureGather":
          return this.builtins.TextureGather(e2, t2);
        case "textureGatherCompare":
          return this.builtins.TextureGatherCompare(e2, t2);
        case "textureLoad":
          return this.builtins.TextureLoad(e2, t2);
        case "textureNumLayers":
          return this.builtins.TextureNumLayers(e2, t2);
        case "textureNumLevels":
          return this.builtins.TextureNumLevels(e2, t2);
        case "textureNumSamples":
          return this.builtins.TextureNumSamples(e2, t2);
        case "textureSample":
          return this.builtins.TextureSample(e2, t2);
        case "textureSampleBias":
          return this.builtins.TextureSampleBias(e2, t2);
        case "textureSampleCompare":
          return this.builtins.TextureSampleCompare(e2, t2);
        case "textureSampleCompareLevel":
          return this.builtins.TextureSampleCompareLevel(e2, t2);
        case "textureSampleGrad":
          return this.builtins.TextureSampleGrad(e2, t2);
        case "textureSampleLevel":
          return this.builtins.TextureSampleLevel(e2, t2);
        case "textureSampleBaseClampToEdge":
          return this.builtins.TextureSampleBaseClampToEdge(e2, t2);
        case "textureStore":
          return this.builtins.TextureStore(e2, t2);
        case "atomicLoad":
          return this.builtins.AtomicLoad(e2, t2);
        case "atomicStore":
          return this.builtins.AtomicStore(e2, t2);
        case "atomicAdd":
          return this.builtins.AtomicAdd(e2, t2);
        case "atomicSub":
          return this.builtins.AtomicSub(e2, t2);
        case "atomicMax":
          return this.builtins.AtomicMax(e2, t2);
        case "atomicMin":
          return this.builtins.AtomicMin(e2, t2);
        case "atomicAnd":
          return this.builtins.AtomicAnd(e2, t2);
        case "atomicOr":
          return this.builtins.AtomicOr(e2, t2);
        case "atomicXor":
          return this.builtins.AtomicXor(e2, t2);
        case "atomicExchange":
          return this.builtins.AtomicExchange(e2, t2);
        case "atomicCompareExchangeWeak":
          return this.builtins.AtomicCompareExchangeWeak(e2, t2);
        case "pack4x8snorm":
          return this.builtins.Pack4x8snorm(e2, t2);
        case "pack4x8unorm":
          return this.builtins.Pack4x8unorm(e2, t2);
        case "pack4xI8":
          return this.builtins.Pack4xI8(e2, t2);
        case "pack4xU8":
          return this.builtins.Pack4xU8(e2, t2);
        case "pack4x8Clamp":
          return this.builtins.Pack4x8Clamp(e2, t2);
        case "pack4xU8Clamp":
          return this.builtins.Pack4xU8Clamp(e2, t2);
        case "pack2x16snorm":
          return this.builtins.Pack2x16snorm(e2, t2);
        case "pack2x16unorm":
          return this.builtins.Pack2x16unorm(e2, t2);
        case "pack2x16float":
          return this.builtins.Pack2x16float(e2, t2);
        case "unpack4x8snorm":
          return this.builtins.Unpack4x8snorm(e2, t2);
        case "unpack4x8unorm":
          return this.builtins.Unpack4x8unorm(e2, t2);
        case "unpack4xI8":
          return this.builtins.Unpack4xI8(e2, t2);
        case "unpack4xU8":
          return this.builtins.Unpack4xU8(e2, t2);
        case "unpack2x16snorm":
          return this.builtins.Unpack2x16snorm(e2, t2);
        case "unpack2x16unorm":
          return this.builtins.Unpack2x16unorm(e2, t2);
        case "unpack2x16float":
          return this.builtins.Unpack2x16float(e2, t2);
        case "storageBarrier":
          return this.builtins.StorageBarrier(e2, t2);
        case "textureBarrier":
          return this.builtins.TextureBarrier(e2, t2);
        case "workgroupBarrier":
          return this.builtins.WorkgroupBarrier(e2, t2);
        case "workgroupUniformLoad":
          return this.builtins.WorkgroupUniformLoad(e2, t2);
        case "subgroupAdd":
          return this.builtins.SubgroupAdd(e2, t2);
        case "subgroupExclusiveAdd":
          return this.builtins.SubgroupExclusiveAdd(e2, t2);
        case "subgroupInclusiveAdd":
          return this.builtins.SubgroupInclusiveAdd(e2, t2);
        case "subgroupAll":
          return this.builtins.SubgroupAll(e2, t2);
        case "subgroupAnd":
          return this.builtins.SubgroupAnd(e2, t2);
        case "subgroupAny":
          return this.builtins.SubgroupAny(e2, t2);
        case "subgroupBallot":
          return this.builtins.SubgroupBallot(e2, t2);
        case "subgroupBroadcast":
          return this.builtins.SubgroupBroadcast(e2, t2);
        case "subgroupBroadcastFirst":
          return this.builtins.SubgroupBroadcastFirst(e2, t2);
        case "subgroupElect":
          return this.builtins.SubgroupElect(e2, t2);
        case "subgroupMax":
          return this.builtins.SubgroupMax(e2, t2);
        case "subgroupMin":
          return this.builtins.SubgroupMin(e2, t2);
        case "subgroupMul":
          return this.builtins.SubgroupMul(e2, t2);
        case "subgroupExclusiveMul":
          return this.builtins.SubgroupExclusiveMul(e2, t2);
        case "subgroupInclusiveMul":
          return this.builtins.SubgroupInclusiveMul(e2, t2);
        case "subgroupOr":
          return this.builtins.SubgroupOr(e2, t2);
        case "subgroupShuffle":
          return this.builtins.SubgroupShuffle(e2, t2);
        case "subgroupShuffleDown":
          return this.builtins.SubgroupShuffleDown(e2, t2);
        case "subgroupShuffleUp":
          return this.builtins.SubgroupShuffleUp(e2, t2);
        case "subgroupShuffleXor":
          return this.builtins.SubgroupShuffleXor(e2, t2);
        case "subgroupXor":
          return this.builtins.SubgroupXor(e2, t2);
        case "quadBroadcast":
          return this.builtins.QuadBroadcast(e2, t2);
        case "quadSwapDiagonal":
          return this.builtins.QuadSwapDiagonal(e2, t2);
        case "quadSwapX":
          return this.builtins.QuadSwapX(e2, t2);
        case "quadSwapY":
          return this.builtins.QuadSwapY(e2, t2);
      }
      const n2 = t2.getFunction(e2.name);
      if (n2) {
        const s2 = t2.clone();
        for (let t3 = 0; t3 < n2.node.args.length; ++t3) {
          const r2 = n2.node.args[t3], a2 = this.evalExpression(e2.args[t3], s2);
          s2.setVariable(r2.name, a2, r2);
        }
        return this._execStatements(n2.node.body, s2);
      }
      return null;
    }
    _callConstructorValue(e2, t2) {
      if (!e2.args || 0 === e2.args.length) return new Be(0, this.getTypeInfo(e2.type));
      const n2 = this.evalExpression(e2.args[0], t2);
      return n2.typeInfo = this.getTypeInfo(e2.type), n2.getSubData(this, e2.postfix, t2).clone();
    }
    _callConstructorVec(e2, t2) {
      const n2 = this.getTypeInfo(e2.type), s2 = e2.type.getTypeName(), r2 = ft[s2];
      if (void 0 === r2) return console.error(`Invalid vec constructor ${s2}. Line ${e2.line}`), null;
      const a2 = [];
      if (e2 instanceof xe) if (e2.isVector) {
        const t3 = e2.vectorValue;
        for (const e3 of t3) a2.push(e3);
      } else a2.push(e2.scalarValue);
      else if (e2.args) for (const n3 of e2.args) {
        const e3 = this.evalExpression(n3, t2);
        if (e3 instanceof Me) {
          const t3 = e3.data;
          for (let e4 = 0; e4 < t3.length; ++e4) {
            let n4 = t3[e4];
            a2.push(n4);
          }
        } else if (e3 instanceof Be) {
          let t3 = e3.value;
          a2.push(t3);
        }
      }
      if (e2.type instanceof ce && null === e2.type.format && (e2.type.format = ce.f32), 0 === a2.length) {
        const s3 = new Array(r2).fill(0);
        return new Me(s3, n2).getSubData(this, e2.postfix, t2);
      }
      if (1 === a2.length) for (; a2.length < r2; ) a2.push(a2[0]);
      if (a2.length < r2) return console.error(`Invalid vec constructor. Line ${e2.line}`), null;
      return new Me(a2.length > r2 ? a2.slice(0, r2) : a2, n2).getSubData(this, e2.postfix, t2);
    }
    _callConstructorMatrix(e2, t2) {
      const n2 = this.getTypeInfo(e2.type), s2 = e2.type.getTypeName(), r2 = pt[s2];
      if (void 0 === r2) return console.error(`Invalid matrix constructor ${s2}. Line ${e2.line}`), null;
      const i2 = [];
      if (e2 instanceof xe) if (e2.isVector) {
        const t3 = e2.vectorValue;
        for (const e3 of t3) i2.push(e3);
      } else i2.push(e2.scalarValue);
      else if (e2.args) for (const n3 of e2.args) {
        const e3 = this.evalExpression(n3, t2);
        e3 instanceof Me ? i2.push(...e3.data) : e3 instanceof Be ? i2.push(e3.value) : e3 instanceof Ue && i2.push(...e3.data);
      }
      if (n2 instanceof a && null === n2.format && (n2.format = this.getTypeInfo("f32")), 0 === i2.length) {
        const s3 = new Array(r2[2]).fill(0);
        return new Ue(s3, n2).getSubData(this, e2.postfix, t2);
      }
      return i2.length !== r2[2] ? (console.error(`Invalid matrix constructor. Line ${e2.line}`), null) : new Ue(i2, n2).getSubData(this, e2.postfix, t2);
    }
  };
  dt._breakObj = new Ne(new e("BREAK", null), null), dt._continueObj = new Ne(new e("CONTINUE", null), null), dt._priority = /* @__PURE__ */ new Map([["f32", 0], ["f16", 1], ["u32", 2], ["i32", 3], ["x32", 3]]);
  var mt = class {
    constructor() {
      this.constants = /* @__PURE__ */ new Map(), this.aliases = /* @__PURE__ */ new Map(), this.structs = /* @__PURE__ */ new Map();
    }
  };
  var gt = class {
    constructor() {
      this._tokens = [], this._current = 0, this._currentLine = 1, this._deferArrayCountEval = [], this._currentLoop = [], this._context = new mt(), this._exec = new dt(), this._forwardTypeCount = 0;
    }
    parse(e2) {
      this._initialize(e2), this._deferArrayCountEval.length = 0;
      const t2 = [];
      for (; !this._isAtEnd(); ) {
        const e3 = this._global_decl_or_directive();
        if (!e3) break;
        t2.push(e3);
      }
      if (this._deferArrayCountEval.length > 0) {
        for (const e3 of this._deferArrayCountEval) {
          const t3 = e3.arrayType, n2 = e3.countNode;
          if (n2 instanceof ge) {
            const e4 = n2.name, s2 = this._context.constants.get(e4);
            if (s2) try {
              const e5 = s2.constEvaluate(this._exec);
              t3.count = e5;
            } catch (e5) {
            }
          }
        }
        this._deferArrayCountEval.length = 0;
      }
      if (this._forwardTypeCount > 0) for (const e3 of t2) e3.search((e4) => {
        e4 instanceof Ce || e4 instanceof le ? e4.type = this._forwardType(e4.type) : e4 instanceof ue ? e4.format = this._forwardType(e4.format) : e4 instanceof F || e4 instanceof U || e4 instanceof P ? e4.type = this._forwardType(e4.type) : e4 instanceof D ? e4.returnType = this._forwardType(e4.returnType) : e4 instanceof $e && (e4.type = this._forwardType(e4.type));
      });
      return t2;
    }
    _forwardType(e2) {
      if (e2 instanceof ie) {
        const t2 = this._getType(e2.name);
        if (t2) return t2;
      } else e2 instanceof le ? e2.type = this._forwardType(e2.type) : e2 instanceof ue && (e2.format = this._forwardType(e2.format));
      return e2;
    }
    _initialize(e2) {
      if (e2) if ("string" == typeof e2) {
        const t2 = new Re(e2);
        this._tokens = t2.scanTokens();
      } else this._tokens = e2;
      else this._tokens = [];
      this._current = 0;
    }
    _updateNode(e2, t2) {
      return e2.line = null != t2 ? t2 : this._currentLine, e2;
    }
    _error(e2, t2) {
      return { token: e2, message: t2, toString: () => `${t2}` };
    }
    _isAtEnd() {
      return this._current >= this._tokens.length || this._peek().type == He.eof;
    }
    _match(e2) {
      if (e2 instanceof qe) return !!this._check(e2) && (this._advance(), true);
      for (let t2 = 0, n2 = e2.length; t2 < n2; ++t2) {
        const n3 = e2[t2];
        if (this._check(n3)) return this._advance(), true;
      }
      return false;
    }
    _consume(e2, t2) {
      if (this._check(e2)) return this._advance();
      throw this._error(this._peek(), `${t2}. Line:${this._currentLine}`);
    }
    _check(e2) {
      if (this._isAtEnd()) return false;
      const t2 = this._peek();
      if (e2 instanceof Array) {
        const n2 = t2.type;
        let s2 = false;
        for (const t3 of e2) {
          if (n2 === t3) return true;
          t3 === He.tokens.name && (s2 = true);
        }
        if (s2) {
          const e3 = He.tokens.name.rule.exec(t2.lexeme);
          if (e3 && 0 == e3.index && e3[0] == t2.lexeme) return true;
        }
        return false;
      }
      if (t2.type === e2) return true;
      if (e2 === He.tokens.name) {
        const e3 = He.tokens.name.rule.exec(t2.lexeme);
        return e3 && 0 == e3.index && e3[0] == t2.lexeme;
      }
      return false;
    }
    _advance() {
      var e2, t2;
      return this._currentLine = null !== (t2 = null === (e2 = this._peek()) || void 0 === e2 ? void 0 : e2.line) && void 0 !== t2 ? t2 : -1, this._isAtEnd() || this._current++, this._previous();
    }
    _peek() {
      return this._tokens[this._current];
    }
    _previous() {
      return this._tokens[this._current - 1];
    }
    _global_decl_or_directive() {
      for (; this._match(He.tokens.semicolon) && !this._isAtEnd(); ) ;
      if (this._match(He.keywords.alias)) {
        const e3 = this._type_alias();
        return this._consume(He.tokens.semicolon, "Expected ';'"), this._exec.reflection.updateAST([e3]), e3;
      }
      if (this._match(He.keywords.diagnostic)) {
        const e3 = this._diagnostic();
        return this._consume(He.tokens.semicolon, "Expected ';'"), this._exec.reflection.updateAST([e3]), e3;
      }
      if (this._match(He.keywords.requires)) {
        const e3 = this._requires_directive();
        return this._consume(He.tokens.semicolon, "Expected ';'"), this._exec.reflection.updateAST([e3]), e3;
      }
      if (this._match(He.keywords.enable)) {
        const e3 = this._enable_directive();
        return this._consume(He.tokens.semicolon, "Expected ';'"), this._exec.reflection.updateAST([e3]), e3;
      }
      const e2 = this._attribute();
      if (this._check(He.keywords.var)) {
        const t2 = this._global_variable_decl();
        return null != t2 && (t2.attributes = e2), this._consume(He.tokens.semicolon, "Expected ';'."), this._exec.reflection.updateAST([t2]), t2;
      }
      if (this._check(He.keywords.override)) {
        const t2 = this._override_variable_decl();
        return null != t2 && (t2.attributes = e2), this._consume(He.tokens.semicolon, "Expected ';'."), this._exec.reflection.updateAST([t2]), t2;
      }
      if (this._check(He.keywords.let)) {
        const t2 = this._global_let_decl();
        return null != t2 && (t2.attributes = e2), this._consume(He.tokens.semicolon, "Expected ';'."), this._exec.reflection.updateAST([t2]), t2;
      }
      if (this._check(He.keywords.const)) {
        const t2 = this._global_const_decl();
        return null != t2 && (t2.attributes = e2), this._consume(He.tokens.semicolon, "Expected ';'."), this._exec.reflection.updateAST([t2]), t2;
      }
      if (this._check(He.keywords.struct)) {
        const t2 = this._struct_decl();
        return null != t2 && (t2.attributes = e2), this._exec.reflection.updateAST([t2]), t2;
      }
      if (this._check(He.keywords.fn)) {
        const t2 = this._function_decl();
        return null != t2 && (t2.attributes = e2), this._exec.reflection.updateAST([t2]), t2;
      }
      return null;
    }
    _function_decl() {
      if (!this._match(He.keywords.fn)) return null;
      const e2 = this._currentLine, t2 = this._consume(He.tokens.ident, "Expected function name.").toString();
      this._consume(He.tokens.paren_left, "Expected '(' for function arguments.");
      const n2 = [];
      if (!this._check(He.tokens.paren_right)) do {
        if (this._check(He.tokens.paren_right)) break;
        const e3 = this._attribute(), t3 = this._consume(He.tokens.name, "Expected argument name.").toString();
        this._consume(He.tokens.colon, "Expected ':' for argument type.");
        const s3 = this._attribute(), r3 = this._type_decl();
        null != r3 && (r3.attributes = s3, n2.push(this._updateNode(new $e(t3, r3, e3))));
      } while (this._match(He.tokens.comma));
      this._consume(He.tokens.paren_right, "Expected ')' after function arguments.");
      let s2 = null;
      if (this._match(He.tokens.arrow)) {
        const e3 = this._attribute();
        s2 = this._type_decl(), null != s2 && (s2.attributes = e3);
      }
      const r2 = this._compound_statement(), a2 = this._currentLine;
      return this._updateNode(new D(t2, n2, s2, r2, e2, a2), e2);
    }
    _compound_statement() {
      const e2 = [];
      for (this._consume(He.tokens.brace_left, "Expected '{' for block."); !this._check(He.tokens.brace_right); ) {
        const t2 = this._statement();
        null !== t2 && e2.push(t2);
      }
      return this._consume(He.tokens.brace_right, "Expected '}' for block."), e2;
    }
    _statement() {
      for (; this._match(He.tokens.semicolon) && !this._isAtEnd(); ) ;
      if (this._check(He.tokens.attr) && this._attribute(), this._check(He.keywords.if)) return this._if_statement();
      if (this._check(He.keywords.switch)) return this._switch_statement();
      if (this._check(He.keywords.loop)) return this._loop_statement();
      if (this._check(He.keywords.for)) return this._for_statement();
      if (this._check(He.keywords.while)) return this._while_statement();
      if (this._check(He.keywords.continuing)) return this._continuing_statement();
      if (this._check(He.keywords.static_assert)) return this._static_assert_statement();
      if (this._check(He.tokens.brace_left)) return this._compound_statement();
      let e2 = null;
      if (this._check(He.keywords.return)) e2 = this._return_statement();
      else if (this._check([He.keywords.var, He.keywords.let, He.keywords.const])) e2 = this._variable_statement();
      else if (this._match(He.keywords.discard)) e2 = this._updateNode(new ne());
      else if (this._match(He.keywords.break)) {
        const t2 = this._updateNode(new se());
        if (this._currentLoop.length > 0) {
          const e3 = this._currentLoop[this._currentLoop.length - 1];
          t2.loopId = e3.id;
        }
        e2 = t2, this._check(He.keywords.if) && (this._advance(), t2.condition = this._optional_paren_expression());
      } else if (this._match(He.keywords.continue)) {
        const t2 = this._updateNode(new re());
        if (!(this._currentLoop.length > 0)) throw this._error(this._peek(), `Continue statement must be inside a loop. Line: ${t2.line}`);
        {
          const e3 = this._currentLoop[this._currentLoop.length - 1];
          t2.loopId = e3.id;
        }
        e2 = t2;
      } else e2 = this._increment_decrement_statement() || this._func_call_statement() || this._assignment_statement();
      return null != e2 && this._consume(He.tokens.semicolon, "Expected ';' after statement."), e2;
    }
    _static_assert_statement() {
      if (!this._match(He.keywords.static_assert)) return null;
      const e2 = this._currentLine, t2 = this._optional_paren_expression();
      return this._updateNode(new N(t2), e2);
    }
    _while_statement() {
      if (!this._match(He.keywords.while)) return null;
      const e2 = this._updateNode(new V(null, null));
      return this._currentLoop.push(e2), e2.condition = this._optional_paren_expression(), this._check(He.tokens.attr) && this._attribute(), e2.body = this._compound_statement(), this._currentLoop.pop(), e2;
    }
    _continuing_statement() {
      const e2 = this._currentLoop.length > 0 ? this._currentLoop[this._currentLoop.length - 1].id : -1;
      if (!this._match(He.keywords.continuing)) return null;
      const t2 = this._currentLine, n2 = this._compound_statement();
      return this._updateNode(new O(n2, e2), t2);
    }
    _for_statement() {
      if (!this._match(He.keywords.for)) return null;
      this._consume(He.tokens.paren_left, "Expected '('.");
      const e2 = this._updateNode(new B(null, null, null, null));
      return this._currentLoop.push(e2), e2.init = this._check(He.tokens.semicolon) ? null : this._for_init(), this._consume(He.tokens.semicolon, "Expected ';'."), e2.condition = this._check(He.tokens.semicolon) ? null : this._short_circuit_or_expression(), this._consume(He.tokens.semicolon, "Expected ';'."), e2.increment = this._check(He.tokens.paren_right) ? null : this._for_increment(), this._consume(He.tokens.paren_right, "Expected ')'."), this._check(He.tokens.attr) && this._attribute(), e2.body = this._compound_statement(), this._currentLoop.pop(), e2;
    }
    _for_init() {
      return this._variable_statement() || this._func_call_statement() || this._assignment_statement();
    }
    _for_increment() {
      return this._func_call_statement() || this._increment_decrement_statement() || this._assignment_statement();
    }
    _variable_statement() {
      if (this._check(He.keywords.var)) {
        const e2 = this._variable_decl();
        if (null === e2) throw this._error(this._peek(), "Variable declaration expected.");
        let t2 = null;
        return this._match(He.tokens.equal) && (t2 = this._short_circuit_or_expression()), this._updateNode(new F(e2.name, e2.type, e2.storage, e2.access, t2), e2.line);
      }
      if (this._match(He.keywords.let)) {
        const e2 = this._currentLine, t2 = this._consume(He.tokens.name, "Expected name for let.").toString();
        let n2 = null;
        if (this._match(He.tokens.colon)) {
          const e3 = this._attribute();
          n2 = this._type_decl(), null != n2 && (n2.attributes = e3);
        }
        this._consume(He.tokens.equal, "Expected '=' for let.");
        const s2 = this._short_circuit_or_expression();
        return this._updateNode(new U(t2, n2, null, null, s2), e2);
      }
      if (this._match(He.keywords.const)) {
        const e2 = this._currentLine, t2 = this._consume(He.tokens.name, "Expected name for const.").toString();
        let n2 = null;
        if (this._match(He.tokens.colon)) {
          const e3 = this._attribute();
          n2 = this._type_decl(), null != n2 && (n2.attributes = e3);
        }
        this._consume(He.tokens.equal, "Expected '=' for const.");
        const s2 = this._short_circuit_or_expression();
        return null === n2 && s2 instanceof xe && (n2 = s2.type), this._updateNode(new P(t2, n2, null, null, s2), e2);
      }
      return null;
    }
    _increment_decrement_statement() {
      const e2 = this._current, t2 = this._unary_expression();
      if (null == t2) return null;
      if (!this._check(He.increment_operators)) return this._current = e2, null;
      const n2 = this._consume(He.increment_operators, "Expected increment operator");
      return this._updateNode(new R(n2.type === He.tokens.plus_plus ? W.increment : W.decrement, t2));
    }
    _assignment_statement() {
      let e2 = null;
      const t2 = this._currentLine;
      if (this._check(He.tokens.brace_right)) return null;
      let n2 = this._match(He.tokens.underscore);
      if (n2 || (e2 = this._unary_expression()), !n2 && null == e2) return null;
      const s2 = this._consume(He.assignment_operators, "Expected assignment operator."), r2 = this._short_circuit_or_expression();
      return this._updateNode(new G(q.parse(s2.lexeme), e2, r2), t2);
    }
    _func_call_statement() {
      if (!this._check(He.tokens.ident)) return null;
      const e2 = this._currentLine, t2 = this._current, n2 = this._consume(He.tokens.ident, "Expected function name."), s2 = this._argument_expression_list();
      return null === s2 ? (this._current = t2, null) : this._updateNode(new X(n2.lexeme, s2), e2);
    }
    _loop_statement() {
      if (!this._match(He.keywords.loop)) return null;
      this._check(He.tokens.attr) && this._attribute(), this._consume(He.tokens.brace_left, "Expected '{' for loop.");
      const e2 = this._updateNode(new j([], null));
      this._currentLoop.push(e2);
      let t2 = this._statement();
      for (; null !== t2; ) {
        if (Array.isArray(t2)) for (let n2 of t2) e2.body.push(n2);
        else e2.body.push(t2);
        if (t2 instanceof O) {
          e2.continuing = t2;
          break;
        }
        t2 = this._statement();
      }
      return this._currentLoop.pop(), this._consume(He.tokens.brace_right, "Expected '}' for loop."), e2;
    }
    _switch_statement() {
      if (!this._match(He.keywords.switch)) return null;
      const e2 = this._updateNode(new Z(null, []));
      if (this._currentLoop.push(e2), e2.condition = this._optional_paren_expression(), this._check(He.tokens.attr) && this._attribute(), this._consume(He.tokens.brace_left, "Expected '{' for switch."), e2.cases = this._switch_body(), null == e2.cases || 0 == e2.cases.length) throw this._error(this._previous(), "Expected 'case' or 'default'.");
      return this._consume(He.tokens.brace_right, "Expected '}' for switch."), this._currentLoop.pop(), e2;
    }
    _switch_body() {
      const e2 = [];
      let t2 = false;
      for (; this._check([He.keywords.default, He.keywords.case]); ) {
        if (this._match(He.keywords.case)) {
          const n2 = this._case_selectors();
          for (const e3 of n2) if (e3 instanceof Se) {
            if (t2) throw this._error(this._previous(), "Multiple default cases in switch statement.");
            t2 = true;
            break;
          }
          this._match(He.tokens.colon), this._check(He.tokens.attr) && this._attribute(), this._consume(He.tokens.brace_left, "Exected '{' for switch case.");
          const s2 = this._case_body();
          this._consume(He.tokens.brace_right, "Exected '}' for switch case."), e2.push(this._updateNode(new Ae(n2, s2)));
        }
        if (this._match(He.keywords.default)) {
          if (t2) throw this._error(this._previous(), "Multiple default cases in switch statement.");
          this._match(He.tokens.colon), this._check(He.tokens.attr) && this._attribute(), this._consume(He.tokens.brace_left, "Exected '{' for switch default.");
          const n2 = this._case_body();
          this._consume(He.tokens.brace_right, "Exected '}' for switch default."), e2.push(this._updateNode(new Ee(n2)));
        }
      }
      return e2;
    }
    _case_selectors() {
      const e2 = [];
      for (this._match(He.keywords.default) ? e2.push(this._updateNode(new Se())) : e2.push(this._shift_expression()); this._match(He.tokens.comma); ) this._match(He.keywords.default) ? e2.push(this._updateNode(new Se())) : e2.push(this._shift_expression());
      return e2;
    }
    _case_body() {
      if (this._match(He.keywords.fallthrough)) return this._consume(He.tokens.semicolon, "Expected ';'"), [];
      let e2 = this._statement();
      if (null == e2) return [];
      e2 instanceof Array || (e2 = [e2]);
      const t2 = this._case_body();
      return 0 == t2.length ? e2 : [...e2, t2[0]];
    }
    _if_statement() {
      if (!this._match(He.keywords.if)) return null;
      const e2 = this._currentLine, t2 = this._optional_paren_expression();
      this._check(He.tokens.attr) && this._attribute();
      const n2 = this._compound_statement();
      let s2 = [];
      this._match_elseif() && (this._check(He.tokens.attr) && this._attribute(), s2 = this._elseif_statement(s2));
      let r2 = null;
      return this._match(He.keywords.else) && (this._check(He.tokens.attr) && this._attribute(), r2 = this._compound_statement()), this._updateNode(new Q(t2, n2, s2, r2), e2);
    }
    _match_elseif() {
      return this._tokens[this._current].type === He.keywords.else && this._tokens[this._current + 1].type === He.keywords.if && (this._advance(), this._advance(), true);
    }
    _elseif_statement(e2 = []) {
      const t2 = this._optional_paren_expression(), n2 = this._compound_statement();
      return e2.push(this._updateNode(new Le(t2, n2))), this._match_elseif() && (this._check(He.tokens.attr) && this._attribute(), this._elseif_statement(e2)), e2;
    }
    _return_statement() {
      if (!this._match(He.keywords.return)) return null;
      const e2 = this._short_circuit_or_expression();
      return this._updateNode(new Y(e2));
    }
    _short_circuit_or_expression() {
      let e2 = this._short_circuit_and_expr();
      for (; this._match(He.tokens.or_or); ) e2 = this._updateNode(new Ie(this._previous().toString(), e2, this._short_circuit_and_expr()));
      return e2;
    }
    _short_circuit_and_expr() {
      let e2 = this._inclusive_or_expression();
      for (; this._match(He.tokens.and_and); ) e2 = this._updateNode(new Ie(this._previous().toString(), e2, this._inclusive_or_expression()));
      return e2;
    }
    _inclusive_or_expression() {
      let e2 = this._exclusive_or_expression();
      for (; this._match(He.tokens.or); ) e2 = this._updateNode(new Ie(this._previous().toString(), e2, this._exclusive_or_expression()));
      return e2;
    }
    _exclusive_or_expression() {
      let e2 = this._and_expression();
      for (; this._match(He.tokens.xor); ) e2 = this._updateNode(new Ie(this._previous().toString(), e2, this._and_expression()));
      return e2;
    }
    _and_expression() {
      let e2 = this._equality_expression();
      for (; this._match(He.tokens.and); ) e2 = this._updateNode(new Ie(this._previous().toString(), e2, this._equality_expression()));
      return e2;
    }
    _equality_expression() {
      const e2 = this._relational_expression();
      return this._match([He.tokens.equal_equal, He.tokens.not_equal]) ? this._updateNode(new Ie(this._previous().toString(), e2, this._relational_expression())) : e2;
    }
    _relational_expression() {
      let e2 = this._shift_expression();
      for (; this._match([He.tokens.less_than, He.tokens.greater_than, He.tokens.less_than_equal, He.tokens.greater_than_equal]); ) e2 = this._updateNode(new Ie(this._previous().toString(), e2, this._shift_expression()));
      return e2;
    }
    _shift_expression() {
      let e2 = this._additive_expression();
      for (; this._match([He.tokens.shift_left, He.tokens.shift_right]); ) e2 = this._updateNode(new Ie(this._previous().toString(), e2, this._additive_expression()));
      return e2;
    }
    _additive_expression() {
      let e2 = this._multiplicative_expression();
      for (; this._match([He.tokens.plus, He.tokens.minus]); ) e2 = this._updateNode(new Ie(this._previous().toString(), e2, this._multiplicative_expression()));
      return e2;
    }
    _multiplicative_expression() {
      let e2 = this._unary_expression();
      for (; this._match([He.tokens.star, He.tokens.forward_slash, He.tokens.modulo]); ) e2 = this._updateNode(new Ie(this._previous().toString(), e2, this._unary_expression()));
      return e2;
    }
    _unary_expression() {
      return this._match([He.tokens.minus, He.tokens.bang, He.tokens.tilde, He.tokens.star, He.tokens.and]) ? this._updateNode(new ke(this._previous().toString(), this._unary_expression())) : this._singular_expression();
    }
    _singular_expression() {
      const e2 = this._primary_expression(), t2 = this._postfix_expression();
      return t2 && (e2.postfix = t2), e2;
    }
    _postfix_expression() {
      if (this._match(He.tokens.bracket_left)) {
        const e2 = this._short_circuit_or_expression();
        this._consume(He.tokens.bracket_right, "Expected ']'.");
        const t2 = this._updateNode(new ve(e2)), n2 = this._postfix_expression();
        return n2 && (t2.postfix = n2), t2;
      }
      if (this._match(He.tokens.period)) {
        const e2 = this._consume(He.tokens.name, "Expected member name."), t2 = this._postfix_expression(), n2 = this._updateNode(new pe(e2.lexeme));
        return t2 && (n2.postfix = t2), n2;
      }
      return null;
    }
    _getStruct(e2) {
      if (this._context.aliases.has(e2)) {
        return this._context.aliases.get(e2).type;
      }
      if (this._context.structs.has(e2)) {
        return this._context.structs.get(e2);
      }
      return null;
    }
    _getType(e2) {
      const t2 = this._getStruct(e2);
      if (null !== t2) return t2;
      switch (e2) {
        case "void":
          return ae.void;
        case "bool":
          return ae.bool;
        case "i32":
          return ae.i32;
        case "u32":
          return ae.u32;
        case "f32":
          return ae.f32;
        case "f16":
          return ae.f16;
        case "vec2f":
          return ce.vec2f;
        case "vec3f":
          return ce.vec3f;
        case "vec4f":
          return ce.vec4f;
        case "vec2i":
          return ce.vec2i;
        case "vec3i":
          return ce.vec3i;
        case "vec4i":
          return ce.vec4i;
        case "vec2u":
          return ce.vec2u;
        case "vec3u":
          return ce.vec3u;
        case "vec4u":
          return ce.vec4u;
        case "vec2h":
          return ce.vec2h;
        case "vec3h":
          return ce.vec3h;
        case "vec4h":
          return ce.vec4h;
        case "mat2x2f":
          return ce.mat2x2f;
        case "mat2x3f":
          return ce.mat2x3f;
        case "mat2x4f":
          return ce.mat2x4f;
        case "mat3x2f":
          return ce.mat3x2f;
        case "mat3x3f":
          return ce.mat3x3f;
        case "mat3x4f":
          return ce.mat3x4f;
        case "mat4x2f":
          return ce.mat4x2f;
        case "mat4x3f":
          return ce.mat4x3f;
        case "mat4x4f":
          return ce.mat4x4f;
        case "mat2x2h":
          return ce.mat2x2h;
        case "mat2x3h":
          return ce.mat2x3h;
        case "mat2x4h":
          return ce.mat2x4h;
        case "mat3x2h":
          return ce.mat3x2h;
        case "mat3x3h":
          return ce.mat3x3h;
        case "mat3x4h":
          return ce.mat3x4h;
        case "mat4x2h":
          return ce.mat4x2h;
        case "mat4x3h":
          return ce.mat4x3h;
        case "mat4x4h":
          return ce.mat4x4h;
        case "mat2x2i":
          return ce.mat2x2i;
        case "mat2x3i":
          return ce.mat2x3i;
        case "mat2x4i":
          return ce.mat2x4i;
        case "mat3x2i":
          return ce.mat3x2i;
        case "mat3x3i":
          return ce.mat3x3i;
        case "mat3x4i":
          return ce.mat3x4i;
        case "mat4x2i":
          return ce.mat4x2i;
        case "mat4x3i":
          return ce.mat4x3i;
        case "mat4x4i":
          return ce.mat4x4i;
        case "mat2x2u":
          return ce.mat2x2u;
        case "mat2x3u":
          return ce.mat2x3u;
        case "mat2x4u":
          return ce.mat2x4u;
        case "mat3x2u":
          return ce.mat3x2u;
        case "mat3x3u":
          return ce.mat3x3u;
        case "mat3x4u":
          return ce.mat3x4u;
        case "mat4x2u":
          return ce.mat4x2u;
        case "mat4x3u":
          return ce.mat4x3u;
        case "mat4x4u":
          return ce.mat4x4u;
      }
      return null;
    }
    _validateTypeRange(e2, t2) {
      if ("i32" === t2.name) {
        if (e2 < -2147483648 || e2 > 2147483647) throw this._error(this._previous(), `Value out of range for i32: ${e2}. Line: ${this._currentLine}.`);
      } else if ("u32" === t2.name && (e2 < 0 || e2 > 4294967295)) throw this._error(this._previous(), `Value out of range for u32: ${e2}. Line: ${this._currentLine}.`);
    }
    _primary_expression() {
      if (this._match(He.tokens.ident)) {
        const e3 = this._previous().toString();
        if (this._check(He.tokens.paren_left)) {
          const t3 = this._argument_expression_list(), n2 = this._getType(e3);
          return null !== n2 ? this._updateNode(new de(n2, t3)) : this._updateNode(new me(e3, t3));
        }
        if (this._context.constants.has(e3)) {
          const t3 = this._context.constants.get(e3);
          return this._updateNode(new _e(e3, t3.value));
        }
        return this._updateNode(new ge(e3));
      }
      if (this._match(He.tokens.int_literal)) {
        const e3 = this._previous().toString();
        let t3 = e3.endsWith("i") || e3.endsWith("i") ? ae.i32 : e3.endsWith("u") || e3.endsWith("U") ? ae.u32 : ae.x32;
        const n2 = parseInt(e3);
        return this._validateTypeRange(n2, t3), this._updateNode(new xe(new Be(n2, this._exec.getTypeInfo(t3)), t3));
      }
      if (this._match(He.tokens.uint_literal)) {
        const e3 = parseInt(this._previous().toString());
        return this._validateTypeRange(e3, ae.u32), this._updateNode(new xe(new Be(e3, this._exec.getTypeInfo(ae.u32)), ae.u32));
      }
      if (this._match([He.tokens.decimal_float_literal, He.tokens.hex_float_literal])) {
        let e3 = this._previous().toString(), t3 = e3.endsWith("h");
        t3 && (e3 = e3.substring(0, e3.length - 1));
        const n2 = parseFloat(e3);
        this._validateTypeRange(n2, t3 ? ae.f16 : ae.f32);
        const s2 = t3 ? ae.f16 : ae.f32;
        return this._updateNode(new xe(new Be(n2, this._exec.getTypeInfo(s2)), s2));
      }
      if (this._match([He.keywords.true, He.keywords.false])) {
        let e3 = this._previous().toString() === He.keywords.true.rule;
        return this._updateNode(new xe(new Be(e3 ? 1 : 0, this._exec.getTypeInfo(ae.bool)), ae.bool));
      }
      if (this._check(He.tokens.paren_left)) return this._paren_expression();
      if (this._match(He.keywords.bitcast)) {
        this._consume(He.tokens.less_than, "Expected '<'.");
        const e3 = this._type_decl();
        this._consume(He.tokens.greater_than, "Expected '>'.");
        const t3 = this._paren_expression();
        return this._updateNode(new ye(e3, t3));
      }
      const e2 = this._type_decl(), t2 = this._argument_expression_list();
      return this._updateNode(new de(e2, t2));
    }
    _argument_expression_list() {
      if (!this._match(He.tokens.paren_left)) return null;
      const e2 = [];
      do {
        if (this._check(He.tokens.paren_right)) break;
        const t2 = this._short_circuit_or_expression();
        e2.push(t2);
      } while (this._match(He.tokens.comma));
      return this._consume(He.tokens.paren_right, "Expected ')' for agument list"), e2;
    }
    _optional_paren_expression() {
      this._match(He.tokens.paren_left);
      const e2 = this._short_circuit_or_expression();
      return this._match(He.tokens.paren_right), e2;
    }
    _paren_expression() {
      this._consume(He.tokens.paren_left, "Expected '('.");
      const e2 = this._short_circuit_or_expression();
      return this._consume(He.tokens.paren_right, "Expected ')'."), e2;
    }
    _struct_decl() {
      if (!this._match(He.keywords.struct)) return null;
      const e2 = this._currentLine, t2 = this._consume(He.tokens.ident, "Expected name for struct.").toString();
      this._consume(He.tokens.brace_left, "Expected '{' for struct body.");
      const n2 = [];
      for (; !this._check(He.tokens.brace_right); ) {
        const e3 = this._attribute(), t3 = this._consume(He.tokens.name, "Expected variable name.").toString();
        this._consume(He.tokens.colon, "Expected ':' for struct member type.");
        const s3 = this._attribute(), r3 = this._type_decl();
        null != r3 && (r3.attributes = s3), this._check(He.tokens.brace_right) ? this._match(He.tokens.comma) : this._consume(He.tokens.comma, "Expected ',' for struct member."), n2.push(this._updateNode(new Ce(t3, r3, e3)));
      }
      this._consume(He.tokens.brace_right, "Expected '}' after struct body.");
      const s2 = this._currentLine, r2 = this._updateNode(new oe(t2, n2, e2, s2), e2);
      return this._context.structs.set(t2, r2), r2;
    }
    _global_variable_decl() {
      const e2 = this._variable_decl();
      if (!e2) return null;
      if (this._match(He.tokens.equal)) {
        const t2 = this._const_expression();
        e2.value = t2;
      }
      if (null !== e2.type && e2.value instanceof xe) {
        if ("x32" !== e2.value.type.name) {
          if (e2.type.getTypeName() !== e2.value.type.getTypeName()) throw this._error(this._peek(), `Invalid cast from ${e2.value.type.name} to ${e2.type.name}. Line:${this._currentLine}`);
        }
        e2.value.isScalar && this._validateTypeRange(e2.value.scalarValue, e2.type), e2.value.type = e2.type;
      } else null === e2.type && e2.value instanceof xe && (e2.type = "x32" === e2.value.type.name ? ae.i32 : e2.value.type, e2.value.isScalar && this._validateTypeRange(e2.value.scalarValue, e2.type));
      return e2;
    }
    _override_variable_decl() {
      const e2 = this._override_decl();
      return e2 && this._match(He.tokens.equal) && (e2.value = this._const_expression()), e2;
    }
    _global_const_decl() {
      var e2;
      if (!this._match(He.keywords.const)) return null;
      const t2 = this._consume(He.tokens.name, "Expected variable name"), n2 = this._currentLine;
      let s2 = null;
      if (this._match(He.tokens.colon)) {
        const e3 = this._attribute();
        s2 = this._type_decl(), null != s2 && (s2.attributes = e3);
      }
      let r2 = null;
      this._consume(He.tokens.equal, "const declarations require an assignment");
      const i2 = this._short_circuit_or_expression();
      try {
        let e3 = [ae.f32], n3 = i2.constEvaluate(this._exec, e3);
        n3 instanceof Be && this._validateTypeRange(n3.value, e3[0]), e3[0] instanceof ce && null === e3[0].format && n3.typeInfo instanceof a && null !== n3.typeInfo.format && ("f16" === n3.typeInfo.format.name ? e3[0].format = ae.f16 : "f32" === n3.typeInfo.format.name ? e3[0].format = ae.f32 : "i32" === n3.typeInfo.format.name ? e3[0].format = ae.i32 : "u32" === n3.typeInfo.format.name ? e3[0].format = ae.u32 : "bool" === n3.typeInfo.format.name ? e3[0].format = ae.bool : console.error(`TODO: impelement template format type ${n3.typeInfo.format.name}`)), r2 = this._updateNode(new xe(n3, e3[0])), this._exec.context.setVariable(t2.toString(), n3);
      } catch (e3) {
        r2 = i2;
      }
      if (null !== s2 && r2 instanceof xe) {
        if ("x32" !== r2.type.name) {
          if (s2.getTypeName() !== r2.type.getTypeName()) throw this._error(this._peek(), `Invalid cast from ${r2.type.name} to ${s2.name}. Line:${this._currentLine}`);
        }
        r2.type = s2, r2.isScalar && this._validateTypeRange(r2.scalarValue, r2.type);
      } else null === s2 && r2 instanceof xe && (s2 = null !== (e2 = null == r2 ? void 0 : r2.type) && void 0 !== e2 ? e2 : ae.f32, s2 === ae.x32 && (s2 = ae.i32));
      const o2 = this._updateNode(new P(t2.toString(), s2, "", "", r2), n2);
      return this._context.constants.set(o2.name, o2), o2;
    }
    _global_let_decl() {
      if (!this._match(He.keywords.let)) return null;
      const e2 = this._currentLine, t2 = this._consume(He.tokens.name, "Expected variable name");
      let n2 = null;
      if (this._match(He.tokens.colon)) {
        const e3 = this._attribute();
        n2 = this._type_decl(), null != n2 && (n2.attributes = e3);
      }
      let s2 = null;
      if (this._match(He.tokens.equal) && (s2 = this._const_expression()), null !== n2 && s2 instanceof xe) {
        if ("x32" !== s2.type.name) {
          if (n2.getTypeName() !== s2.type.getTypeName()) throw this._error(this._peek(), `Invalid cast from ${s2.type.name} to ${n2.name}. Line:${this._currentLine}`);
        }
        s2.type = n2;
      } else null === n2 && s2 instanceof xe && (n2 = "x32" === s2.type.name ? ae.i32 : s2.type);
      return s2 instanceof xe && s2.isScalar && this._validateTypeRange(s2.scalarValue, n2), this._updateNode(new U(t2.toString(), n2, "", "", s2), e2);
    }
    _const_expression() {
      return this._short_circuit_or_expression();
    }
    _variable_decl() {
      if (!this._match(He.keywords.var)) return null;
      const e2 = this._currentLine;
      let t2 = "", n2 = "";
      this._match(He.tokens.less_than) && (t2 = this._consume(He.storage_class, "Expected storage_class.").toString(), this._match(He.tokens.comma) && (n2 = this._consume(He.access_mode, "Expected access_mode.").toString()), this._consume(He.tokens.greater_than, "Expected '>'."));
      const s2 = this._consume(He.tokens.name, "Expected variable name");
      let r2 = null;
      if (this._match(He.tokens.colon)) {
        const e3 = this._attribute();
        r2 = this._type_decl(), null != r2 && (r2.attributes = e3);
      }
      return this._updateNode(new F(s2.toString(), r2, t2, n2, null), e2);
    }
    _override_decl() {
      if (!this._match(He.keywords.override)) return null;
      const e2 = this._consume(He.tokens.name, "Expected variable name");
      let t2 = null;
      if (this._match(He.tokens.colon)) {
        const e3 = this._attribute();
        t2 = this._type_decl(), null != t2 && (t2.attributes = e3);
      }
      return this._updateNode(new M(e2.toString(), t2, null));
    }
    _diagnostic() {
      this._consume(He.tokens.paren_left, "Expected '('");
      const e2 = this._consume(He.tokens.ident, "Expected severity control name.");
      this._consume(He.tokens.comma, "Expected ','");
      let t2 = this._consume(He.tokens.ident, "Expected diagnostic rule name.").toString();
      if (this._match(He.tokens.period)) {
        t2 += `.${this._consume(He.tokens.ident, "Expected diagnostic message.").toString()}`;
      }
      return this._consume(He.tokens.paren_right, "Expected ')'"), this._updateNode(new ee(e2.toString(), t2));
    }
    _enable_directive() {
      const e2 = this._consume(He.tokens.ident, "identity expected.");
      return this._updateNode(new K(e2.toString()));
    }
    _requires_directive() {
      const e2 = [this._consume(He.tokens.ident, "identity expected.").toString()];
      for (; this._match(He.tokens.comma); ) {
        const t2 = this._consume(He.tokens.ident, "identity expected.");
        e2.push(t2.toString());
      }
      return this._updateNode(new J(e2));
    }
    _type_alias() {
      const e2 = this._consume(He.tokens.ident, "identity expected.");
      this._consume(He.tokens.equal, "Expected '=' for type alias.");
      let t2 = this._type_decl();
      if (null === t2) throw this._error(this._peek(), "Expected Type for Alias.");
      this._context.aliases.has(t2.name) && (t2 = this._context.aliases.get(t2.name).type);
      const n2 = this._updateNode(new te(e2.toString(), t2));
      return this._context.aliases.set(n2.name, n2), n2;
    }
    _type_decl() {
      if (this._check([He.tokens.ident, ...He.texel_format, He.keywords.bool, He.keywords.f32, He.keywords.i32, He.keywords.u32])) {
        const e3 = this._advance().toString();
        if (this._context.structs.has(e3)) return this._context.structs.get(e3);
        if (this._context.aliases.has(e3)) return this._context.aliases.get(e3).type;
        if (!this._getType(e3)) {
          const t3 = this._updateNode(new ie(e3));
          return this._forwardTypeCount++, t3;
        }
        return this._updateNode(new ae(e3));
      }
      let e2 = this._texture_sampler_types();
      if (e2) return e2;
      if (this._check(He.template_types)) {
        let e3 = this._advance().toString(), t3 = null, n2 = null;
        this._match(He.tokens.less_than) && (t3 = this._type_decl(), n2 = null, this._match(He.tokens.comma) && (n2 = this._consume(He.access_mode, "Expected access_mode for pointer").toString()), this._consume(He.tokens.greater_than, "Expected '>' for type."));
        return this._updateNode(new ce(e3, t3, n2));
      }
      if (this._match(He.keywords.ptr)) {
        let e3 = this._previous().toString();
        this._consume(He.tokens.less_than, "Expected '<' for pointer.");
        const t3 = this._consume(He.storage_class, "Expected storage_class for pointer");
        this._consume(He.tokens.comma, "Expected ',' for pointer.");
        const n2 = this._type_decl();
        let s2 = null;
        this._match(He.tokens.comma) && (s2 = this._consume(He.access_mode, "Expected access_mode for pointer").toString()), this._consume(He.tokens.greater_than, "Expected '>' for pointer.");
        return this._updateNode(new le(e3, t3.toString(), n2, s2));
      }
      const t2 = this._attribute();
      if (this._match(He.keywords.array)) {
        let e3 = null, n2 = -1;
        const s2 = this._previous();
        let r2 = null;
        if (this._match(He.tokens.less_than)) {
          e3 = this._type_decl(), this._context.aliases.has(e3.name) && (e3 = this._context.aliases.get(e3.name).type);
          let t3 = "";
          if (this._match(He.tokens.comma)) {
            r2 = this._shift_expression();
            try {
              t3 = r2.constEvaluate(this._exec).toString(), r2 = null;
            } catch (e4) {
              t3 = "1";
            }
          }
          this._consume(He.tokens.greater_than, "Expected '>' for array."), n2 = t3 ? parseInt(t3) : 0;
        }
        const a2 = this._updateNode(new ue(s2.toString(), t2, e3, n2));
        return r2 && this._deferArrayCountEval.push({ arrayType: a2, countNode: r2 }), a2;
      }
      return null;
    }
    _texture_sampler_types() {
      if (this._match(He.sampler_type)) return this._updateNode(new he(this._previous().toString(), null, null));
      if (this._match(He.depth_texture_type)) return this._updateNode(new he(this._previous().toString(), null, null));
      if (this._match(He.sampled_texture_type) || this._match(He.multisampled_texture_type)) {
        const e2 = this._previous();
        this._consume(He.tokens.less_than, "Expected '<' for sampler type.");
        const t2 = this._type_decl();
        return this._consume(He.tokens.greater_than, "Expected '>' for sampler type."), this._updateNode(new he(e2.toString(), t2, null));
      }
      if (this._match(He.storage_texture_type)) {
        const e2 = this._previous();
        this._consume(He.tokens.less_than, "Expected '<' for sampler type.");
        const t2 = this._consume(He.texel_format, "Invalid texel format.").toString();
        this._consume(He.tokens.comma, "Expected ',' after texel format.");
        const n2 = this._consume(He.access_mode, "Expected access mode for storage texture type.").toString();
        return this._consume(He.tokens.greater_than, "Expected '>' for sampler type."), this._updateNode(new he(e2.toString(), t2, n2));
      }
      return null;
    }
    _attribute() {
      let e2 = [];
      for (; this._match(He.tokens.attr); ) {
        const t2 = this._consume(He.attribute_name, "Expected attribute name"), n2 = this._updateNode(new De(t2.toString(), null));
        if (this._match(He.tokens.paren_left)) {
          if (n2.value = this._consume(He.literal_or_ident, "Expected attribute value").toString(), this._check(He.tokens.comma)) {
            this._advance();
            do {
              const e3 = this._consume(He.literal_or_ident, "Expected attribute value").toString();
              n2.value instanceof Array || (n2.value = [n2.value]), n2.value.push(e3);
            } while (this._match(He.tokens.comma));
          }
          this._consume(He.tokens.paren_right, "Expected ')'");
        }
        e2.push(n2);
      }
      return 0 == e2.length ? null : e2;
    }
  };
  var _t = class extends at {
    constructor(e2) {
      super(), e2 && this.update(e2);
    }
    update(e2) {
      const t2 = new gt().parse(e2);
      this.updateAST(t2);
    }
  };

  // packages/codegen-common/utils.ts
  function toPascalCase(value) {
    return value.replace(/[-_]/g, " ").split(" ").filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  }
  function escapeTemplateLiteral(value) {
    return `\`${value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;
  }

  // packages/power2d-codegen/wgsl/generateMaterialTypesCore_RAW.ts
  var HEADER_COMMENT = "// Auto-generated by power2d raw material generator. DO NOT EDIT.";
  var SHAPE_TRANSLATE_UNIFORM = "power2d_shapeTranslate";
  var SHAPE_ROTATION_UNIFORM = "power2d_shapeRotation";
  var SHAPE_SCALE_UNIFORM = "power2d_shapeScale";
  var TYPE_MAP = {
    f32: { tsType: "number", slotCount: 1, valueLength: 1, componentType: "f32", isVector: false, defaultExpression: "0" },
    i32: { tsType: "number", slotCount: 1, valueLength: 1, componentType: "i32", isVector: false, defaultExpression: "0" },
    u32: { tsType: "number", slotCount: 1, valueLength: 1, componentType: "u32", isVector: false, defaultExpression: "0" },
    bool: { tsType: "boolean", slotCount: 1, valueLength: 1, componentType: "bool", isVector: false, defaultExpression: "false" },
    vec2f: { tsType: "readonly [number, number]", slotCount: 2, valueLength: 2, componentType: "f32", isVector: true, defaultExpression: "[0, 0]" },
    vec3f: { tsType: "readonly [number, number, number]", slotCount: 4, valueLength: 3, componentType: "f32", isVector: true, defaultExpression: "[0, 0, 0]" },
    vec4f: { tsType: "readonly [number, number, number, number]", slotCount: 4, valueLength: 4, componentType: "f32", isVector: true, defaultExpression: "[0, 0, 0, 0]" },
    mat4x4f: { tsType: "Float32Array | readonly number[]", slotCount: 16, valueLength: 16, componentType: "f32", isVector: true, defaultExpression: "new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])" }
  };
  var INSTANCE_TYPE_MAP = {
    f32: { tsType: "number", attributeType: "float32", floatCount: 1 },
    vec2f: { tsType: "readonly [number, number]", attributeType: "float32x2", floatCount: 2 },
    vec3f: { tsType: "readonly [number, number, number]", attributeType: "float32x3", floatCount: 3 },
    vec4f: { tsType: "readonly [number, number, number, number]", attributeType: "float32x4", floatCount: 4 }
  };
  function mappingFor(typeName) {
    return TYPE_MAP[typeName] ?? null;
  }
  function validateType(argument, expected, label) {
    const typeName = argument.type.getTypeName();
    if (typeName !== expected) {
      throw new Error(`${label} must be ${expected}. Received ${argument.name}: ${typeName}`);
    }
  }
  function collectInstanceLayout(struct) {
    const fields = [];
    let offset = 0;
    for (const member of struct.members) {
      if (member.type.isStruct || member.type.isArray) {
        throw new Error(`Instance field ${member.name} uses unsupported type ${member.type.getTypeName()}. Nested structs/arrays are not supported.`);
      }
      const typeName = member.type.getTypeName();
      const meta = INSTANCE_TYPE_MAP[typeName];
      if (!meta) {
        throw new Error(`Instance field ${member.name} uses unsupported type ${typeName}.`);
      }
      fields.push({
        name: member.name,
        wgslType: typeName,
        tsType: meta.tsType,
        attributeType: meta.attributeType,
        floatCount: meta.floatCount,
        offset
      });
      offset += meta.floatCount;
    }
    return { fields, totalFloats: offset };
  }
  function parseTextureParams(args, startIndex, functionName) {
    const params = [];
    const seenTextures = /* @__PURE__ */ new Set();
    for (let index = startIndex; index < args.length; index += 2) {
      const textureArg = args[index];
      const samplerArg = args[index + 1];
      if (!textureArg || !samplerArg) {
        throw new Error(`Texture parameters in ${functionName} must be provided in texture/sampler pairs.`);
      }
      const textureType = textureArg.type.getTypeName();
      if (textureType !== "texture_2d<f32>") {
        throw new Error(`Texture argument must be texture_2d<f32>. Received ${textureArg.name}: ${textureType}`);
      }
      const samplerType = samplerArg.type.getTypeName();
      if (samplerType !== "sampler") {
        throw new Error(`Expected sampler after texture ${textureArg.name}, but got ${samplerArg.name}: ${samplerType}. Texture parameters must be provided in texture/sampler pairs.`);
      }
      if (seenTextures.has(textureArg.name)) {
        throw new Error(`Duplicate texture parameter ${textureArg.name} detected.`);
      }
      seenTextures.add(textureArg.name);
      params.push({
        textureName: textureArg.name,
        samplerName: samplerArg.name
      });
    }
    return params;
  }
  function buildVertexSource(options) {
    const { shaderCode, uniformStructName, instanceStruct, instanceLayout, useInstanceInFragment } = options;
    const lines = [];
    lines.push(HEADER_COMMENT);
    lines.push(`@group(0) @binding(0) var<uniform> uniforms: ${uniformStructName};`);
    lines.push("struct Power2DBuiltins {");
    lines.push(`  ${SHAPE_TRANSLATE_UNIFORM}: vec2f,`);
    lines.push(`  ${SHAPE_ROTATION_UNIFORM}: f32,`);
    lines.push("  _pad0: f32,");
    lines.push(`  ${SHAPE_SCALE_UNIFORM}: vec2f,`);
    lines.push("  power2d_canvasWidth: f32,");
    lines.push("  power2d_canvasHeight: f32,");
    lines.push("};");
    lines.push("@group(0) @binding(1) var<uniform> power2d: Power2DBuiltins;");
    lines.push("");
    lines.push(shaderCode.trimEnd());
    lines.push("");
    lines.push("struct VertexInput {");
    lines.push("  @location(0) position: vec2f,");
    lines.push("  @location(1) uv: vec2f,");
    let locationOffset = 2;
    if (instanceStruct && instanceLayout) {
      for (const field of instanceLayout.fields) {
        lines.push(`  @location(${locationOffset}) inst_${field.name}: ${field.wgslType},`);
        locationOffset += 1;
      }
    }
    lines.push("};");
    lines.push("struct VertexOutput {");
    lines.push("  @builtin(position) position: vec4f,");
    lines.push("  @location(0) vUV: vec2f,");
    let fragmentLocation = 1;
    if (instanceStruct && instanceLayout && useInstanceInFragment) {
      for (const field of instanceLayout.fields) {
        lines.push(`  @location(${fragmentLocation}) vInst_${field.name}: ${field.wgslType},`);
        fragmentLocation += 1;
      }
    }
    lines.push("};");
    lines.push("");
    if (instanceStruct && instanceLayout) {
      lines.push(`fn load_${instanceStruct.name}_vertex(input: VertexInput) -> ${instanceStruct.name} {`);
      if (instanceLayout.fields.length === 0) {
        lines.push(`  return ${instanceStruct.name}();`);
      } else {
        lines.push(`  return ${instanceStruct.name}(`);
        for (const field of instanceLayout.fields) {
          lines.push(`    input.inst_${field.name},`);
        }
        lines.push("  );");
      }
      lines.push("}");
      lines.push("");
    }
    lines.push("fn power2d_applyShapeTransform(pixel: vec2f) -> vec2f {");
    lines.push(`  let scaled = pixel * power2d.${SHAPE_SCALE_UNIFORM};`);
    lines.push(`  let s = sin(power2d.${SHAPE_ROTATION_UNIFORM});`);
    lines.push(`  let c = cos(power2d.${SHAPE_ROTATION_UNIFORM});`);
    lines.push("  let rotated = vec2f(");
    lines.push("    scaled.x * c - scaled.y * s,");
    lines.push("    scaled.x * s + scaled.y * c,");
    lines.push("  );");
    lines.push(`  return rotated + power2d.${SHAPE_TRANSLATE_UNIFORM};`);
    lines.push("}");
    lines.push("");
    lines.push("fn power2d_pixelToNDC(pixel: vec2f) -> vec4f {");
    lines.push("  let ndcX = (pixel.x / power2d.power2d_canvasWidth) * 2.0 - 1.0;");
    lines.push("  let ndcY = -((pixel.y / power2d.power2d_canvasHeight) * 2.0 - 1.0);");
    lines.push("  return vec4f(ndcX, ndcY, 0.0, 1.0);");
    lines.push("}");
    lines.push("");
    lines.push("@vertex");
    lines.push("fn main(input: VertexInput) -> VertexOutput {");
    lines.push("  var out: VertexOutput;");
    if (instanceStruct && instanceLayout) {
      lines.push(`  let instValue = load_${instanceStruct.name}_vertex(input);`);
    }
    lines.push("  let pixelPos = input.position;");
    lines.push("  let uv = input.uv;");
    const vertArgs = ["pixelPos", "uv", "uniforms"];
    if (instanceStruct) {
      vertArgs.push("instValue");
    }
    lines.push(`  let adjustedPixelPos = vertShader(${vertArgs.join(", ")});`);
    lines.push("  let transformedPixelPos = power2d_applyShapeTransform(adjustedPixelPos);");
    lines.push("  out.position = power2d_pixelToNDC(transformedPixelPos);");
    lines.push("  out.vUV = uv;");
    if (instanceStruct && instanceLayout && useInstanceInFragment) {
      for (const field of instanceLayout.fields) {
        lines.push(`  out.vInst_${field.name} = input.inst_${field.name};`);
      }
    }
    lines.push("  return out;");
    lines.push("}");
    lines.push("");
    return `${lines.join("\n")}
`;
  }
  function buildFragmentSource(options) {
    const { shaderCode, uniformStructName, textureParams, instanceStruct, instanceLayout, useInstanceInFragment } = options;
    const lines = [];
    lines.push(HEADER_COMMENT);
    lines.push(`@group(0) @binding(0) var<uniform> uniforms: ${uniformStructName};`);
    lines.push("struct Power2DBuiltins {");
    lines.push(`  ${SHAPE_TRANSLATE_UNIFORM}: vec2f,`);
    lines.push(`  ${SHAPE_ROTATION_UNIFORM}: f32,`);
    lines.push("  _pad0: f32,");
    lines.push(`  ${SHAPE_SCALE_UNIFORM}: vec2f,`);
    lines.push("  power2d_canvasWidth: f32,");
    lines.push("  power2d_canvasHeight: f32,");
    lines.push("};");
    lines.push("@group(0) @binding(1) var<uniform> power2d: Power2DBuiltins;");
    let bindingIndex = 2;
    for (const param of textureParams) {
      lines.push(`@group(0) @binding(${bindingIndex}) var ${param.textureName}: texture_2d<f32>;`);
      bindingIndex += 1;
      lines.push(`@group(0) @binding(${bindingIndex}) var ${param.samplerName}: sampler;`);
      bindingIndex += 1;
    }
    lines.push("");
    lines.push(shaderCode.trimEnd());
    lines.push("");
    lines.push("struct FragmentInput {");
    lines.push("  @location(0) vUV: vec2f,");
    let locationOffset = 1;
    if (instanceStruct && instanceLayout && useInstanceInFragment) {
      for (const field of instanceLayout.fields) {
        lines.push(`  @location(${locationOffset}) vInst_${field.name}: ${field.wgslType},`);
        locationOffset += 1;
      }
    }
    lines.push("};");
    lines.push("");
    if (instanceStruct && instanceLayout && useInstanceInFragment) {
      lines.push(`fn load_${instanceStruct.name}_fragment(input: FragmentInput) -> ${instanceStruct.name} {`);
      if (instanceLayout.fields.length === 0) {
        lines.push(`  return ${instanceStruct.name}();`);
      } else {
        lines.push(`  return ${instanceStruct.name}(`);
        for (const field of instanceLayout.fields) {
          lines.push(`    input.vInst_${field.name},`);
        }
        lines.push("  );");
      }
      lines.push("}");
      lines.push("");
    }
    lines.push("@fragment");
    lines.push("fn main(input: FragmentInput) -> @location(0) vec4f {");
    lines.push("  let uv = input.vUV;");
    const args = ["uv", "uniforms"];
    if (instanceStruct && useInstanceInFragment) {
      lines.push(`  let instValue = load_${instanceStruct.name}_fragment(input);`);
      args.push("instValue");
    }
    for (const param of textureParams) {
      args.push(param.textureName, param.samplerName);
    }
    lines.push(`  return fragShader(${args.join(", ")});`);
    lines.push("}");
    lines.push("");
    return `${lines.join("\n")}
`;
  }
  function buildUniformInterface(struct) {
    const interfaceLines = [];
    const defaultsLines = [];
    interfaceLines.push(`export interface ${struct.name} {`);
    defaultsLines.push(`export const ${struct.name}Defaults: ${struct.name} = {`);
    for (const member of struct.members) {
      if (member.type.isStruct) {
        throw new Error(`Uniform field ${member.name} uses unsupported struct type ${member.type.getTypeName()}.`);
      }
      if (member.type.isArray) {
        const elementType = member.format?.getTypeName();
        if (!elementType) {
          throw new Error(`Uniform array field ${member.name} element type could not be determined.`);
        }
        const mapping2 = mappingFor(elementType);
        if (!mapping2) {
          throw new Error(`Uniform array field ${member.name} uses unsupported element type ${elementType}.`);
        }
        const elementTypeTs = mapping2.tsType;
        interfaceLines.push(`  ${member.name}: readonly ${elementTypeTs}[];`);
        const count = member.count ?? 0;
        const defaultValue = mapping2.defaultExpression;
        defaultsLines.push(`  ${member.name}: Array.from({ length: ${count} }, () => ${defaultValue}),`);
        continue;
      }
      const typeName = member.type.getTypeName();
      const mapping = mappingFor(typeName);
      if (!mapping) {
        throw new Error(`Uniform field ${member.name} uses unsupported type ${typeName}.`);
      }
      interfaceLines.push(`  ${member.name}: ${mapping.tsType};`);
      defaultsLines.push(`  ${member.name}: ${mapping.defaultExpression},`);
    }
    interfaceLines.push("}");
    defaultsLines.push("};");
    return { interfaceLines, defaultsLines };
  }
  function buildUniformPacker(struct) {
    const packLines = [];
    let needsInt = false;
    let needsUint = false;
    for (const member of struct.members) {
      const offsetSlots = member.offset / 4;
      if (member.type.isArray) {
        const elementType = member.format?.getTypeName();
        if (!elementType) {
          throw new Error(`Uniform array field ${member.name} element type could not be determined.`);
        }
        const mapping2 = mappingFor(elementType);
        if (!mapping2) {
          throw new Error(`Uniform array field ${member.name} uses unsupported element type ${elementType}.`);
        }
        if (mapping2.componentType === "i32" || mapping2.componentType === "bool") {
          needsInt = true;
        }
        if (mapping2.componentType === "u32") {
          needsUint = true;
        }
        const count = member.count ?? 0;
        const strideSlots = member.size / 4 / Math.max(1, count);
        packLines.push(`  {`);
        packLines.push(`    const values = value.${member.name} ?? [];`);
        packLines.push(`    for (let i = 0; i < ${count}; i++) {`);
        packLines.push(`      const base = floatOffset + ${offsetSlots} + i * ${strideSlots};`);
        if (mapping2.isVector) {
          packLines.push(`      const source = values[i] as any;`);
          packLines.push(`      for (let c = 0; c < ${mapping2.valueLength}; c++) {`);
          packLines.push(`        const component = source?.[c];`);
          switch (mapping2.componentType) {
            case "f32":
              packLines.push("        floatView[base + c] = component !== undefined ? Number(component) : 0;");
              break;
            case "i32":
              packLines.push("        intView[base + c] = component !== undefined ? Math.trunc(component as number) : 0;");
              break;
            case "u32":
              packLines.push("        uintView[base + c] = component !== undefined ? Math.trunc(component as number) >>> 0 : 0;");
              break;
            case "bool":
              packLines.push("        intView[base + c] = component ? 1 : 0;");
              break;
          }
          packLines.push("      }");
          if (strideSlots > mapping2.valueLength) {
            packLines.push(`      for (let c = ${mapping2.valueLength}; c < ${strideSlots}; c++) {`);
            if (mapping2.componentType === "u32") {
              packLines.push("        uintView[base + c] = 0;");
            } else if (mapping2.componentType === "i32" || mapping2.componentType === "bool") {
              packLines.push("        intView[base + c] = 0;");
            } else {
              packLines.push("        floatView[base + c] = 0;");
            }
            packLines.push("      }");
          }
        } else {
          packLines.push(`      const component = values[i];`);
          switch (mapping2.componentType) {
            case "f32":
              packLines.push("      floatView[base] = component !== undefined ? Number(component) : 0;");
              break;
            case "i32":
              packLines.push("      intView[base] = component !== undefined ? Math.trunc(component as number) : 0;");
              break;
            case "u32":
              packLines.push("      uintView[base] = component !== undefined ? Math.trunc(component as number) >>> 0 : 0;");
              break;
            case "bool":
              packLines.push("      intView[base] = component ? 1 : 0;");
              break;
          }
          if (strideSlots > 1) {
            packLines.push("      for (let c = 1; c < " + strideSlots + "; c++) {");
            if (mapping2.componentType === "u32") {
              packLines.push("        uintView[base + c] = 0;");
            } else if (mapping2.componentType === "i32" || mapping2.componentType === "bool") {
              packLines.push("        intView[base + c] = 0;");
            } else {
              packLines.push("        floatView[base + c] = 0;");
            }
            packLines.push("      }");
          }
        }
        packLines.push("    }");
        packLines.push("  }");
        continue;
      }
      const typeName = member.type.getTypeName();
      const mapping = mappingFor(typeName);
      if (!mapping) {
        throw new Error(`Uniform field ${member.name} uses unsupported type ${typeName}.`);
      }
      if (mapping.componentType === "i32" || mapping.componentType === "bool") {
        needsInt = true;
      }
      if (mapping.componentType === "u32") {
        needsUint = true;
      }
      packLines.push("  {");
      packLines.push(`    const base = floatOffset + ${offsetSlots};`);
      if (!mapping.isVector) {
        switch (mapping.componentType) {
          case "f32":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    floatView[base] = raw !== undefined ? Number(raw) : 0;");
            break;
          case "i32":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    intView[base] = raw !== undefined ? Math.trunc(raw as number) : 0;");
            break;
          case "u32":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    uintView[base] = raw !== undefined ? Math.trunc(raw as number) >>> 0 : 0;");
            break;
          case "bool":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    intView[base] = raw ? 1 : 0;");
            break;
        }
      } else {
        const sourceVar = `${member.name}Source`;
        packLines.push(`    const ${sourceVar} = value.${member.name} as any;`);
        packLines.push(`    for (let i = 0; i < ${mapping.valueLength}; i++) {`);
        packLines.push(`      const component = ${sourceVar}?.[i];`);
        switch (mapping.componentType) {
          case "f32":
            packLines.push("      floatView[base + i] = component !== undefined ? Number(component) : 0;");
            break;
          case "i32":
            packLines.push("      intView[base + i] = component !== undefined ? Math.trunc(component as number) : 0;");
            break;
          case "u32":
            packLines.push("      uintView[base + i] = component !== undefined ? Math.trunc(component as number) >>> 0 : 0;");
            break;
          case "bool":
            packLines.push("      intView[base + i] = component ? 1 : 0;");
            break;
        }
        packLines.push("    }");
        if (mapping.slotCount > mapping.valueLength) {
          packLines.push(`    for (let i = ${mapping.valueLength}; i < ${mapping.slotCount}; i++) {`);
          if (mapping.componentType === "u32") {
            packLines.push("      uintView[base + i] = 0;");
          } else if (mapping.componentType === "i32" || mapping.componentType === "bool") {
            packLines.push("      intView[base + i] = 0;");
          } else {
            packLines.push("      floatView[base + i] = 0;");
          }
          packLines.push("    }");
        }
      }
      packLines.push("  }");
    }
    return { packLines, needsInt, needsUint };
  }
  function generateMaterialTypesSource(shaderCode, shaderBaseName) {
    const shaderPrefix = toPascalCase(shaderBaseName);
    const reflect = new _t(shaderCode);
    const vertFn = reflect.functions.find((fn) => fn.name === "vertShader" && !fn.stage);
    const fragFn = reflect.functions.find((fn) => fn.name === "fragShader" && !fn.stage);
    if (!vertFn) {
      throw new Error("Missing vertShader function.");
    }
    if (!fragFn) {
      throw new Error("Missing fragShader function.");
    }
    if (vertFn.arguments.length !== 3 && vertFn.arguments.length !== 4) {
      throw new Error("vertShader must declare 3 arguments (position, uv, uniforms) or 4 arguments (position, uv, uniforms, instance).");
    }
    validateType(vertFn.arguments[0], "vec2f", "vertShader position argument");
    validateType(vertFn.arguments[1], "vec2f", "vertShader uv argument");
    const uniformArg = vertFn.arguments[2];
    const uniformStruct = reflect.structs.find((entry) => entry.name === uniformArg.type.getTypeName());
    if (!uniformStruct) {
      throw new Error(`Uniform struct ${uniformArg.type.getTypeName()} not found.`);
    }
    let instanceStruct;
    if (vertFn.arguments.length === 4) {
      const instanceArg = vertFn.arguments[3];
      instanceStruct = reflect.structs.find((entry) => entry.name === instanceArg.type.getTypeName());
      if (!instanceStruct) {
        throw new Error(`Instance struct ${instanceArg.type.getTypeName()} not found.`);
      }
    }
    if (fragFn.arguments.length < 2) {
      throw new Error("fragShader must declare at least 2 arguments (uv, uniforms).");
    }
    validateType(fragFn.arguments[0], "vec2f", "fragShader uv argument");
    const fragUniformArg = fragFn.arguments[1];
    if (fragUniformArg.type.getTypeName() !== uniformStruct.name) {
      throw new Error(`fragShader uniforms must use struct ${uniformStruct.name}.`);
    }
    let resourceStartIndex = 2;
    let useInstanceInFragment = false;
    let instanceLayout;
    if (instanceStruct) {
      if (fragFn.arguments.length < 3) {
        throw new Error("fragShader must declare instance argument when vertShader does.");
      }
      const fragInstanceArg = fragFn.arguments[2];
      if (fragInstanceArg.type.getTypeName() !== instanceStruct.name) {
        throw new Error(`fragShader instance must use struct ${instanceStruct.name}.`);
      }
      useInstanceInFragment = true;
      resourceStartIndex = 3;
      instanceLayout = collectInstanceLayout(instanceStruct);
    }
    const textureParams = parseTextureParams(fragFn.arguments, resourceStartIndex, "fragShader");
    const vertexSource = buildVertexSource({
      shaderCode,
      uniformStructName: uniformStruct.name,
      instanceStruct,
      instanceLayout,
      useInstanceInFragment
    });
    const fragmentSource = buildFragmentSource({
      shaderCode,
      uniformStructName: uniformStruct.name,
      textureParams,
      instanceStruct,
      instanceLayout,
      useInstanceInFragment
    });
    const { interfaceLines, defaultsLines } = buildUniformInterface(uniformStruct);
    const { packLines, needsInt, needsUint } = buildUniformPacker(uniformStruct);
    const textureNames = textureParams.map((param) => param.textureName);
    const textureNameUnion = textureNames.length ? textureNames.map((name) => `'${name}'`).join(" | ") : "never";
    const textureNamesLiteral = textureNames.length ? `[${textureNames.map((name) => `'${name}'`).join(", ")}] as const` : "[] as const";
    const materialInterfaceName = `${shaderPrefix}MaterialDef`;
    const materialInstanceName = `${shaderPrefix}MaterialInstance`;
    const materialConstName = `${shaderPrefix}Material`;
    const attributeOrder = ["position", "uv"];
    if (instanceLayout) {
      for (const field of instanceLayout.fields) {
        attributeOrder.push(`inst_${field.name}`);
      }
    }
    const vertexBuffersLines = [];
    const attributeLines = [];
    let location = 0;
    vertexBuffersLines.push("    buffers: [");
    const baseAttributes = [
      { name: "position", format: "float32x2" },
      { name: "uv", format: "float32x2" }
    ];
    for (const attr of baseAttributes) {
      vertexBuffersLines.push("      {");
      vertexBuffersLines.push(`        arrayStride: 8,`);
      vertexBuffersLines.push(`        attributes: [{ shaderLocation: ${location}, offset: 0, format: '${attr.format}' }],`);
      vertexBuffersLines.push("      },");
      location += 1;
    }
    if (instanceLayout) {
      for (const field of instanceLayout.fields) {
        vertexBuffersLines.push("      {");
        vertexBuffersLines.push(`        arrayStride: ${instanceLayout.totalFloats * 4},`);
        vertexBuffersLines.push(`        stepMode: 'instance',`);
        vertexBuffersLines.push(`        attributes: [{ shaderLocation: ${location}, offset: ${field.offset * 4}, format: '${field.attributeType}' }],`);
        vertexBuffersLines.push("      },");
        attributeLines.push("");
        location += 1;
      }
    }
    vertexBuffersLines.push("    ],");
    const bindingBase = 2;
    const textureBindingEntries = textureParams.map((param, index) => {
      const textureBinding = bindingBase + index * 2;
      const samplerBinding = textureBinding + 1;
      return { param, textureBinding, samplerBinding };
    });
    const tsLines = [];
    tsLines.push(HEADER_COMMENT);
    tsLines.push(`import type { MaterialDef, MaterialInstance, BatchMaterialDef, InstanceAttrLayout } from '@avtools/power2d/raw';`);
    tsLines.push("");
    tsLines.push(`export const ${shaderPrefix}VertexSource = ${escapeTemplateLiteral(vertexSource)};`);
    tsLines.push(`export const ${shaderPrefix}FragmentSource = ${escapeTemplateLiteral(fragmentSource)};`);
    tsLines.push("");
    tsLines.push(...interfaceLines);
    tsLines.push("");
    tsLines.push(...defaultsLines);
    tsLines.push("");
    tsLines.push(`export type ${shaderPrefix}TextureName = ${textureNameUnion};`);
    tsLines.push(`export const ${shaderPrefix}TextureNames = ${textureNamesLiteral};`);
    tsLines.push("");
    if (instanceLayout && instanceStruct) {
      tsLines.push(`export interface ${instanceStruct.name} {`);
      for (const field of instanceLayout.fields) {
        tsLines.push(`  ${field.name}: ${field.tsType};`);
      }
      tsLines.push("}");
      tsLines.push("");
      tsLines.push(`export const ${shaderPrefix}InstanceAttrLayout: InstanceAttrLayout<${instanceStruct.name}> = {`);
      tsLines.push(`  size: ${instanceLayout.totalFloats},`);
      tsLines.push("  members: [");
      for (const field of instanceLayout.fields) {
        tsLines.push(`    { name: '${field.name}', offset: ${field.offset}, floatCount: ${field.floatCount} },`);
      }
      tsLines.push("  ],");
      tsLines.push("};");
      tsLines.push("");
    }
    const layoutSize = uniformStruct.size;
    tsLines.push(`const ${uniformStruct.name}LayoutSize = ${layoutSize};`);
    tsLines.push("");
    tsLines.push(`function pack${uniformStruct.name}(floatView: Float32Array, intView: Int32Array, uintView: Uint32Array, floatOffset: number, value: ${uniformStruct.name}): void {`);
    tsLines.push(...packLines.length ? packLines : ["  // No uniforms to pack"]);
    tsLines.push("}");
    tsLines.push("");
    tsLines.push(`export interface ${materialInstanceName} extends MaterialInstance<${uniformStruct.name}, ${shaderPrefix}TextureName> {}`);
    tsLines.push("");
    tsLines.push(`export function create${shaderPrefix}Material(device: GPUDevice, format: GPUTextureFormat, name = '${shaderPrefix}Material'): ${materialInstanceName} {`);
    tsLines.push("  const uniformData = new ArrayBuffer(" + layoutSize + ");");
    tsLines.push("  const uniformFloats = new Float32Array(uniformData);");
    if (needsInt) {
      tsLines.push("  const uniformInts = new Int32Array(uniformData);");
    } else {
      tsLines.push("  const uniformInts = new Int32Array(uniformData);");
    }
    if (needsUint) {
      tsLines.push("  const uniformUints = new Uint32Array(uniformData);");
    } else {
      tsLines.push("  const uniformUints = new Uint32Array(uniformData);");
    }
    tsLines.push(`  let currentUniforms: ${uniformStruct.name} = { ...${uniformStruct.name}Defaults };`);
    tsLines.push("  pack" + uniformStruct.name + "(uniformFloats, uniformInts, uniformUints, 0, currentUniforms);");
    tsLines.push("  const uniformBuffer = device.createBuffer({ size: uniformData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });");
    tsLines.push("  device.queue.writeBuffer(uniformBuffer, 0, uniformData);");
    tsLines.push("");
    tsLines.push("  const builtinsData = new Float32Array([");
    tsLines.push("    0, 0, 0, 0,");
    tsLines.push("    1, 1, 0, 0,");
    tsLines.push("  ]);");
    tsLines.push("  const builtinsBuffer = device.createBuffer({ size: builtinsData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });");
    tsLines.push("  device.queue.writeBuffer(builtinsBuffer, 0, builtinsData);");
    tsLines.push("");
    tsLines.push("  const bindGroupLayout = device.createBindGroupLayout({ entries: [");
    tsLines.push('    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },');
    tsLines.push('    { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },');
    for (const entry of textureBindingEntries) {
      tsLines.push(`    { binding: ${entry.textureBinding}, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },`);
      tsLines.push(`    { binding: ${entry.samplerBinding}, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },`);
    }
    tsLines.push("  ] });");
    tsLines.push("");
    tsLines.push("  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });");
    tsLines.push(`  const vertexModule = device.createShaderModule({ code: ${shaderPrefix}VertexSource });`);
    tsLines.push(`  const fragmentModule = device.createShaderModule({ code: ${shaderPrefix}FragmentSource });`);
    tsLines.push("");
    tsLines.push("  const pipeline = device.createRenderPipeline({");
    tsLines.push("    layout: pipelineLayout,");
    tsLines.push("    vertex: {");
    tsLines.push("      module: vertexModule,");
    tsLines.push("      entryPoint: 'main',");
    tsLines.push(...vertexBuffersLines);
    tsLines.push("    },");
    tsLines.push("    fragment: {");
    tsLines.push("      module: fragmentModule,");
    tsLines.push("      entryPoint: 'main',");
    tsLines.push("      targets: [{ format }],");
    tsLines.push("    },");
    tsLines.push("    primitive: { topology: 'triangle-list', cullMode: 'none' },");
    tsLines.push("  });");
    tsLines.push("");
    tsLines.push("  const samplers: Record<string, GPUSampler> = {};");
    tsLines.push("  const textureViews: Record<string, GPUTextureView> = {};");
    if (textureBindingEntries.length > 0) {
      tsLines.push(`  for (const name of ${shaderPrefix}TextureNames) {`);
      tsLines.push('    samplers[name] = device.createSampler({ magFilter: "linear", minFilter: "linear" });');
      tsLines.push("    const placeholder = device.createTexture({ size: { width: 1, height: 1 }, format, usage: GPUTextureUsage.TEXTURE_BINDING });");
      tsLines.push("    textureViews[name] = placeholder.createView();");
      tsLines.push("  }");
    }
    tsLines.push("");
    tsLines.push("  let bindGroup = device.createBindGroup({");
    tsLines.push("    layout: bindGroupLayout,");
    tsLines.push("    entries: [");
    tsLines.push("      { binding: 0, resource: { buffer: uniformBuffer } },");
    tsLines.push("      { binding: 1, resource: { buffer: builtinsBuffer } },");
    for (const entry of textureBindingEntries) {
      tsLines.push(`      { binding: ${entry.textureBinding}, resource: textureViews['${entry.param.textureName}'] },`);
      tsLines.push(`      { binding: ${entry.samplerBinding}, resource: samplers['${entry.param.textureName}'] },`);
    }
    tsLines.push("    ],");
    tsLines.push("  });");
    tsLines.push("");
    tsLines.push("  const rebuildBindGroup = () => {");
    tsLines.push("    bindGroup = device.createBindGroup({");
    tsLines.push("      layout: bindGroupLayout,");
    tsLines.push("      entries: [");
    tsLines.push("        { binding: 0, resource: { buffer: uniformBuffer } },");
    tsLines.push("        { binding: 1, resource: { buffer: builtinsBuffer } },");
    for (const entry of textureBindingEntries) {
      tsLines.push(`        { binding: ${entry.textureBinding}, resource: textureViews['${entry.param.textureName}'] },`);
      tsLines.push(`        { binding: ${entry.samplerBinding}, resource: samplers['${entry.param.textureName}'] },`);
    }
    tsLines.push("      ],");
    tsLines.push("    });");
    tsLines.push("  };");
    tsLines.push("");
    tsLines.push("  const instance: " + materialInstanceName + " = {");
    tsLines.push("    pipeline,");
    tsLines.push("    get bindGroup() { return bindGroup; },");
    tsLines.push(`    attributeOrder: ${JSON.stringify(attributeOrder)},`);
    tsLines.push("    setUniforms: (updates) => {");
    tsLines.push("      currentUniforms = { ...currentUniforms, ...updates };");
    tsLines.push(`      pack${uniformStruct.name}(uniformFloats, uniformInts, uniformUints, 0, currentUniforms);`);
    tsLines.push("      device.queue.writeBuffer(uniformBuffer, 0, uniformData);");
    tsLines.push("    },");
    tsLines.push("    setBuiltins: (updates) => {");
    tsLines.push("      if (updates.power2d_shapeTranslate) { builtinsData[0] = updates.power2d_shapeTranslate[0]; builtinsData[1] = updates.power2d_shapeTranslate[1]; }");
    tsLines.push("      if (updates.power2d_shapeRotation !== undefined) { builtinsData[2] = updates.power2d_shapeRotation; }");
    tsLines.push("      if (updates.power2d_shapeScale) { builtinsData[4] = updates.power2d_shapeScale[0]; builtinsData[5] = updates.power2d_shapeScale[1]; }");
    tsLines.push("      if (updates.power2d_canvasWidth !== undefined) { builtinsData[6] = updates.power2d_canvasWidth; }");
    tsLines.push("      if (updates.power2d_canvasHeight !== undefined) { builtinsData[7] = updates.power2d_canvasHeight; }");
    tsLines.push("      device.queue.writeBuffer(builtinsBuffer, 0, builtinsData);");
    tsLines.push("    },");
    tsLines.push("    setTexture: (name, texture) => {");
    tsLines.push("      textureViews[name] = 'createView' in texture ? texture.createView() : texture;");
    tsLines.push("      rebuildBindGroup();");
    tsLines.push("    },");
    tsLines.push("    setCanvasSize: (width, height) => {");
    tsLines.push("      builtinsData[6] = width;");
    tsLines.push("      builtinsData[7] = height;");
    tsLines.push("      device.queue.writeBuffer(builtinsBuffer, 0, builtinsData);");
    tsLines.push("    },");
    tsLines.push("    dispose: () => {");
    tsLines.push("      uniformBuffer.destroy();");
    tsLines.push("      builtinsBuffer.destroy();");
    tsLines.push("    },");
    tsLines.push("  };");
    tsLines.push("");
    tsLines.push("  return instance;");
    tsLines.push("}");
    tsLines.push("");
    if (instanceLayout && instanceStruct) {
      tsLines.push(`export interface ${materialInterfaceName} extends BatchMaterialDef<${uniformStruct.name}, ${shaderPrefix}TextureName, ${instanceStruct.name}> {}`);
    } else {
      tsLines.push(`export interface ${materialInterfaceName} extends MaterialDef<${uniformStruct.name}, ${shaderPrefix}TextureName> {}`);
    }
    tsLines.push(`export const ${materialConstName}: ${materialInterfaceName} = {`);
    tsLines.push(`  createMaterial: create${shaderPrefix}Material,`);
    tsLines.push(`  uniformDefaults: ${uniformStruct.name}Defaults,`);
    tsLines.push(`  textureNames: ${shaderPrefix}TextureNames,`);
    if (instanceLayout && instanceStruct) {
      tsLines.push(`  instanceAttrLayout: ${shaderPrefix}InstanceAttrLayout,`);
    }
    tsLines.push("};");
    tsLines.push("");
    tsLines.push(`export default ${materialConstName};`);
    return { typesSource: `${tsLines.join("\n")}
` };
  }

  // packages/power2d-codegen/wgsl/generateStrokeMaterialTypesCore_RAW.ts
  var HEADER_COMMENT2 = "// Auto-generated by power2d raw stroke material generator. DO NOT EDIT.";
  var SHAPE_TRANSLATE_UNIFORM2 = "power2d_shapeTranslate";
  var SHAPE_ROTATION_UNIFORM2 = "power2d_shapeRotation";
  var SHAPE_SCALE_UNIFORM2 = "power2d_shapeScale";
  var STROKE_THICKNESS_UNIFORM = "power2d_strokeThickness";
  var TYPE_MAP2 = {
    f32: { tsType: "number", slotCount: 1, valueLength: 1, componentType: "f32", isVector: false, defaultExpression: "0" },
    i32: { tsType: "number", slotCount: 1, valueLength: 1, componentType: "i32", isVector: false, defaultExpression: "0" },
    u32: { tsType: "number", slotCount: 1, valueLength: 1, componentType: "u32", isVector: false, defaultExpression: "0" },
    bool: { tsType: "boolean", slotCount: 1, valueLength: 1, componentType: "bool", isVector: false, defaultExpression: "false" },
    vec2f: { tsType: "readonly [number, number]", slotCount: 2, valueLength: 2, componentType: "f32", isVector: true, defaultExpression: "[0, 0]" },
    vec3f: { tsType: "readonly [number, number, number]", slotCount: 4, valueLength: 3, componentType: "f32", isVector: true, defaultExpression: "[0, 0, 0]" },
    vec4f: { tsType: "readonly [number, number, number, number]", slotCount: 4, valueLength: 4, componentType: "f32", isVector: true, defaultExpression: "[0, 0, 0, 0]" },
    mat4x4f: { tsType: "Float32Array | readonly number[]", slotCount: 16, valueLength: 16, componentType: "f32", isVector: true, defaultExpression: "new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])" }
  };
  function mappingFor2(typeName) {
    return TYPE_MAP2[typeName] ?? null;
  }
  function validateType2(argument, expected, label) {
    const typeName = argument.type.getTypeName();
    if (typeName !== expected) {
      throw new Error(`${label} must be ${expected}. Received ${argument.name}: ${typeName}`);
    }
  }
  function parseTextureParams2(args, startIndex, functionName) {
    const params = [];
    const seenTextures = /* @__PURE__ */ new Set();
    for (let index = startIndex; index < args.length; index += 2) {
      const textureArg = args[index];
      const samplerArg = args[index + 1];
      if (!textureArg || !samplerArg) {
        throw new Error(`Texture parameters in ${functionName} must be provided in texture/sampler pairs.`);
      }
      const textureType = textureArg.type.getTypeName();
      if (textureType !== "texture_2d<f32>") {
        throw new Error(`Texture argument must be texture_2d<f32>. Received ${textureArg.name}: ${textureType}`);
      }
      const samplerType = samplerArg.type.getTypeName();
      if (samplerType !== "sampler") {
        throw new Error(`Expected sampler after texture ${textureArg.name}, but got ${samplerArg.name}: ${samplerType}. Texture parameters must be provided in texture/sampler pairs.`);
      }
      if (seenTextures.has(textureArg.name)) {
        throw new Error(`Duplicate texture parameter ${textureArg.name} detected.`);
      }
      seenTextures.add(textureArg.name);
      params.push({
        textureName: textureArg.name,
        samplerName: samplerArg.name
      });
    }
    return params;
  }
  function buildVertexSource2(options) {
    const { shaderCode, uniformStructName } = options;
    const lines = [];
    lines.push(HEADER_COMMENT2);
    lines.push(`@group(0) @binding(0) var<uniform> uniforms: ${uniformStructName};`);
    lines.push("struct Power2DBuiltins {");
    lines.push(`  ${SHAPE_TRANSLATE_UNIFORM2}: vec2f,`);
    lines.push(`  ${SHAPE_ROTATION_UNIFORM2}: f32,`);
    lines.push("  _pad0: f32,");
    lines.push(`  ${SHAPE_SCALE_UNIFORM2}: vec2f,`);
    lines.push("  power2d_canvasWidth: f32,");
    lines.push("  power2d_canvasHeight: f32,");
    lines.push(`  ${STROKE_THICKNESS_UNIFORM}: f32,`);
    lines.push("  _pad1: f32,");
    lines.push("};");
    lines.push("@group(0) @binding(1) var<uniform> power2d: Power2DBuiltins;");
    lines.push("");
    lines.push(shaderCode.trimEnd());
    lines.push("");
    lines.push("struct VertexInput {");
    lines.push("  @location(0) position: vec2f,");
    lines.push("  @location(1) uv: vec2f,");
    lines.push("  @location(2) strokeNormal: vec2f,");
    lines.push("  @location(3) strokeSide: f32,");
    lines.push("  @location(4) strokeArcLength: f32,");
    lines.push("  @location(5) strokeNormalizedArc: f32,");
    lines.push("  @location(6) strokeMiterFactor: f32,");
    lines.push("};");
    lines.push("struct VertexOutput {");
    lines.push("  @builtin(position) position: vec4f,");
    lines.push("  @location(0) vUV: vec2f,");
    lines.push("  @location(1) vStrokeNormal: vec2f,");
    lines.push("  @location(2) vStrokeSide: f32,");
    lines.push("  @location(3) vStrokeArcLength: f32,");
    lines.push("  @location(4) vStrokeNormalizedArc: f32,");
    lines.push("  @location(5) vStrokeMiterFactor: f32,");
    lines.push("};");
    lines.push("");
    lines.push("fn power2d_applyShapeTransform(pixel: vec2f) -> vec2f {");
    lines.push(`  let scaled = pixel * power2d.${SHAPE_SCALE_UNIFORM2};`);
    lines.push(`  let s = sin(power2d.${SHAPE_ROTATION_UNIFORM2});`);
    lines.push(`  let c = cos(power2d.${SHAPE_ROTATION_UNIFORM2});`);
    lines.push("  let rotated = vec2f(");
    lines.push("    scaled.x * c - scaled.y * s,");
    lines.push("    scaled.x * s + scaled.y * c,");
    lines.push("  );");
    lines.push(`  return rotated + power2d.${SHAPE_TRANSLATE_UNIFORM2};`);
    lines.push("}");
    lines.push("");
    lines.push("fn power2d_pixelToNDC(pixel: vec2f) -> vec4f {");
    lines.push("  let ndcX = (pixel.x / power2d.power2d_canvasWidth) * 2.0 - 1.0;");
    lines.push("  let ndcY = -((pixel.y / power2d.power2d_canvasHeight) * 2.0 - 1.0);");
    lines.push("  return vec4f(ndcX, ndcY, 0.0, 1.0);");
    lines.push("}");
    lines.push("");
    lines.push("@vertex");
    lines.push("fn main(input: VertexInput) -> VertexOutput {");
    lines.push("  var out: VertexOutput;");
    lines.push("  let pixelPos = input.position;");
    lines.push("  let uv = input.uv;");
    lines.push("  let normal = input.strokeNormal;");
    lines.push("  let side = input.strokeSide;");
    lines.push("  let arcLength = input.strokeArcLength;");
    lines.push("  let normalizedArc = input.strokeNormalizedArc;");
    lines.push("  let miterFactor = input.strokeMiterFactor;");
    lines.push(`  let adjustedPixelPos = vertShader(pixelPos, uv, normal, side, arcLength, normalizedArc, miterFactor, uniforms);`);
    lines.push("  let transformedPixelPos = power2d_applyShapeTransform(adjustedPixelPos);");
    lines.push("  out.position = power2d_pixelToNDC(transformedPixelPos);");
    lines.push("  out.vUV = uv;");
    lines.push("  out.vStrokeNormal = normal;");
    lines.push("  out.vStrokeSide = side;");
    lines.push("  out.vStrokeArcLength = arcLength;");
    lines.push("  out.vStrokeNormalizedArc = normalizedArc;");
    lines.push("  out.vStrokeMiterFactor = miterFactor;");
    lines.push("  return out;");
    lines.push("}");
    lines.push("");
    return `${lines.join("\n")}
`;
  }
  function buildFragmentSource2(options) {
    const { shaderCode, uniformStructName, textureParams } = options;
    const lines = [];
    lines.push(HEADER_COMMENT2);
    lines.push(`@group(0) @binding(0) var<uniform> uniforms: ${uniformStructName};`);
    lines.push("struct Power2DBuiltins {");
    lines.push(`  ${SHAPE_TRANSLATE_UNIFORM2}: vec2f,`);
    lines.push(`  ${SHAPE_ROTATION_UNIFORM2}: f32,`);
    lines.push("  _pad0: f32,");
    lines.push(`  ${SHAPE_SCALE_UNIFORM2}: vec2f,`);
    lines.push("  power2d_canvasWidth: f32,");
    lines.push("  power2d_canvasHeight: f32,");
    lines.push(`  ${STROKE_THICKNESS_UNIFORM}: f32,`);
    lines.push("  _pad1: f32,");
    lines.push("};");
    lines.push("@group(0) @binding(1) var<uniform> power2d: Power2DBuiltins;");
    let bindingIndex = 2;
    for (const param of textureParams) {
      lines.push(`@group(0) @binding(${bindingIndex}) var ${param.textureName}: texture_2d<f32>;`);
      bindingIndex += 1;
      lines.push(`@group(0) @binding(${bindingIndex}) var ${param.samplerName}: sampler;`);
      bindingIndex += 1;
    }
    lines.push("");
    lines.push(shaderCode.trimEnd());
    lines.push("");
    lines.push("struct FragmentInput {");
    lines.push("  @location(0) vUV: vec2f,");
    lines.push("  @location(1) vStrokeNormal: vec2f,");
    lines.push("  @location(2) vStrokeSide: f32,");
    lines.push("  @location(3) vStrokeArcLength: f32,");
    lines.push("  @location(4) vStrokeNormalizedArc: f32,");
    lines.push("  @location(5) vStrokeMiterFactor: f32,");
    lines.push("};");
    lines.push("");
    lines.push("@fragment");
    lines.push("fn main(input: FragmentInput) -> @location(0) vec4f {");
    lines.push("  let uv = input.vUV;");
    lines.push("  let normal = input.vStrokeNormal;");
    lines.push("  let side = input.vStrokeSide;");
    lines.push("  let arcLength = input.vStrokeArcLength;");
    lines.push("  let normalizedArc = input.vStrokeNormalizedArc;");
    lines.push("  let miterFactor = input.vStrokeMiterFactor;");
    const args = ["uv", "normal", "side", "arcLength", "normalizedArc", "miterFactor", "uniforms"];
    for (const param of textureParams) {
      args.push(param.textureName, param.samplerName);
    }
    lines.push(`  return fragShader(${args.join(", ")});`);
    lines.push("}");
    lines.push("");
    return `${lines.join("\n")}
`;
  }
  function buildUniformInterface2(struct) {
    const interfaceLines = [];
    const defaultsLines = [];
    interfaceLines.push(`export interface ${struct.name} {`);
    defaultsLines.push(`export const ${struct.name}Defaults: ${struct.name} = {`);
    for (const member of struct.members) {
      if (member.type.isStruct) {
        throw new Error(`Uniform field ${member.name} uses unsupported struct type ${member.type.getTypeName()}.`);
      }
      if (member.type.isArray) {
        const elementType = member.format?.getTypeName();
        if (!elementType) {
          throw new Error(`Uniform array field ${member.name} element type could not be determined.`);
        }
        const mapping2 = mappingFor2(elementType);
        if (!mapping2) {
          throw new Error(`Uniform array field ${member.name} uses unsupported element type ${elementType}.`);
        }
        interfaceLines.push(`  ${member.name}: readonly ${mapping2.tsType}[];`);
        const count = member.count ?? 0;
        defaultsLines.push(`  ${member.name}: Array.from({ length: ${count} }, () => ${mapping2.defaultExpression}),`);
        continue;
      }
      const typeName = member.type.getTypeName();
      const mapping = mappingFor2(typeName);
      if (!mapping) {
        throw new Error(`Uniform field ${member.name} uses unsupported type ${typeName}.`);
      }
      interfaceLines.push(`  ${member.name}: ${mapping.tsType};`);
      defaultsLines.push(`  ${member.name}: ${mapping.defaultExpression},`);
    }
    interfaceLines.push("}");
    defaultsLines.push("};");
    return { interfaceLines, defaultsLines };
  }
  function buildUniformPacker2(struct) {
    const packLines = [];
    let needsInt = false;
    let needsUint = false;
    for (const member of struct.members) {
      const offsetSlots = member.offset / 4;
      if (member.type.isArray) {
        const elementType = member.format?.getTypeName();
        if (!elementType) {
          throw new Error(`Uniform array field ${member.name} element type could not be determined.`);
        }
        const mapping2 = mappingFor2(elementType);
        if (!mapping2) {
          throw new Error(`Uniform array field ${member.name} uses unsupported element type ${elementType}.`);
        }
        if (mapping2.componentType === "i32" || mapping2.componentType === "bool") {
          needsInt = true;
        }
        if (mapping2.componentType === "u32") {
          needsUint = true;
        }
        const count = member.count ?? 0;
        const strideSlots = member.size / 4 / Math.max(1, count);
        packLines.push(`  {`);
        packLines.push(`    const values = value.${member.name} ?? [];`);
        packLines.push(`    for (let i = 0; i < ${count}; i++) {`);
        packLines.push(`      const base = floatOffset + ${offsetSlots} + i * ${strideSlots};`);
        if (mapping2.isVector) {
          packLines.push(`      const source = values[i] as any;`);
          packLines.push(`      for (let c = 0; c < ${mapping2.valueLength}; c++) {`);
          packLines.push(`        const component = source?.[c];`);
          switch (mapping2.componentType) {
            case "f32":
              packLines.push("        floatView[base + c] = component !== undefined ? Number(component) : 0;");
              break;
            case "i32":
              packLines.push("        intView[base + c] = component !== undefined ? Math.trunc(component as number) : 0;");
              break;
            case "u32":
              packLines.push("        uintView[base + c] = component !== undefined ? Math.trunc(component as number) >>> 0 : 0;");
              break;
            case "bool":
              packLines.push("        intView[base + c] = component ? 1 : 0;");
              break;
          }
          packLines.push("      }");
          if (strideSlots > mapping2.valueLength) {
            packLines.push(`      for (let c = ${mapping2.valueLength}; c < ${strideSlots}; c++) {`);
            if (mapping2.componentType === "u32") {
              packLines.push("        uintView[base + c] = 0;");
            } else if (mapping2.componentType === "i32" || mapping2.componentType === "bool") {
              packLines.push("        intView[base + c] = 0;");
            } else {
              packLines.push("        floatView[base + c] = 0;");
            }
            packLines.push("      }");
          }
        } else {
          packLines.push(`      const component = values[i];`);
          switch (mapping2.componentType) {
            case "f32":
              packLines.push("      floatView[base] = component !== undefined ? Number(component) : 0;");
              break;
            case "i32":
              packLines.push("      intView[base] = component !== undefined ? Math.trunc(component as number) : 0;");
              break;
            case "u32":
              packLines.push("      uintView[base] = component !== undefined ? Math.trunc(component as number) >>> 0 : 0;");
              break;
            case "bool":
              packLines.push("      intView[base] = component ? 1 : 0;");
              break;
          }
          if (strideSlots > 1) {
            packLines.push("      for (let c = 1; c < " + strideSlots + "; c++) {");
            if (mapping2.componentType === "u32") {
              packLines.push("        uintView[base + c] = 0;");
            } else if (mapping2.componentType === "i32" || mapping2.componentType === "bool") {
              packLines.push("        intView[base + c] = 0;");
            } else {
              packLines.push("        floatView[base + c] = 0;");
            }
            packLines.push("      }");
          }
        }
        packLines.push("    }");
        packLines.push("  }");
        continue;
      }
      const typeName = member.type.getTypeName();
      const mapping = mappingFor2(typeName);
      if (!mapping) {
        throw new Error(`Uniform field ${member.name} uses unsupported type ${typeName}.`);
      }
      if (mapping.componentType === "i32" || mapping.componentType === "bool") {
        needsInt = true;
      }
      if (mapping.componentType === "u32") {
        needsUint = true;
      }
      packLines.push("  {");
      packLines.push(`    const base = floatOffset + ${offsetSlots};`);
      if (!mapping.isVector) {
        switch (mapping.componentType) {
          case "f32":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    floatView[base] = raw !== undefined ? Number(raw) : 0;");
            break;
          case "i32":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    intView[base] = raw !== undefined ? Math.trunc(raw as number) : 0;");
            break;
          case "u32":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    uintView[base] = raw !== undefined ? Math.trunc(raw as number) >>> 0 : 0;");
            break;
          case "bool":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    intView[base] = raw ? 1 : 0;");
            break;
        }
      } else {
        const sourceVar = `${member.name}Source`;
        packLines.push(`    const ${sourceVar} = value.${member.name} as any;`);
        packLines.push(`    for (let i = 0; i < ${mapping.valueLength}; i++) {`);
        packLines.push(`      const component = ${sourceVar}?.[i];`);
        switch (mapping.componentType) {
          case "f32":
            packLines.push("      floatView[base + i] = component !== undefined ? Number(component) : 0;");
            break;
          case "i32":
            packLines.push("      intView[base + i] = component !== undefined ? Math.trunc(component as number) : 0;");
            break;
          case "u32":
            packLines.push("      uintView[base + i] = component !== undefined ? Math.trunc(component as number) >>> 0 : 0;");
            break;
          case "bool":
            packLines.push("      intView[base + i] = component ? 1 : 0;");
            break;
        }
        packLines.push("    }");
        if (mapping.slotCount > mapping.valueLength) {
          packLines.push(`    for (let i = ${mapping.valueLength}; i < ${mapping.slotCount}; i++) {`);
          if (mapping.componentType === "u32") {
            packLines.push("      uintView[base + i] = 0;");
          } else if (mapping.componentType === "i32" || mapping.componentType === "bool") {
            packLines.push("      intView[base + i] = 0;");
          } else {
            packLines.push("      floatView[base + i] = 0;");
          }
          packLines.push("    }");
        }
      }
      packLines.push("  }");
    }
    return { packLines, needsInt, needsUint };
  }
  function generateStrokeMaterialTypesSource(shaderCode, shaderBaseName) {
    const shaderPrefix = toPascalCase(shaderBaseName);
    const reflect = new _t(shaderCode);
    const vertFn = reflect.functions.find((fn) => fn.name === "vertShader" && !fn.stage);
    const fragFn = reflect.functions.find((fn) => fn.name === "fragShader" && !fn.stage);
    if (!vertFn) {
      throw new Error("Missing vertShader function.");
    }
    if (!fragFn) {
      throw new Error("Missing fragShader function.");
    }
    if (vertFn.arguments.length !== 8) {
      throw new Error("Stroke vertShader must declare 8 arguments (position, uv, normal, side, arcLength, normalizedArc, miterFactor, uniforms).");
    }
    validateType2(vertFn.arguments[0], "vec2f", "vertShader position argument");
    validateType2(vertFn.arguments[1], "vec2f", "vertShader uv argument");
    validateType2(vertFn.arguments[2], "vec2f", "vertShader normal argument");
    validateType2(vertFn.arguments[3], "f32", "vertShader side argument");
    validateType2(vertFn.arguments[4], "f32", "vertShader arcLength argument");
    validateType2(vertFn.arguments[5], "f32", "vertShader normalizedArc argument");
    validateType2(vertFn.arguments[6], "f32", "vertShader miterFactor argument");
    const uniformArg = vertFn.arguments[7];
    const uniformStruct = reflect.structs.find((entry) => entry.name === uniformArg.type.getTypeName());
    if (!uniformStruct) {
      throw new Error(`Uniform struct ${uniformArg.type.getTypeName()} not found.`);
    }
    if (fragFn.arguments.length < 7) {
      throw new Error("fragShader must declare at least 7 arguments (uv, normal, side, arcLength, normalizedArc, miterFactor, uniforms).");
    }
    validateType2(fragFn.arguments[0], "vec2f", "fragShader uv argument");
    const fragUniformArg = fragFn.arguments[6];
    if (fragUniformArg.type.getTypeName() !== uniformStruct.name) {
      throw new Error(`fragShader uniforms must use struct ${uniformStruct.name}.`);
    }
    const textureParams = parseTextureParams2(fragFn.arguments, 7, "fragShader");
    const vertexSource = buildVertexSource2({
      shaderCode,
      uniformStructName: uniformStruct.name
    });
    const fragmentSource = buildFragmentSource2({
      shaderCode,
      uniformStructName: uniformStruct.name,
      textureParams
    });
    const { interfaceLines, defaultsLines } = buildUniformInterface2(uniformStruct);
    const { packLines, needsInt, needsUint } = buildUniformPacker2(uniformStruct);
    const textureNames = textureParams.map((param) => param.textureName);
    const textureNameUnion = textureNames.length ? textureNames.map((name) => `'${name}'`).join(" | ") : "never";
    const textureNamesLiteral = textureNames.length ? `[${textureNames.map((name) => `'${name}'`).join(", ")}] as const` : "[] as const";
    const materialInterfaceName = `${shaderPrefix}StrokeMaterialDef`;
    const materialInstanceName = `${shaderPrefix}StrokeMaterialInstance`;
    const materialConstName = `${shaderPrefix}StrokeMaterial`;
    const attributeOrder = ["position", "uv", "strokeNormal", "strokeSide", "strokeArcLength", "strokeNormalizedArc", "strokeMiterFactor"];
    const bindingBase = 2;
    const textureBindingEntries = textureParams.map((param, index) => {
      const textureBinding = bindingBase + index * 2;
      const samplerBinding = textureBinding + 1;
      return { param, textureBinding, samplerBinding };
    });
    const layoutSize = uniformStruct.size;
    const tsLines = [];
    tsLines.push(HEADER_COMMENT2);
    tsLines.push(`import type { MaterialDef, MaterialInstance } from '@avtools/power2d/raw';`);
    tsLines.push("");
    tsLines.push(`export const ${shaderPrefix}VertexSource = ${escapeTemplateLiteral(vertexSource)};`);
    tsLines.push(`export const ${shaderPrefix}FragmentSource = ${escapeTemplateLiteral(fragmentSource)};`);
    tsLines.push("");
    tsLines.push(...interfaceLines);
    tsLines.push("");
    tsLines.push(...defaultsLines);
    tsLines.push("");
    tsLines.push(`export type ${shaderPrefix}TextureName = ${textureNameUnion};`);
    tsLines.push(`export const ${shaderPrefix}TextureNames = ${textureNamesLiteral};`);
    tsLines.push("");
    tsLines.push(`const ${uniformStruct.name}LayoutSize = ${layoutSize};`);
    tsLines.push("");
    tsLines.push(`function pack${uniformStruct.name}(floatView: Float32Array, intView: Int32Array, uintView: Uint32Array, floatOffset: number, value: ${uniformStruct.name}): void {`);
    tsLines.push(...packLines.length ? packLines : ["  // No uniforms to pack"]);
    tsLines.push("}");
    tsLines.push("");
    tsLines.push(`export interface ${materialInstanceName} extends MaterialInstance<${uniformStruct.name}, ${shaderPrefix}TextureName> {}`);
    tsLines.push("");
    tsLines.push(`export function create${shaderPrefix}Material(device: GPUDevice, format: GPUTextureFormat, name = '${shaderPrefix}StrokeMaterial'): ${materialInstanceName} {`);
    tsLines.push("  const uniformData = new ArrayBuffer(" + layoutSize + ");");
    tsLines.push("  const uniformFloats = new Float32Array(uniformData);");
    tsLines.push("  const uniformInts = new Int32Array(uniformData);");
    tsLines.push("  const uniformUints = new Uint32Array(uniformData);");
    tsLines.push(`  let currentUniforms: ${uniformStruct.name} = { ...${uniformStruct.name}Defaults };`);
    tsLines.push("  pack" + uniformStruct.name + "(uniformFloats, uniformInts, uniformUints, 0, currentUniforms);");
    tsLines.push("  const uniformBuffer = device.createBuffer({ size: uniformData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });");
    tsLines.push("  device.queue.writeBuffer(uniformBuffer, 0, uniformData);");
    tsLines.push("");
    tsLines.push("  const builtinsData = new Float32Array([");
    tsLines.push("    0, 0, 0, 0,");
    tsLines.push("    1, 1, 0, 0,");
    tsLines.push("    1, 0,");
    tsLines.push("  ]);");
    tsLines.push("  const builtinsBuffer = device.createBuffer({ size: builtinsData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });");
    tsLines.push("  device.queue.writeBuffer(builtinsBuffer, 0, builtinsData);");
    tsLines.push("");
    tsLines.push("  const bindGroupLayout = device.createBindGroupLayout({ entries: [");
    tsLines.push('    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },');
    tsLines.push('    { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },');
    for (const entry of textureBindingEntries) {
      tsLines.push(`    { binding: ${entry.textureBinding}, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },`);
      tsLines.push(`    { binding: ${entry.samplerBinding}, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },`);
    }
    tsLines.push("  ] });");
    tsLines.push("");
    tsLines.push("  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });");
    tsLines.push(`  const vertexModule = device.createShaderModule({ code: ${shaderPrefix}VertexSource });`);
    tsLines.push(`  const fragmentModule = device.createShaderModule({ code: ${shaderPrefix}FragmentSource });`);
    tsLines.push("");
    tsLines.push("  const pipeline = device.createRenderPipeline({");
    tsLines.push("    layout: pipelineLayout,");
    tsLines.push("    vertex: {");
    tsLines.push("      module: vertexModule,");
    tsLines.push("      entryPoint: 'main',");
    tsLines.push("      buffers: [");
    tsLines.push('        { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },');
    tsLines.push('        { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] },');
    tsLines.push('        { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }] },');
    tsLines.push('        { arrayStride: 4, attributes: [{ shaderLocation: 3, offset: 0, format: "float32" }] },');
    tsLines.push('        { arrayStride: 4, attributes: [{ shaderLocation: 4, offset: 0, format: "float32" }] },');
    tsLines.push('        { arrayStride: 4, attributes: [{ shaderLocation: 5, offset: 0, format: "float32" }] },');
    tsLines.push('        { arrayStride: 4, attributes: [{ shaderLocation: 6, offset: 0, format: "float32" }] },');
    tsLines.push("      ],");
    tsLines.push("    },");
    tsLines.push("    fragment: {");
    tsLines.push("      module: fragmentModule,");
    tsLines.push("      entryPoint: 'main',");
    tsLines.push("      targets: [{ format }],");
    tsLines.push("    },");
    tsLines.push("    primitive: { topology: 'triangle-list', cullMode: 'none' },");
    tsLines.push("  });");
    tsLines.push("");
    tsLines.push("  const samplers: Record<string, GPUSampler> = {};");
    tsLines.push("  const textureViews: Record<string, GPUTextureView> = {};");
    if (textureBindingEntries.length > 0) {
      tsLines.push(`  for (const name of ${shaderPrefix}TextureNames) {`);
      tsLines.push('    samplers[name] = device.createSampler({ magFilter: "linear", minFilter: "linear" });');
      tsLines.push("    const placeholder = device.createTexture({ size: { width: 1, height: 1 }, format, usage: GPUTextureUsage.TEXTURE_BINDING });");
      tsLines.push("    textureViews[name] = placeholder.createView();");
      tsLines.push("  }");
    }
    tsLines.push("");
    tsLines.push("  let bindGroup = device.createBindGroup({");
    tsLines.push("    layout: bindGroupLayout,");
    tsLines.push("    entries: [");
    tsLines.push("      { binding: 0, resource: { buffer: uniformBuffer } },");
    tsLines.push("      { binding: 1, resource: { buffer: builtinsBuffer } },");
    for (const entry of textureBindingEntries) {
      tsLines.push(`      { binding: ${entry.textureBinding}, resource: textureViews['${entry.param.textureName}'] },`);
      tsLines.push(`      { binding: ${entry.samplerBinding}, resource: samplers['${entry.param.textureName}'] },`);
    }
    tsLines.push("    ],");
    tsLines.push("  });");
    tsLines.push("");
    tsLines.push("  const rebuildBindGroup = () => {");
    tsLines.push("    bindGroup = device.createBindGroup({");
    tsLines.push("      layout: bindGroupLayout,");
    tsLines.push("      entries: [");
    tsLines.push("        { binding: 0, resource: { buffer: uniformBuffer } },");
    tsLines.push("        { binding: 1, resource: { buffer: builtinsBuffer } },");
    for (const entry of textureBindingEntries) {
      tsLines.push(`        { binding: ${entry.textureBinding}, resource: textureViews['${entry.param.textureName}'] },`);
      tsLines.push(`        { binding: ${entry.samplerBinding}, resource: samplers['${entry.param.textureName}'] },`);
    }
    tsLines.push("      ],");
    tsLines.push("    });");
    tsLines.push("  };");
    tsLines.push("");
    tsLines.push("  const instance: " + materialInstanceName + " = {");
    tsLines.push("    pipeline,");
    tsLines.push("    get bindGroup() { return bindGroup; },");
    tsLines.push(`    attributeOrder: ${JSON.stringify(attributeOrder)},`);
    tsLines.push("    setUniforms: (updates) => {");
    tsLines.push("      currentUniforms = { ...currentUniforms, ...updates };");
    tsLines.push(`      pack${uniformStruct.name}(uniformFloats, uniformInts, uniformUints, 0, currentUniforms);`);
    tsLines.push("      device.queue.writeBuffer(uniformBuffer, 0, uniformData);");
    tsLines.push("    },");
    tsLines.push("    setBuiltins: (updates) => {");
    tsLines.push("      if (updates.power2d_shapeTranslate) { builtinsData[0] = updates.power2d_shapeTranslate[0]; builtinsData[1] = updates.power2d_shapeTranslate[1]; }");
    tsLines.push("      if (updates.power2d_shapeRotation !== undefined) { builtinsData[2] = updates.power2d_shapeRotation; }");
    tsLines.push("      if (updates.power2d_shapeScale) { builtinsData[4] = updates.power2d_shapeScale[0]; builtinsData[5] = updates.power2d_shapeScale[1]; }");
    tsLines.push("      if (updates.power2d_canvasWidth !== undefined) { builtinsData[6] = updates.power2d_canvasWidth; }");
    tsLines.push("      if (updates.power2d_canvasHeight !== undefined) { builtinsData[7] = updates.power2d_canvasHeight; }");
    tsLines.push("      if (updates.power2d_strokeThickness !== undefined) { builtinsData[8] = updates.power2d_strokeThickness; }");
    tsLines.push("      device.queue.writeBuffer(builtinsBuffer, 0, builtinsData);");
    tsLines.push("    },");
    tsLines.push("    setTexture: (name, texture) => {");
    tsLines.push("      textureViews[name] = 'createView' in texture ? texture.createView() : texture;");
    tsLines.push("      rebuildBindGroup();");
    tsLines.push("    },");
    tsLines.push("    setCanvasSize: (width, height) => {");
    tsLines.push("      builtinsData[6] = width;");
    tsLines.push("      builtinsData[7] = height;");
    tsLines.push("      device.queue.writeBuffer(builtinsBuffer, 0, builtinsData);");
    tsLines.push("    },");
    tsLines.push("    dispose: () => {");
    tsLines.push("      uniformBuffer.destroy();");
    tsLines.push("      builtinsBuffer.destroy();");
    tsLines.push("    },");
    tsLines.push("  };");
    tsLines.push("");
    tsLines.push("  return instance;");
    tsLines.push("}");
    tsLines.push("");
    tsLines.push(`export interface ${materialInterfaceName} extends MaterialDef<${uniformStruct.name}, ${shaderPrefix}TextureName> {}`);
    tsLines.push(`export const ${materialConstName}: ${materialInterfaceName} = {`);
    tsLines.push(`  createMaterial: create${shaderPrefix}Material,`);
    tsLines.push(`  uniformDefaults: ${uniformStruct.name}Defaults,`);
    tsLines.push(`  textureNames: ${shaderPrefix}TextureNames,`);
    tsLines.push("};");
    tsLines.push("");
    tsLines.push(`export default ${materialConstName};`);
    return { typesSource: `${tsLines.join("\n")}
` };
  }

  // packages/shader-fx-codegen/wgsl/generateFragmentShaderCore_RAW.ts
  var HEADER_COMMENT3 = "// Auto-generated by raw WGSL fragment generator. DO NOT EDIT.";
  var UNIFORM_TYPE_MAP = {
    f32: { tsType: "number" },
    i32: { tsType: "number" },
    u32: { tsType: "number" },
    bool: { tsType: "boolean" },
    vec2f: { tsType: "readonly [number, number]" },
    vec3f: { tsType: "readonly [number, number, number]" },
    vec4f: { tsType: "readonly [number, number, number, number]" },
    mat4x4f: { tsType: "Float32Array | readonly number[]" }
  };
  var PACK_TYPE_MAP = {
    f32: { componentType: "f32", valueLength: 1, slotCount: 1, defaultExpression: "0" },
    i32: { componentType: "i32", valueLength: 1, slotCount: 1, defaultExpression: "0" },
    u32: { componentType: "u32", valueLength: 1, slotCount: 1, defaultExpression: "0" },
    bool: { componentType: "bool", valueLength: 1, slotCount: 1, defaultExpression: "false" },
    vec2f: { componentType: "f32", valueLength: 2, slotCount: 2, defaultExpression: "[0, 0]" },
    vec3f: { componentType: "f32", valueLength: 3, slotCount: 4, defaultExpression: "[0, 0, 0]" },
    vec4f: { componentType: "f32", valueLength: 4, slotCount: 4, defaultExpression: "[0, 0, 0, 0]" },
    mat4x4f: { componentType: "f32", valueLength: 16, slotCount: 16, defaultExpression: "new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])" }
  };
  function packMappingFor(typeName) {
    return PACK_TYPE_MAP[typeName] ?? null;
  }
  var ARRAY_ELEMENT_TYPE_MAP = {
    f32: { tsType: "number[]" },
    i32: { tsType: "number[]" },
    u32: { tsType: "number[]" },
    vec2f: { tsType: "readonly [number, number][]" },
    vec3f: { tsType: "readonly [number, number, number][]" },
    vec4f: { tsType: "readonly [number, number, number, number][]" }
  };
  function validateUvArgument(argument) {
    const typeName = argument.type.getTypeName();
    if (typeName !== "vec2f") {
      throw new Error(`First argument must be a vec2f called uv. Received ${argument.name}: ${typeName}`);
    }
  }
  function validateTextureArgument(argument) {
    const typeName = argument.type.getTypeName();
    if (typeName !== "texture_2d<f32>") {
      throw new Error(`Texture argument must be texture_2d<f32>. Received ${argument.name}: ${typeName}`);
    }
  }
  function validateSamplerArgument(argument) {
    const typeName = argument.type.getTypeName();
    if (typeName !== "sampler") {
      throw new Error(`Sampler argument must be sampler. Received ${argument.name}: ${typeName}`);
    }
  }
  function collectUniformFields(struct, uniformArgName, shaderSource) {
    const annotationMap = extractUniformAnnotations(shaderSource, struct.name);
    return struct.members.map((member) => {
      if (member.type.isStruct) {
        throw new Error(`Uniform field ${member.name} uses unsupported type ${member.type.getTypeName()}. Nested structs are not supported.`);
      }
      const bindingName = `${uniformArgName}_${member.name}`;
      const annotations = annotationMap[member.name];
      if (member.type.isArray) {
        const elementType = member.format?.getTypeName();
        if (!elementType) {
          throw new Error(`Uniform field ${member.name} is an array but element type could not be determined.`);
        }
        if (!ARRAY_ELEMENT_TYPE_MAP[elementType]) {
          throw new Error(`Uniform array field ${member.name} uses unsupported element type ${elementType}.`);
        }
        const arraySize = member.count;
        if (!arraySize || arraySize <= 0) {
          throw new Error(`Uniform array field ${member.name} must have a fixed size.`);
        }
        return {
          name: member.name,
          bindingName,
          wgslType: member.type.getTypeName(),
          defaultExpression: annotations?.defaultExpression,
          uiMin: annotations?.uiMin,
          uiMax: annotations?.uiMax,
          uiStep: annotations?.uiStep,
          isArray: true,
          arraySize,
          elementType
        };
      }
      const typeName = member.type.getTypeName();
      if (!UNIFORM_TYPE_MAP[typeName]) {
        throw new Error(`Uniform field ${member.name} uses unsupported type ${typeName}.`);
      }
      return {
        name: member.name,
        bindingName,
        wgslType: typeName,
        defaultExpression: annotations?.defaultExpression,
        uiMin: annotations?.uiMin,
        uiMax: annotations?.uiMax,
        uiStep: annotations?.uiStep
      };
    });
  }
  function extractUniformAnnotations(source, structName) {
    const annotations = {};
    const structRegex = new RegExp(`struct\\s+${structName}\\s*\\{`, "g");
    const match = structRegex.exec(source);
    if (!match) {
      return annotations;
    }
    const braceStart = source.indexOf("{", match.index);
    if (braceStart === -1) {
      return annotations;
    }
    let depth = 0;
    let endIndex = braceStart;
    for (let i2 = braceStart; i2 < source.length; i2++) {
      const char = source[i2];
      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          endIndex = i2;
          break;
        }
      }
    }
    const body = source.slice(braceStart + 1, endIndex);
    const lines = body.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const commentIndex = line.indexOf("//");
      if (commentIndex === -1) {
        continue;
      }
      const comment = line.slice(commentIndex + 2).trim();
      if (!comment) {
        continue;
      }
      const declarationPart = line.slice(0, commentIndex).trim().replace(/,+$/, "");
      const fieldMatch = declarationPart.match(/^([A-Za-z0-9_]+)\s*:/);
      if (!fieldMatch) {
        continue;
      }
      const fieldName = fieldMatch[1];
      const annotation = parseUniformComment(comment);
      if (annotation) {
        annotations[fieldName] = annotation;
      }
    }
    return annotations;
  }
  function parseUniformComment(comment) {
    const trimmed = comment.trim();
    if (!trimmed) {
      return null;
    }
    const annotation = {};
    const defaultExpression = parseDefaultExpression(trimmed);
    if (defaultExpression !== null) {
      annotation.defaultExpression = defaultExpression;
    }
    const minMatch = trimmed.match(/(?:^|\s)min=([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    const maxMatch = trimmed.match(/(?:^|\s)max=([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    const stepMatch = trimmed.match(/(?:^|\s)step=([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    if (minMatch) {
      const value = Number(minMatch[1]);
      if (!Number.isNaN(value)) {
        annotation.uiMin = value;
      }
    }
    if (maxMatch) {
      const value = Number(maxMatch[1]);
      if (!Number.isNaN(value)) {
        annotation.uiMax = value;
      }
    }
    if (stepMatch) {
      const value = Number(stepMatch[1]);
      if (!Number.isNaN(value)) {
        annotation.uiStep = value;
      }
    }
    return Object.keys(annotation).length > 0 ? annotation : null;
  }
  function parseDefaultExpression(comment) {
    const trimmed = comment.trim();
    if (!trimmed || /^(?:min|max|step)=/i.test(trimmed)) {
      return null;
    }
    let candidate = trimmed;
    const firstChar = trimmed[0];
    if (firstChar === "[") {
      const match = trimmed.match(/^\[[^\]]*\]/);
      if (match) {
        candidate = match[0];
      }
    } else if (firstChar === "{") {
      const match = trimmed.match(/^\{[^}]*\}/);
      if (match) {
        candidate = match[0];
      }
    } else {
      const quotedMatch = trimmed.match(/^(\"[^\"]*\"|\'[^\']*\')/);
      if (quotedMatch) {
        candidate = quotedMatch[0];
      } else {
        const boolMatch = trimmed.match(/^(true|false)/i);
        if (boolMatch) {
          candidate = boolMatch[1].toLowerCase();
        } else {
          const numericMatch = trimmed.match(/^[-+]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/);
          if (numericMatch && numericMatch[0] !== "") {
            candidate = numericMatch[0];
          } else {
            const firstToken = trimmed.split(/\s+/)[0];
            candidate = firstToken;
          }
        }
      }
    }
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "boolean") {
        return parsed ? "true" : "false";
      }
      if (typeof parsed === "number") {
        return candidate;
      }
      if (typeof parsed === "string") {
        return JSON.stringify(parsed);
      }
      return candidate;
    } catch (error) {
      const lower = candidate.toLowerCase();
      if (lower === "true" || lower === "false") {
        return lower;
      }
      const numeric = Number(candidate);
      if (!Number.isNaN(numeric)) {
        return candidate;
      }
    }
    return null;
  }
  function buildUniformInterface3(struct, interfaceName) {
    const interfaceLines = [];
    const defaultsLines = [];
    interfaceLines.push(`export interface ${interfaceName} {`);
    defaultsLines.push(`export const ${interfaceName}Defaults: ${interfaceName} = {`);
    for (const member of struct.members) {
      if (member.type.isStruct) {
        throw new Error(`Uniform field ${member.name} uses unsupported struct type ${member.type.getTypeName()}.`);
      }
      if (member.type.isArray) {
        const elementType = member.format?.getTypeName();
        if (!elementType) {
          throw new Error(`Uniform array field ${member.name} element type could not be determined.`);
        }
        const arrayMeta = ARRAY_ELEMENT_TYPE_MAP[elementType];
        if (!arrayMeta) {
          throw new Error(`Uniform array field ${member.name} uses unsupported element type ${elementType}.`);
        }
        const packMeta2 = packMappingFor(elementType);
        if (!packMeta2) {
          throw new Error(`Uniform array field ${member.name} uses unsupported element type ${elementType}.`);
        }
        const count = member.count ?? 0;
        interfaceLines.push(`  ${member.name}: readonly ${arrayMeta.tsType};`);
        defaultsLines.push(`  ${member.name}: Array.from({ length: ${count} }, () => ${packMeta2.defaultExpression}),`);
        continue;
      }
      const typeName = member.type.getTypeName();
      const typeMeta = UNIFORM_TYPE_MAP[typeName];
      const packMeta = packMappingFor(typeName);
      if (!typeMeta || !packMeta) {
        throw new Error(`Uniform field ${member.name} uses unsupported type ${typeName}.`);
      }
      interfaceLines.push(`  ${member.name}: ${typeMeta.tsType};`);
      defaultsLines.push(`  ${member.name}: ${packMeta.defaultExpression},`);
    }
    interfaceLines.push("}");
    defaultsLines.push("};");
    return { interfaceLines, defaultsLines };
  }
  function buildUniformPacker3(struct) {
    const packLines = [];
    let needsInt = false;
    let needsUint = false;
    for (const member of struct.members) {
      const offsetSlots = member.offset / 4;
      if (member.type.isArray) {
        const elementType = member.format?.getTypeName();
        if (!elementType) {
          throw new Error(`Uniform array field ${member.name} element type could not be determined.`);
        }
        const mapping2 = packMappingFor(elementType);
        if (!mapping2) {
          throw new Error(`Uniform array field ${member.name} uses unsupported element type ${elementType}.`);
        }
        if (mapping2.componentType === "i32" || mapping2.componentType === "bool") {
          needsInt = true;
        }
        if (mapping2.componentType === "u32") {
          needsUint = true;
        }
        const count = member.count ?? 0;
        const strideSlots = member.size / 4 / Math.max(1, count);
        packLines.push("  {");
        packLines.push(`    const values = value.${member.name} ?? [];`);
        packLines.push(`    for (let i = 0; i < ${count}; i++) {`);
        packLines.push(`      const base = floatOffset + ${offsetSlots} + i * ${strideSlots};`);
        if (mapping2.valueLength > 1) {
          packLines.push("      const source = values[i] as any;");
          packLines.push(`      for (let c = 0; c < ${mapping2.valueLength}; c++) {`);
          packLines.push("        const component = source?.[c];");
          switch (mapping2.componentType) {
            case "f32":
              packLines.push("        floatView[base + c] = component !== undefined ? Number(component) : 0;");
              break;
            case "i32":
              packLines.push("        intView[base + c] = component !== undefined ? Math.trunc(component as number) : 0;");
              break;
            case "u32":
              packLines.push("        uintView[base + c] = component !== undefined ? Math.trunc(component as number) >>> 0 : 0;");
              break;
            case "bool":
              packLines.push("        intView[base + c] = component ? 1 : 0;");
              break;
          }
          packLines.push("      }");
          if (strideSlots > mapping2.valueLength) {
            packLines.push(`      for (let c = ${mapping2.valueLength}; c < ${strideSlots}; c++) {`);
            if (mapping2.componentType === "u32") {
              packLines.push("        uintView[base + c] = 0;");
            } else if (mapping2.componentType === "i32" || mapping2.componentType === "bool") {
              packLines.push("        intView[base + c] = 0;");
            } else {
              packLines.push("        floatView[base + c] = 0;");
            }
            packLines.push("      }");
          }
        } else {
          packLines.push("      const component = values[i];");
          switch (mapping2.componentType) {
            case "f32":
              packLines.push("      floatView[base] = component !== undefined ? Number(component) : 0;");
              break;
            case "i32":
              packLines.push("      intView[base] = component !== undefined ? Math.trunc(component as number) : 0;");
              break;
            case "u32":
              packLines.push("      uintView[base] = component !== undefined ? Math.trunc(component as number) >>> 0 : 0;");
              break;
            case "bool":
              packLines.push("      intView[base] = component ? 1 : 0;");
              break;
          }
          if (strideSlots > 1) {
            packLines.push(`      for (let c = 1; c < ${strideSlots}; c++) {`);
            if (mapping2.componentType === "u32") {
              packLines.push("        uintView[base + c] = 0;");
            } else if (mapping2.componentType === "i32" || mapping2.componentType === "bool") {
              packLines.push("        intView[base + c] = 0;");
            } else {
              packLines.push("        floatView[base + c] = 0;");
            }
            packLines.push("      }");
          }
        }
        packLines.push("    }");
        packLines.push("  }");
        continue;
      }
      const typeName = member.type.getTypeName();
      const mapping = packMappingFor(typeName);
      if (!mapping) {
        throw new Error(`Uniform field ${member.name} uses unsupported type ${typeName}.`);
      }
      if (mapping.componentType === "i32" || mapping.componentType === "bool") {
        needsInt = true;
      }
      if (mapping.componentType === "u32") {
        needsUint = true;
      }
      packLines.push("  {");
      packLines.push(`    const base = floatOffset + ${offsetSlots};`);
      if (mapping.valueLength === 1) {
        switch (mapping.componentType) {
          case "f32":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    floatView[base] = raw !== undefined ? Number(raw) : 0;");
            break;
          case "i32":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    intView[base] = raw !== undefined ? Math.trunc(raw as number) : 0;");
            break;
          case "u32":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    uintView[base] = raw !== undefined ? Math.trunc(raw as number) >>> 0 : 0;");
            break;
          case "bool":
            packLines.push(`    const raw = value.${member.name};`);
            packLines.push("    intView[base] = raw ? 1 : 0;");
            break;
        }
      } else {
        const sourceVar = `value_${member.name}`;
        packLines.push(`    const ${sourceVar} = value.${member.name} as any;`);
        packLines.push(`    for (let i = 0; i < ${mapping.valueLength}; i++) {`);
        packLines.push(`      const component = ${sourceVar}?.[i];`);
        switch (mapping.componentType) {
          case "f32":
            packLines.push("      floatView[base + i] = component !== undefined ? Number(component) : 0;");
            break;
          case "i32":
            packLines.push("      intView[base + i] = component !== undefined ? Math.trunc(component as number) : 0;");
            break;
          case "u32":
            packLines.push("      uintView[base + i] = component !== undefined ? Math.trunc(component as number) >>> 0 : 0;");
            break;
          case "bool":
            packLines.push("      intView[base + i] = component ? 1 : 0;");
            break;
        }
        packLines.push("    }");
        if (mapping.slotCount > mapping.valueLength) {
          packLines.push(`    for (let i = ${mapping.valueLength}; i < ${mapping.slotCount}; i++) {`);
          if (mapping.componentType === "u32") {
            packLines.push("      uintView[base + i] = 0;");
          } else if (mapping.componentType === "i32" || mapping.componentType === "bool") {
            packLines.push("      intView[base + i] = 0;");
          } else {
            packLines.push("      floatView[base + i] = 0;");
          }
          packLines.push("    }");
        }
      }
      packLines.push("  }");
    }
    return { packLines, needsInt, needsUint };
  }
  function buildVertexSource3(varyingName) {
    const lines = [];
    lines.push(HEADER_COMMENT3);
    lines.push("struct VertexOutput {");
    lines.push("  @builtin(position) position: vec4f,");
    lines.push(`  @location(0) ${varyingName}: vec2f,`);
    lines.push("};");
    lines.push("");
    lines.push("@vertex");
    lines.push("fn main(@builtin(vertex_index) index: u32) -> VertexOutput {");
    lines.push("  var positions = array<vec2f, 3>(");
    lines.push("    vec2f(-1.0, -1.0),");
    lines.push("    vec2f(3.0, -1.0),");
    lines.push("    vec2f(-1.0, 3.0),");
    lines.push("  );");
    lines.push("  var uvs = array<vec2f, 3>(");
    lines.push("    vec2f(0.0, 1.0),");
    lines.push("    vec2f(2.0, 1.0),");
    lines.push("    vec2f(0.0, -1.0),");
    lines.push("  );");
    lines.push("  var out: VertexOutput;");
    lines.push("  out.position = vec4f(positions[index], 0.0, 1.0);");
    lines.push(`  out.${varyingName} = uvs[index];`);
    lines.push("  return out;");
    lines.push("}");
    lines.push("");
    return `${lines.join("\n")}
`;
  }
  function buildFragmentSource3(options) {
    const {
      shaderCode,
      uniformStruct,
      textureBindings,
      passName,
      uvArgName,
      uniformArgName,
      uniformArgIsPointer,
      passArgs,
      resourceStartIndex,
      varyingName
    } = options;
    const lines = [];
    lines.push(HEADER_COMMENT3);
    lines.push(shaderCode.trimEnd());
    lines.push("");
    if (uniformStruct) {
      lines.push(`@group(0) @binding(0) var<uniform> uniforms: ${uniformStruct.name};`);
    }
    for (const entry of textureBindings) {
      lines.push(`@group(0) @binding(${entry.textureBinding}) var ${entry.param.textureName}: texture_2d<f32>;`);
      lines.push(`@group(0) @binding(${entry.samplerBinding}) var ${entry.param.samplerName}: sampler;`);
    }
    lines.push("");
    lines.push("struct FragmentInput {");
    lines.push(`  @location(0) ${varyingName}: vec2f,`);
    lines.push("};");
    lines.push("");
    lines.push("@fragment");
    lines.push("fn main(input: FragmentInput) -> @location(0) vec4f {");
    const uvLocalName = `${uvArgName}_local`;
    lines.push(`  let ${uvLocalName} = input.${varyingName};`);
    const resourceArgNames = passArgs.slice(resourceStartIndex).map((argument) => argument.name);
    const args = [uvLocalName];
    if (uniformStruct) {
      const uniformVarName = `${uniformArgName ?? "uniforms"}_value`;
      if (uniformArgIsPointer) {
        lines.push(`  var ${uniformVarName} = uniforms;`);
        args.push(`&${uniformVarName}`);
      } else {
        lines.push(`  let ${uniformVarName} = uniforms;`);
        args.push(uniformVarName);
      }
    }
    resourceArgNames.forEach((name) => {
      args.push(name);
    });
    lines.push(`  let color = ${passName}(${args.join(", ")});`);
    lines.push("  return color;");
    lines.push("}");
    lines.push("");
    return `${lines.join("\n")}
`;
  }
  function analyzeShaderSource(shaderCode, reflect, shaderBaseName) {
    const shaderPrefix = toPascalCase(shaderBaseName);
    const effectClassName = `${shaderPrefix}Effect`;
    const freeFunctions = reflect.functions.filter((fn) => !fn.stage);
    const passFunctions = freeFunctions.filter((fn) => /^pass\d+$/.test(fn.name));
    if (passFunctions.length === 0) {
      const helperNames = freeFunctions.map((fn) => fn.name).join(", ");
      const suffix = helperNames ? ` Found helper functions: ${helperNames}` : "";
      throw new Error(`No pass functions found. Expected one or more functions named pass0, pass1, ... in fragment shader.${suffix}`);
    }
    const indexedPasses = passFunctions.map((fn) => {
      const index = Number(fn.name.replace("pass", ""));
      if (!Number.isInteger(index)) {
        throw new Error(`Pass function ${fn.name} uses an invalid index.`);
      }
      return { fn, index };
    }).sort((a2, b2) => a2.index - b2.index);
    const seenIndexes = /* @__PURE__ */ new Set();
    indexedPasses.forEach(({ index }) => {
      if (seenIndexes.has(index)) {
        throw new Error(`Duplicate pass index detected for pass${index}.`);
      }
      seenIndexes.add(index);
    });
    indexedPasses.forEach(({ index }) => {
      if (index < 0) {
        throw new Error(`Pass indexes must start at 0. Received pass${index}.`);
      }
    });
    indexedPasses.forEach(({ index }, position) => {
      if (index !== position) {
        throw new Error(`Missing pass${position}. Pass functions must form a contiguous sequence starting at pass0.`);
      }
    });
    const orderedPassFunctions = indexedPasses.map(({ fn }) => fn);
    const passCount = orderedPassFunctions.length;
    orderedPassFunctions.forEach((fn) => {
      const returnType = fn.returnType?.getTypeName();
      if (returnType !== "vec4f") {
        throw new Error(`Fragment pass ${fn.name} must return vec4f. Received ${returnType ?? "void"}.`);
      }
    });
    const primaryPass = orderedPassFunctions[0];
    const primaryArgs = primaryPass.arguments;
    if (primaryArgs.length < 3) {
      throw new Error("Fragment function must include uv followed by at least one texture/sampler pair.");
    }
    const uvArg = primaryArgs[0];
    validateUvArgument(uvArg);
    const uvArgName = uvArg.name;
    let uniformStruct = null;
    let uniformFields = [];
    let uniformArgName = null;
    let uniformArgIsPointer = false;
    let resourceStartIndex = 1;
    if (primaryArgs.length >= 4) {
      const potentialUniform = primaryArgs[1];
      const typeName = potentialUniform.type.getTypeName();
      let structInfo = reflect.structs.find((entry) => entry.name === typeName);
      if (!structInfo) {
        const pointerMatch = /^&(.+)$/.exec(typeName);
        if (pointerMatch) {
          structInfo = reflect.structs.find((entry) => entry.name === pointerMatch[1]);
          if (structInfo) {
            uniformArgIsPointer = true;
          }
        }
      }
      if (structInfo) {
        uniformStruct = structInfo;
        uniformArgName = potentialUniform.name;
        uniformFields = collectUniformFields(structInfo, uniformArgName, shaderCode);
        resourceStartIndex = 2;
      }
    }
    const baseArgumentNames = primaryArgs.slice(0, resourceStartIndex).map((argument) => argument.name);
    const baseArgumentTypes = primaryArgs.slice(0, resourceStartIndex).map((argument) => argument.type.getTypeName());
    const passAnalyses = [];
    const passTextureBindings = [];
    const baseTextureParams = [];
    const baseTextureLookup = /* @__PURE__ */ new Map();
    const textureParamMap = /* @__PURE__ */ new Map();
    const analyzePassResources = (passFn, passIndex) => {
      const passArgs = passFn.arguments;
      if (passArgs.length < resourceStartIndex) {
        throw new Error(
          `${passFn.name} must declare at least ${resourceStartIndex} arguments (uv${uniformStruct ? ", uniforms" : ""}).`
        );
      }
      for (let index = 0; index < resourceStartIndex; index++) {
        const expectedName = baseArgumentNames[index];
        const expectedType = baseArgumentTypes[index];
        const argument = passArgs[index];
        if (!argument) {
          throw new Error(`Argument ${index} of ${passFn.name} must be ${expectedType} named ${expectedName}.`);
        }
        const actualType = argument.type.getTypeName();
        if (actualType !== expectedType) {
          throw new Error(`Argument ${index} of ${passFn.name} must be ${expectedType}. Received ${actualType}.`);
        }
        if (argument.name !== expectedName) {
          throw new Error(`Argument ${index} of ${passFn.name} must be named ${expectedName}. Received ${argument.name}.`);
        }
      }
      const bindings = [];
      const seenPassDependencies = /* @__PURE__ */ new Set();
      const seenTextureNames = /* @__PURE__ */ new Set();
      const extraCount = passArgs.length - resourceStartIndex;
      if (extraCount < 0 || extraCount % 2 !== 0) {
        throw new Error(`Additional arguments for ${passFn.name} must be provided in texture/sampler pairs.`);
      }
      for (let offset = 0; offset < extraCount; offset += 2) {
        const argumentIndex = resourceStartIndex + offset;
        const textureArg = passArgs[argumentIndex];
        const samplerArg = passArgs[argumentIndex + 1];
        if (!samplerArg) {
          throw new Error("Texture parameter must be followed by a sampler parameter.");
        }
        validateTextureArgument(textureArg);
        validateSamplerArgument(samplerArg);
        if (seenTextureNames.has(textureArg.name)) {
          throw new Error(`Duplicate texture parameter ${textureArg.name} detected in ${passFn.name}.`);
        }
        seenTextureNames.add(textureArg.name);
        const passDependencyMatch = /^pass(\d+)Texture$/.exec(textureArg.name);
        if (passDependencyMatch) {
          const dependencyIndex = Number(passDependencyMatch[1]);
          if (!Number.isInteger(dependencyIndex)) {
            throw new Error(`Invalid pass dependency ${textureArg.name} in ${passFn.name}.`);
          }
          if (dependencyIndex < 0 || dependencyIndex >= passIndex) {
            throw new Error(
              `Pass ${passFn.name} can only depend on earlier passes. Received dependency on pass${dependencyIndex}.`
            );
          }
          if (seenPassDependencies.has(dependencyIndex)) {
            throw new Error(`Duplicate dependency on pass${dependencyIndex} detected in ${passFn.name}.`);
          }
          seenPassDependencies.add(dependencyIndex);
          const expectedSamplerName2 = `pass${dependencyIndex}Sampler`;
          if (samplerArg.name !== expectedSamplerName2) {
            throw new Error(
              `Sampler parameter for dependency ${textureArg.name} must be named ${expectedSamplerName2}. Received ${samplerArg.name}.`
            );
          }
          bindings.push({
            textureName: textureArg.name,
            samplerName: samplerArg.name,
            source: "pass",
            passIndex: dependencyIndex
          });
          if (!textureParamMap.has(textureArg.name)) {
            textureParamMap.set(textureArg.name, {
              textureName: textureArg.name,
              samplerName: samplerArg.name
            });
          }
          continue;
        }
        const baseTexture = baseTextureLookup.get(textureArg.name);
        if (!baseTexture) {
          if (passIndex === 0) {
            const expectedSamplerName2 = `${textureArg.name}Sampler`;
            if (samplerArg.name !== expectedSamplerName2) {
              throw new Error(
                `Sampler parameter must be named ${expectedSamplerName2} to match the texture parameter ${textureArg.name}.`
              );
            }
            const param = {
              textureName: textureArg.name,
              samplerName: samplerArg.name
            };
            baseTextureParams.push(param);
            baseTextureLookup.set(textureArg.name, param);
            textureParamMap.set(textureArg.name, param);
            bindings.push({
              textureName: textureArg.name,
              samplerName: samplerArg.name,
              source: "input"
            });
          } else {
            throw new Error(
              `Pass ${passFn.name} references unknown texture ${textureArg.name}. Base textures must be declared in pass0.`
            );
          }
          continue;
        }
        const expectedSamplerName = baseTexture.samplerName;
        if (samplerArg.name !== expectedSamplerName) {
          throw new Error(
            `Sampler parameter must be named ${expectedSamplerName} to match the texture parameter ${textureArg.name}.`
          );
        }
        bindings.push({
          textureName: textureArg.name,
          samplerName: samplerArg.name,
          source: "input"
        });
      }
      return bindings;
    };
    orderedPassFunctions.forEach((passFn, passIndex) => {
      const bindings = analyzePassResources(passFn, passIndex);
      passAnalyses.push({
        index: passIndex,
        name: passFn.name,
        args: passFn.arguments,
        resourceBindings: bindings
      });
      passTextureBindings.push(bindings);
    });
    if (baseTextureParams.length === 0) {
      throw new Error("At least one texture argument is required for a pass.");
    }
    const textureParams = Array.from(textureParamMap.values());
    return {
      shaderCode,
      shaderBaseName,
      shaderPrefix,
      effectClassName,
      uvArgName,
      uniformStruct,
      uniformFields,
      uniformArgName,
      uniformArgIsPointer,
      resourceStartIndex,
      baseTextureParams,
      passAnalyses,
      passTextureBindings,
      textureParams,
      inputTextureParams: baseTextureParams,
      passCount
    };
  }
  function getFragmentShaderNaming(shaderBaseName) {
    const shaderPrefix = toPascalCase(shaderBaseName);
    return {
      shaderPrefix,
      effectClassName: `${shaderPrefix}Effect`,
      defaultUniformInterfaceName: `${shaderPrefix}Uniforms`
    };
  }
  function generateFragmentShaderArtifactsSource(options) {
    const { shaderCode, shaderBaseName, shaderFxImportPath } = options;
    const naming = getFragmentShaderNaming(shaderBaseName);
    const { shaderPrefix, effectClassName, defaultUniformInterfaceName } = naming;
    const reflect = new _t(shaderCode);
    const analysis = analyzeShaderSource(shaderCode, reflect, shaderBaseName);
    const {
      uvArgName,
      uniformStruct,
      uniformFields,
      uniformArgName,
      uniformArgIsPointer,
      resourceStartIndex,
      baseTextureParams,
      passAnalyses,
      passTextureBindings,
      textureParams,
      inputTextureParams,
      passCount
    } = analysis;
    const primaryTextureName = inputTextureParams[0]?.textureName;
    if (!primaryTextureName) {
      throw new Error("At least one texture argument is required for a pass.");
    }
    const shaderFxImports = [
      "CustomShaderEffect",
      "type ShaderSource",
      "type UniformDescriptor",
      "type MaterialHandles"
    ];
    if (uniformFields.length > 0) {
      shaderFxImports.push("type ShaderUniforms", "type Dynamic");
    }
    const varyingName = "vUV";
    const vertexSource = buildVertexSource3(varyingName);
    const hasUniforms = Boolean(uniformStruct);
    const bindingBase = hasUniforms ? 1 : 0;
    const textureBindingEntries = textureParams.map((param, index) => {
      const textureBinding = bindingBase + index * 2;
      const samplerBinding = textureBinding + 1;
      return { param, textureBinding, samplerBinding };
    });
    const fragmentSources = passAnalyses.map((passInfo) => buildFragmentSource3({
      shaderCode,
      uniformStruct,
      textureBindings: textureBindingEntries,
      passName: passInfo.name,
      uvArgName,
      uniformArgName,
      uniformArgIsPointer,
      passArgs: passInfo.args,
      resourceStartIndex,
      varyingName
    }));
    const uniformInterfaceName = uniformStruct ? uniformStruct.name.startsWith(shaderPrefix) ? uniformStruct.name : `${shaderPrefix}${uniformStruct.name}` : defaultUniformInterfaceName;
    const uniformMetaConstName = `${shaderPrefix}UniformMeta`;
    const materialHandlesName = `${shaderPrefix}MaterialHandles`;
    const materialOptionsName = `${shaderPrefix}MaterialOptions`;
    const textureNameUnion = textureParams.length ? textureParams.map((param) => `'${param.textureName}'`).join(" | ") : "never";
    const textureNamesLiteral = textureParams.length ? `[${textureParams.map((param) => `'${param.textureName}'`).join(", ")}] as const` : "[] as const";
    const inputTextureNamesArrayLiteral = `[${inputTextureParams.map((param) => `'${param.textureName}'`).join(", ")}]`;
    const tsLines = [];
    tsLines.push(HEADER_COMMENT3);
    tsLines.push(`import { ${shaderFxImports.join(", ")} } from '${shaderFxImportPath}';`);
    tsLines.push(`export const ${shaderPrefix}VertexSource = ${escapeTemplateLiteral(vertexSource)};`);
    tsLines.push(`export const ${shaderPrefix}FragmentSources = [`);
    fragmentSources.forEach((source, index) => {
      tsLines.push(`  ${escapeTemplateLiteral(source)}, // pass${index}`);
    });
    tsLines.push(`] as const;`);
    tsLines.push(`export const ${shaderPrefix}PassCount = ${passCount} as const;`);
    tsLines.push(`export const ${shaderPrefix}PrimaryTextureName = '${primaryTextureName}' as const;`);
    tsLines.push("");
    const passTextureSourceLines = [];
    passTextureSourceLines.push(`export const ${shaderPrefix}PassTextureSources = [`);
    passTextureBindings.forEach((bindings) => {
      passTextureSourceLines.push("  [");
      bindings.forEach((binding) => {
        if (binding.source === "input") {
          passTextureSourceLines.push(
            `    { binding: '${binding.textureName}', source: { kind: 'input', key: '${binding.textureName}' } },`
          );
        } else {
          passTextureSourceLines.push(
            `    { binding: '${binding.textureName}', source: { kind: 'pass', passIndex: ${binding.passIndex} } },`
          );
        }
      });
      passTextureSourceLines.push("  ],");
    });
    passTextureSourceLines.push(`] as const;`);
    passTextureSourceLines.push("");
    tsLines.push(...passTextureSourceLines);
    const uniformMetaLines = [];
    if (uniformFields.length > 0) {
      uniformMetaLines.push(`export const ${uniformMetaConstName}: UniformDescriptor[] = [`);
      uniformFields.forEach((field) => {
        uniformMetaLines.push("  {");
        uniformMetaLines.push(`    name: '${field.name}',`);
        if (field.isArray && field.elementType) {
          uniformMetaLines.push(`    kind: '${field.elementType}',`);
          uniformMetaLines.push(`    isArray: true,`);
          uniformMetaLines.push(`    arraySize: ${field.arraySize},`);
        } else {
          uniformMetaLines.push(`    kind: '${field.wgslType}',`);
        }
        uniformMetaLines.push(`    bindingName: '${field.bindingName}',`);
        if (field.defaultExpression) {
          uniformMetaLines.push(`    default: ${field.defaultExpression},`);
        }
        const uiEntries = [];
        if (field.uiMin !== void 0) {
          uiEntries.push(`min: ${field.uiMin}`);
        }
        if (field.uiMax !== void 0) {
          uiEntries.push(`max: ${field.uiMax}`);
        }
        if (field.uiStep !== void 0) {
          uiEntries.push(`step: ${field.uiStep}`);
        }
        if (uiEntries.length > 0) {
          uniformMetaLines.push(`    ui: { ${uiEntries.join(", ")} },`);
        }
        uniformMetaLines.push("  },");
      });
      uniformMetaLines.push("];");
    } else {
      uniformMetaLines.push(`export const ${uniformMetaConstName}: UniformDescriptor[] = [];`);
    }
    uniformMetaLines.push("");
    tsLines.push(...uniformMetaLines);
    if (uniformStruct) {
      const { interfaceLines, defaultsLines } = buildUniformInterface3(uniformStruct, uniformInterfaceName);
      const { packLines } = buildUniformPacker3(uniformStruct);
      tsLines.push(...interfaceLines);
      tsLines.push("");
      tsLines.push(...defaultsLines);
      tsLines.push("");
      tsLines.push(`const ${uniformStruct.name}LayoutSize = ${uniformStruct.size};`);
      tsLines.push("");
      tsLines.push(`function pack${uniformStruct.name}(floatView: Float32Array, intView: Int32Array, uintView: Uint32Array, floatOffset: number, value: ${uniformInterfaceName}): void {`);
      tsLines.push(...packLines.length ? packLines : ["  // No uniforms to pack"]);
      tsLines.push("}");
      tsLines.push("");
    } else {
      tsLines.push(`export type ${uniformInterfaceName} = Record<string, never>;`);
      tsLines.push(`export const ${uniformInterfaceName}Defaults = {};`);
      tsLines.push("");
    }
    const inputsTypeName = `${shaderPrefix}Inputs`;
    tsLines.push(`export type ${shaderPrefix}TextureName = ${textureNameUnion};`);
    tsLines.push(`export const ${shaderPrefix}TextureNames = ${textureNamesLiteral};`);
    tsLines.push(`export interface ${inputsTypeName} {`);
    inputTextureParams.forEach((param) => {
      tsLines.push(`  ${param.textureName}: ShaderSource;`);
    });
    tsLines.push("}");
    tsLines.push("");
    tsLines.push(`export type ${materialHandlesName} = MaterialHandles<${uniformInterfaceName}, ${shaderPrefix}TextureName>;`);
    tsLines.push("");
    tsLines.push(`export interface ${materialOptionsName} {`);
    tsLines.push("  name?: string;");
    tsLines.push("  passIndex?: number;");
    tsLines.push("  sampleMode?: 'nearest' | 'linear';");
    tsLines.push("}");
    tsLines.push("");
    tsLines.push(`export function create${shaderPrefix}Material(device: GPUDevice, format: GPUTextureFormat, options: ${materialOptionsName} = {}): ${materialHandlesName} {`);
    tsLines.push("  const passIndex = options.passIndex ?? 0;");
    tsLines.push(`  if (passIndex < 0 || passIndex >= ${passCount}) {`);
    tsLines.push(`    throw new Error(\`Invalid passIndex \${passIndex} for ${shaderPrefix}. Expected 0 <= passIndex < ${passCount}.\`);`);
    tsLines.push("  }");
    if (uniformStruct) {
      tsLines.push(`  const uniformData = new ArrayBuffer(${uniformStruct.name}LayoutSize);`);
      tsLines.push("  const uniformFloats = new Float32Array(uniformData);");
      tsLines.push("  const uniformInts = new Int32Array(uniformData);");
      tsLines.push("  const uniformUints = new Uint32Array(uniformData);");
      tsLines.push(`  let currentUniforms: ${uniformInterfaceName} = { ...${uniformInterfaceName}Defaults };`);
      tsLines.push(`  pack${uniformStruct.name}(uniformFloats, uniformInts, uniformUints, 0, currentUniforms);`);
      tsLines.push("  const uniformBuffer = device.createBuffer({ size: uniformData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });");
      tsLines.push("  device.queue.writeBuffer(uniformBuffer, 0, uniformData);");
      tsLines.push("");
    }
    tsLines.push("  const bindGroupLayout = device.createBindGroupLayout({ entries: [");
    if (uniformStruct) {
      tsLines.push('    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },');
    }
    for (const entry of textureBindingEntries) {
      tsLines.push(`    { binding: ${entry.textureBinding}, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },`);
      tsLines.push(`    { binding: ${entry.samplerBinding}, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },`);
    }
    tsLines.push("  ] });");
    tsLines.push("");
    tsLines.push("  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });");
    tsLines.push(`  const vertexModule = device.createShaderModule({ code: ${shaderPrefix}VertexSource });`);
    tsLines.push(`  const fragmentModule = device.createShaderModule({ code: ${shaderPrefix}FragmentSources[passIndex] });`);
    tsLines.push("");
    tsLines.push("  const pipeline = device.createRenderPipeline({");
    tsLines.push("    layout: pipelineLayout,");
    tsLines.push('    vertex: { module: vertexModule, entryPoint: "main" },');
    tsLines.push('    fragment: { module: fragmentModule, entryPoint: "main", targets: [{ format }] },');
    tsLines.push('    primitive: { topology: "triangle-list", cullMode: "none" },');
    tsLines.push("  });");
    tsLines.push("");
    tsLines.push("  const samplers: Record<string, GPUSampler> = {};");
    tsLines.push("  const textureViews: Record<string, GPUTextureView> = {};");
    if (textureBindingEntries.length > 0) {
      tsLines.push(`  for (const name of ${shaderPrefix}TextureNames) {`);
      tsLines.push('    const filter = options.sampleMode ?? "linear";');
      tsLines.push("    samplers[name] = device.createSampler({ magFilter: filter, minFilter: filter });");
      tsLines.push("    const placeholder = device.createTexture({ size: { width: 1, height: 1 }, format, usage: GPUTextureUsage.TEXTURE_BINDING });");
      tsLines.push("    textureViews[name] = placeholder.createView();");
      tsLines.push("  }");
    }
    tsLines.push("");
    tsLines.push("  let bindGroup = device.createBindGroup({");
    tsLines.push("    layout: bindGroupLayout,");
    tsLines.push("    entries: [");
    if (uniformStruct) {
      tsLines.push("      { binding: 0, resource: { buffer: uniformBuffer } },");
    }
    for (const entry of textureBindingEntries) {
      tsLines.push(`      { binding: ${entry.textureBinding}, resource: textureViews['${entry.param.textureName}'] },`);
      tsLines.push(`      { binding: ${entry.samplerBinding}, resource: samplers['${entry.param.textureName}'] },`);
    }
    tsLines.push("    ],");
    tsLines.push("  });");
    tsLines.push("");
    tsLines.push("  const rebuildBindGroup = () => {");
    tsLines.push("    bindGroup = device.createBindGroup({");
    tsLines.push("      layout: bindGroupLayout,");
    tsLines.push("      entries: [");
    if (uniformStruct) {
      tsLines.push("        { binding: 0, resource: { buffer: uniformBuffer } },");
    }
    for (const entry of textureBindingEntries) {
      tsLines.push(`        { binding: ${entry.textureBinding}, resource: textureViews['${entry.param.textureName}'] },`);
      tsLines.push(`        { binding: ${entry.samplerBinding}, resource: samplers['${entry.param.textureName}'] },`);
    }
    tsLines.push("      ],");
    tsLines.push("    });");
    tsLines.push("  };");
    tsLines.push("");
    tsLines.push(`  const handles: ${materialHandlesName} = {`);
    tsLines.push("    pipeline,");
    tsLines.push("    get bindGroup() { return bindGroup; },");
    tsLines.push("    setTexture: (name, texture) => {");
    tsLines.push("      textureViews[name] = texture;");
    tsLines.push("      rebuildBindGroup();");
    tsLines.push("    },");
    if (uniformStruct) {
      tsLines.push("    setUniforms: (updates) => {");
      tsLines.push("      currentUniforms = { ...currentUniforms, ...updates };");
      tsLines.push(`      pack${uniformStruct.name}(uniformFloats, uniformInts, uniformUints, 0, currentUniforms);`);
      tsLines.push("      device.queue.writeBuffer(uniformBuffer, 0, uniformData);");
      tsLines.push("    },");
    } else {
      tsLines.push("    setUniforms: () => {},");
    }
    tsLines.push("  };");
    tsLines.push("");
    tsLines.push("  return handles;");
    tsLines.push("}");
    tsLines.push("");
    const effectLines = [];
    effectLines.push(`export class ${effectClassName} extends CustomShaderEffect<${uniformInterfaceName}, ${inputsTypeName}> {`);
    effectLines.push(`  override effectName = '${shaderPrefix}';`);
    effectLines.push("");
    effectLines.push(`  constructor(device: GPUDevice, inputs: ${inputsTypeName}, width = 1280, height = 720, format: GPUTextureFormat = 'rgba16float', clearColor: GPUColor = { r: 0, g: 0, b: 0, a: 1 }, sampleMode: 'nearest' | 'linear' = 'linear') {`);
    effectLines.push("    super(device, inputs, {");
    effectLines.push(`      factory: (deviceRef, formatRef, options) => create${shaderPrefix}Material(deviceRef, formatRef, { ...options, sampleMode }),`);
    effectLines.push(`      textureInputKeys: ${inputTextureNamesArrayLiteral},`);
    effectLines.push(`      textureBindingKeys: ${shaderPrefix}TextureNames,`);
    effectLines.push(`      passTextureSources: ${shaderPrefix}PassTextureSources,`);
    effectLines.push(`      passCount: ${passCount},`);
    effectLines.push(`      primaryTextureKey: '${primaryTextureName}',`);
    effectLines.push("      width,");
    effectLines.push("      height,");
    effectLines.push("      format,");
    effectLines.push("      clearColor,");
    effectLines.push(`      uniformMeta: ${uniformMetaConstName},`);
    effectLines.push("    });");
    const fieldsWithDefaults = uniformFields.filter((field) => field.defaultExpression);
    if (fieldsWithDefaults.length > 0) {
      effectLines.push("    this.setUniforms({");
      fieldsWithDefaults.forEach((field) => {
        effectLines.push(`      ${field.name}: ${field.defaultExpression},`);
      });
      effectLines.push("    });");
    } else {
      const uniformNames = new Set(uniformFields.map((field) => field.name));
      const hasTransformDefaults = ["rotate", "anchor", "translate", "scale"].every((name) => uniformNames.has(name));
      if (hasTransformDefaults) {
        effectLines.push("    this.setUniforms({ rotate: 0, anchor: [0.5, 0.5], translate: [0, 0], scale: [1, 1] });");
      }
    }
    effectLines.push("  }");
    if (uniformFields.length > 0) {
      const uniformParams = uniformFields.map((field) => {
        if (field.isArray && field.elementType) {
          const arrayMeta = ARRAY_ELEMENT_TYPE_MAP[field.elementType];
          return `${field.name}?: Dynamic<${arrayMeta.tsType}>`;
        }
        const meta = UNIFORM_TYPE_MAP[field.wgslType];
        return `${field.name}?: Dynamic<${meta.tsType}>`;
      }).join(", ");
      effectLines.push("");
      effectLines.push(`  override setUniforms(uniforms: { ${uniformParams} }): void {`);
      effectLines.push("    const record: ShaderUniforms = {};");
      uniformFields.forEach((field) => {
        effectLines.push(`    if (uniforms.${field.name} !== undefined) {`);
        effectLines.push(`      record['${field.name}'] = uniforms.${field.name};`);
        effectLines.push("    }");
      });
      effectLines.push("    super.setUniforms(record);");
      effectLines.push("  }");
    }
    effectLines.push("}");
    effectLines.push("");
    tsLines.push(...effectLines);
    const typesSource = `${tsLines.join("\n")}
`;
    return {
      typesSource,
      shaderPrefix,
      effectClassName,
      uniformInterfaceName
    };
  }

  // packages/compute-shader-codegen/wgsl/generateComputeShaderTypesCore_RAW.ts
  var HEADER_COMMENT4 = "// Auto-generated by raw WGSL compute generator. DO NOT EDIT.";
  function floatVectorMapping(componentCount, slotCount) {
    const requiredSlots = slotCount ?? componentCount;
    return {
      tsType: "Float32Array | readonly number[]",
      slotCount: requiredSlots,
      valueLength: componentCount,
      defaultExpression: `new Float32Array(${requiredSlots})`,
      componentType: "f32",
      isVector: true
    };
  }
  function intVectorMapping(componentCount, slotCount, unsigned) {
    const arrayCtor = unsigned ? "Uint32Array" : "Int32Array";
    const valueType = unsigned ? "Uint32Array | readonly number[]" : "Int32Array | readonly number[]";
    return {
      tsType: valueType,
      slotCount,
      valueLength: componentCount,
      defaultExpression: `new ${arrayCtor}(${slotCount})`,
      componentType: unsigned ? "u32" : "i32",
      isVector: true
    };
  }
  var TYPE_MAP3 = {
    f32: { tsType: "number", slotCount: 1, valueLength: 1, defaultExpression: "0", componentType: "f32", isVector: false },
    i32: { tsType: "number", slotCount: 1, valueLength: 1, defaultExpression: "0", componentType: "i32", isVector: false },
    u32: { tsType: "number", slotCount: 1, valueLength: 1, defaultExpression: "0", componentType: "u32", isVector: false },
    bool: { tsType: "boolean", slotCount: 1, valueLength: 1, defaultExpression: "false", componentType: "bool", isVector: false },
    vec2f: floatVectorMapping(2),
    vec3f: floatVectorMapping(3, 4),
    vec4f: floatVectorMapping(4),
    mat4x4f: floatVectorMapping(16),
    vec2i: intVectorMapping(2, 2, false),
    vec3i: intVectorMapping(3, 4, false),
    vec4i: intVectorMapping(4, 4, false),
    vec2u: intVectorMapping(2, 2, true),
    vec3u: intVectorMapping(3, 4, true),
    vec4u: intVectorMapping(4, 4, true)
  };
  function indent(lines, spaces = 2) {
    const pad = " ".repeat(spaces);
    return lines.map((line) => line.length > 0 ? pad + line : line).join("\n");
  }
  function mappingFor3(type) {
    const name = type.getTypeName();
    if (TYPE_MAP3[name]) {
      return TYPE_MAP3[name];
    }
    if (type.isTemplate && type.format) {
      const templateName = type.name;
      const format = type.format;
      if (templateName === "atomic") {
        return mappingFor3(format);
      }
      const formatKey = format.getTypeName();
      if (templateName.startsWith("vec")) {
        const key = `${templateName}${formatKey[0]}`;
        if (TYPE_MAP3[key]) {
          return TYPE_MAP3[key];
        }
      }
    }
    return null;
  }
  function generateStructBlock(prefix, descriptor, structMap) {
    const { struct, interfaceName, layoutName, packFn } = descriptor;
    const interfaceLines = struct.members.map((member) => {
      const mapping = mappingFor3(member.type);
      const tsType = mapping ? mapping.tsType : member.type.isStruct ? `${prefix}${member.type.getTypeName()}` : "number";
      return `${member.name}: ${tsType};`;
    });
    const layoutMembers = struct.members.map((member) => {
      const mapping = mappingFor3(member.type);
      const slot = mapping ? mapping.slotCount : member.size / 4;
      return `  { name: '${member.name}', offset: ${member.offset}, size: ${member.size}, slot: ${slot} }`;
    });
    let needsIntView = false;
    let needsUintView = false;
    const packLines = [];
    struct.members.forEach((member) => {
      const mapping = mappingFor3(member.type);
      const memberOffset = member.offset / 4;
      if (mapping) {
        if (mapping.componentType === "i32" || mapping.componentType === "bool") {
          needsIntView = true;
        }
        if (mapping.componentType === "u32") {
          needsUintView = true;
        }
        const baseDecl = `const base = floatOffset + ${memberOffset};`;
        packLines.push("{");
        packLines.push(`  ${baseDecl}`);
        if (!mapping.isVector) {
          switch (mapping.componentType) {
            case "f32":
              packLines.push(`  const raw = value.${member.name};`);
              packLines.push("  target[base] = raw !== undefined ? Number(raw) : 0;");
              break;
            case "i32":
              packLines.push(`  const raw = value.${member.name};`);
              packLines.push("  intView[base] = raw !== undefined ? Math.trunc(raw as number) : 0;");
              break;
            case "u32":
              packLines.push(`  const raw = value.${member.name};`);
              packLines.push("  uintView[base] = raw !== undefined ? Math.trunc(raw as number) >>> 0 : 0;");
              break;
            case "bool":
              packLines.push(`  const raw = value.${member.name};`);
              packLines.push("  intView[base] = raw ? 1 : 0;");
              break;
          }
        } else {
          const sourceVar = `${member.name}Source`;
          packLines.push(`  const ${sourceVar} = value.${member.name} as any;`);
          packLines.push(`  for (let i = 0; i < ${mapping.valueLength}; i++) {`);
          packLines.push(`    const component = ${sourceVar}?.[i];`);
          switch (mapping.componentType) {
            case "f32":
              packLines.push("    target[base + i] = component !== undefined ? Number(component) : 0;");
              break;
            case "i32":
              packLines.push("    intView[base + i] = component !== undefined ? Math.trunc(component as number) : 0;");
              break;
            case "u32":
              packLines.push("    uintView[base + i] = component !== undefined ? Math.trunc(component as number) >>> 0 : 0;");
              break;
            case "bool":
              packLines.push("    intView[base + i] = component ? 1 : 0;");
              break;
          }
          packLines.push("  }");
          if (mapping.slotCount > mapping.valueLength) {
            const padStart = mapping.valueLength;
            packLines.push(`  for (let i = ${padStart}; i < ${mapping.slotCount}; i++) {`);
            if (mapping.componentType === "u32") {
              packLines.push("    uintView[base + i] = 0;");
            } else if (mapping.componentType === "i32" || mapping.componentType === "bool") {
              packLines.push("    intView[base + i] = 0;");
            } else {
              packLines.push("    target[base + i] = 0;");
            }
            packLines.push("  }");
          }
        }
        packLines.push("}");
      } else if (member.type.isStruct) {
        const nested = structMap.get(member.type.getTypeName());
        if (nested) {
          packLines.push("{");
          packLines.push(`  ${nested.packFn}(target, floatOffset + ${memberOffset}, value.${member.name});`);
          packLines.push("}");
        } else {
          packLines.push(`// ${member.name}: struct type ${member.type.getTypeName()} not recognized`);
        }
      } else {
        packLines.push(`// ${member.name}: unsupported type`);
      }
    });
    const preamble = [];
    if (needsIntView) {
      preamble.push("const intView = new Int32Array(target.buffer);");
    }
    if (needsUintView) {
      preamble.push("const uintView = new Uint32Array(target.buffer);");
    }
    return [
      `export interface ${interfaceName} {`,
      indent(interfaceLines),
      "}",
      "",
      `export const ${layoutName} = {`,
      `  size: ${struct.size},`,
      `  align: ${struct.align},`,
      "  members: [",
      layoutMembers.join(",\n"),
      "  ] as const,",
      "} as const;",
      "",
      `export function ${packFn}(target: Float32Array, floatOffset: number, value: ${interfaceName}): void {`,
      indent([...preamble, ...packLines].length ? [...preamble, ...packLines] : ["// No supported members"]),
      "}"
    ].join("\n");
  }
  function generateUniformBlock(descriptor, structDescriptor) {
    const { interfaceName, stateName, layoutName, createFn, updateFn } = descriptor;
    const structMembers = structDescriptor?.struct.members ?? [];
    const layoutArray = structMembers.map((member) => {
      const mapping = mappingFor3(member.type);
      const slot = mapping ? mapping.slotCount : member.size / 4;
      return `  { name: '${member.name}', slot: ${slot} }`;
    });
    const defaultAssignments = structMembers.map((member) => {
      const mapping = mappingFor3(member.type);
      const defaultExpr = mapping ? mapping.defaultExpression : "0";
      return `  ${member.name}: ${defaultExpr},`;
    });
    const structSize = structDescriptor?.struct.size ?? 0;
    const alignedSize = Math.max(16, Math.ceil(structSize / 16) * 16);
    const createBody = [];
    createBody.push(`const data = new ArrayBuffer(${alignedSize});`);
    createBody.push("const floatView = new Float32Array(data);");
    if (defaultAssignments.length > 0) {
      createBody.push(`let uniforms: ${interfaceName} = {`);
      createBody.push(...defaultAssignments);
      createBody.push("};");
    } else {
      createBody.push(`let uniforms: ${interfaceName} = {} as ${interfaceName};`);
    }
    createBody.push("if (initial) {");
    createBody.push("  uniforms = { ...uniforms, ...initial };");
    createBody.push("}");
    if (structMembers.length > 0 && structDescriptor) {
      createBody.push(`${structDescriptor.packFn}(floatView, 0, uniforms);`);
    }
    createBody.push("const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });");
    createBody.push("device.queue.writeBuffer(buffer, 0, data);");
    createBody.push("return { device, buffer, data, floatView, uniforms };");
    const updateBody = [];
    updateBody.push("if (!updates) {");
    updateBody.push("  return;");
    updateBody.push("}");
    updateBody.push("state.uniforms = { ...state.uniforms, ...updates };");
    if (structMembers.length > 0 && structDescriptor) {
      updateBody.push(`${structDescriptor.packFn}(state.floatView, 0, state.uniforms);`);
    }
    updateBody.push("state.device.queue.writeBuffer(state.buffer, 0, state.data);");
    const interfaceLines = structMembers.map((member) => {
      const mapping = mappingFor3(member.type);
      const tsType = mapping ? mapping.tsType : "number";
      return `${member.name}: ${tsType};`;
    });
    return [
      `const ${layoutName} = [`,
      layoutArray.join(",\n"),
      "] as const;",
      "",
      `export interface ${interfaceName} {`,
      indent(interfaceLines),
      "}",
      "",
      `export interface ${stateName} {`,
      "  device: GPUDevice;",
      "  buffer: GPUBuffer;",
      "  data: ArrayBuffer;",
      "  floatView: Float32Array;",
      `  uniforms: ${interfaceName};`,
      "}",
      "",
      `export function ${createFn}(device: GPUDevice, initial?: Partial<${interfaceName}>): ${stateName} {`,
      indent(createBody),
      "}",
      "",
      `export function ${updateFn}(state: ${stateName}, updates: Partial<${interfaceName}>): void {`,
      indent(updateBody),
      "}"
    ].join("\n");
  }
  function generateStorageBlock(descriptor, structDescriptor) {
    const { stateName, createFn, updateFn, writeFn, valueType } = descriptor;
    const byteStrideValue = structDescriptor ? structDescriptor.struct.size : descriptor.variable.stride || 0;
    const createBody = [];
    createBody.push(`const byteStride = ${byteStrideValue};`);
    createBody.push("const floatsPerElement = byteStride / Float32Array.BYTES_PER_ELEMENT;");
    createBody.push("const totalFloats = floatsPerElement * capacity;");
    createBody.push("const data = new Float32Array(totalFloats);");
    createBody.push("const usage = options?.usage ?? (GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);");
    createBody.push("const buffer = device.createBuffer({ size: byteStride * capacity, usage });");
    createBody.push("if (options?.initial) {");
    if (structDescriptor) {
      createBody.push("  options.initial.slice(0, capacity).forEach((value, index) => {");
      createBody.push(`    ${structDescriptor.packFn}(data, index * floatsPerElement, value);`);
      createBody.push("  });");
    } else {
      createBody.push("  data.set(options.initial.flat().slice(0, totalFloats));");
    }
    createBody.push("  const dataView = data.buffer instanceof ArrayBuffer");
    createBody.push("    ? new Float32Array(data.buffer, data.byteOffset, data.length)");
    createBody.push("    : new Float32Array(data);");
    createBody.push("  device.queue.writeBuffer(buffer, 0, dataView);");
    createBody.push("}");
    createBody.push("return { device, buffer, data, capacity, floatsPerElement };");
    const writeBody = [];
    if (structDescriptor) {
      writeBody.push("const offset = index * state.floatsPerElement;");
      writeBody.push(`${structDescriptor.packFn}(state.data, offset, value);`);
    } else {
      writeBody.push("const offset = index * state.floatsPerElement;");
      writeBody.push("for (let i = 0; i < state.floatsPerElement; i++) {");
      writeBody.push("  state.data[offset + i] = value[i] ?? 0;");
      writeBody.push("}");
    }
    return [
      `export interface ${stateName} {`,
      "  device: GPUDevice;",
      "  buffer: GPUBuffer;",
      "  data: Float32Array;",
      "  capacity: number;",
      "  floatsPerElement: number;",
      "}",
      "",
      `export function ${createFn}(device: GPUDevice, capacity: number, options?: { initial?: ${valueType}[]; usage?: GPUBufferUsageFlags; }): ${stateName} {`,
      indent(createBody),
      "}",
      "",
      `export function ${writeFn}(state: ${stateName}, index: number, value: ${valueType}): void {`,
      indent(writeBody),
      "}",
      "",
      `export function ${updateFn}(state: ${stateName}): void {`,
      indent([
        "const dataView = state.data.buffer instanceof ArrayBuffer",
        "  ? new Float32Array(state.data.buffer, state.data.byteOffset, state.data.length)",
        "  : new Float32Array(state.data);",
        "state.device.queue.writeBuffer(state.buffer, 0, dataView);"
      ]),
      "}"
    ].join("\n");
  }
  function classify(variable) {
    switch (variable.resourceType) {
      case i.Uniform:
        return "uniform";
      case i.Storage:
        return "storage";
      case i.Texture:
        return "texture";
      case i.Sampler:
        return "sampler";
      case i.StorageTexture:
        return "storageTexture";
      default:
        return "storage";
    }
  }
  function normalizeAccess(access) {
    return String(access ?? "").replace(/[-_]/g, "").toLowerCase();
  }
  function storageBufferType(access) {
    const normalized = normalizeAccess(access);
    return normalized === "read" || normalized === "readonly" ? "read-only-storage" : "storage";
  }
  function textureViewDimension(typeName) {
    const multisampled = typeName.includes("multisampled");
    if (typeName.includes("1d")) {
      return { viewDimension: "1d", multisampled };
    }
    if (typeName.includes("2d_array")) {
      return { viewDimension: "2d-array", multisampled };
    }
    if (typeName.includes("3d")) {
      return { viewDimension: "3d", multisampled };
    }
    if (typeName.includes("cube_array")) {
      return { viewDimension: "cube-array", multisampled };
    }
    if (typeName.includes("cube")) {
      return { viewDimension: "cube", multisampled };
    }
    return { viewDimension: "2d", multisampled };
  }
  function textureSampleType(typeName) {
    if (typeName.startsWith("texture_depth")) {
      return "depth";
    }
    const match = typeName.match(/<\\s*(f32|i32|u32)\\s*>/);
    if (!match) {
      return "float";
    }
    switch (match[1]) {
      case "i32":
        return "sint";
      case "u32":
        return "uint";
      default:
        return "float";
    }
  }
  function storageTextureInfo(typeName) {
    const formatMatch = typeName.match(/<\\s*([^,>\\s]+)\\s*,\\s*([^>\\s]+)\\s*>/);
    const format = formatMatch?.[1] ?? "rgba8unorm";
    const accessRaw = normalizeAccess(formatMatch?.[2]);
    let access = "write-only";
    if (accessRaw === "read") {
      access = "read-only";
    } else if (accessRaw === "readwrite") {
      access = "read-write";
    }
    const { viewDimension } = textureViewDimension(typeName);
    return { format, access, viewDimension };
  }
  function samplerBindingType(typeName) {
    if (typeName.includes("comparison")) {
      return "comparison";
    }
    return "filtering";
  }
  function generateShaderFactory(shaderIdentifier, shaderSourceRef, bindings, uniforms) {
    const mappingEntries = bindings.map(
      (entry) => `    ${entry.variable.name}: { group: ${entry.variable.group ?? 0}, binding: ${entry.variable.binding ?? 0} }`
    );
    const interfaceLines = bindings.map((entry) => {
      if (entry.kind === "uniform") {
        const uniform = uniforms.find((u2) => u2.variable === entry.variable);
        return `  ${entry.variable.name}: ${uniform ? uniform.stateName : "GPUBuffer"};`;
      }
      return `  ${entry.variable.name}: ${entry.typeRef};`;
    });
    const groups = /* @__PURE__ */ new Map();
    bindings.forEach((entry) => {
      const group = entry.variable.group ?? 0;
      const list = groups.get(group) ?? [];
      list.push({ variable: entry.variable, kind: entry.kind });
      groups.set(group, list);
    });
    const groupIndices = Array.from(groups.keys()).sort((a2, b2) => a2 - b2);
    const maxGroup = groupIndices.length ? Math.max(...groupIndices) : 0;
    const groupLayoutLines = [];
    const groupBindLines = [];
    groupIndices.forEach((group) => {
      const entries = [...groups.get(group) ?? []].sort((a2, b2) => (a2.variable.binding ?? 0) - (b2.variable.binding ?? 0));
      const layoutLines = [];
      const bindLines = [];
      entries.forEach((entry) => {
        const binding = entry.variable.binding ?? 0;
        const typeName = entry.variable.type.getTypeName();
        switch (entry.kind) {
          case "uniform":
            layoutLines.push(`{ binding: ${binding}, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },`);
            bindLines.push(`{ binding: ${binding}, resource: { buffer: bindings.${entry.variable.name}.buffer } },`);
            break;
          case "storage": {
            const bufferType = storageBufferType(entry.variable);
            layoutLines.push(`{ binding: ${binding}, visibility: GPUShaderStage.COMPUTE, buffer: { type: '${bufferType}' } },`);
            bindLines.push(`{ binding: ${binding}, resource: { buffer: bindings.${entry.variable.name} } },`);
            break;
          }
          case "texture": {
            const { viewDimension, multisampled } = textureViewDimension(typeName);
            const sampleType = textureSampleType(typeName);
            layoutLines.push(`{ binding: ${binding}, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: '${sampleType}', viewDimension: '${viewDimension}', multisampled: ${multisampled} } },`);
            bindLines.push(`{ binding: ${binding}, resource: bindings.${entry.variable.name} },`);
            break;
          }
          case "sampler": {
            const samplerType = samplerBindingType(typeName);
            layoutLines.push(`{ binding: ${binding}, visibility: GPUShaderStage.COMPUTE, sampler: { type: '${samplerType}' } },`);
            bindLines.push(`{ binding: ${binding}, resource: bindings.${entry.variable.name} },`);
            break;
          }
          case "storageTexture": {
            const info = storageTextureInfo(typeName);
            layoutLines.push(`{ binding: ${binding}, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: '${info.access}', format: '${info.format}', viewDimension: '${info.viewDimension}' } },`);
            bindLines.push(`{ binding: ${binding}, resource: bindings.${entry.variable.name} },`);
            break;
          }
          default:
            break;
        }
      });
      if (layoutLines.length) {
        groupLayoutLines.push(`bindGroupLayouts[${group}] = device.createBindGroupLayout({ entries: [`);
        groupLayoutLines.push(...layoutLines.map((line) => `  ${line}`));
        groupLayoutLines.push("] });");
      } else {
        groupLayoutLines.push(`bindGroupLayouts[${group}] = device.createBindGroupLayout({ entries: [] });`);
      }
      if (bindLines.length) {
        groupBindLines.push(`groups[${group}] = device.createBindGroup({`);
        groupBindLines.push(`  layout: bindGroupLayouts[${group}],`);
        groupBindLines.push("  entries: [");
        groupBindLines.push(...bindLines.map((line) => `    ${line}`));
        groupBindLines.push("  ],");
        groupBindLines.push("});");
      }
    });
    const updateLines = [];
    bindings.forEach((entry) => {
      const name = entry.variable.name;
      updateLines.push(`if (updates.${name} !== undefined) {`);
      updateLines.push(`  state.bindings.${name} = updates.${name}!;`);
      updateLines.push("  dirty = true;");
      updateLines.push("}");
    });
    const bindingInterfaceName = "ShaderBindings";
    const stateInterfaceName = "ShaderState";
    const createFunctionName = "createShader";
    const updateFunctionName = "updateBindings";
    return [
      "const bindingLayout = {",
      mappingEntries.join(",\n"),
      "};",
      "",
      `export interface ${bindingInterfaceName} {`,
      indent(interfaceLines),
      "}",
      "",
      `export interface ${stateInterfaceName} {`,
      "  device: GPUDevice;",
      "  pipeline: GPUComputePipeline;",
      "  bindGroupLayouts: GPUBindGroupLayout[];",
      "  bindGroups: GPUBindGroup[];",
      `  bindings: ${bindingInterfaceName};`,
      "}",
      "",
      `function buildBindGroups(device: GPUDevice, bindGroupLayouts: GPUBindGroupLayout[], bindings: ${bindingInterfaceName}): GPUBindGroup[] {`,
      indent([
        "const groups: GPUBindGroup[] = [];",
        ...groupBindLines,
        "for (let i = 0; i < bindGroupLayouts.length; i++) {",
        "  if (!groups[i]) {",
        "    groups[i] = device.createBindGroup({ layout: bindGroupLayouts[i], entries: [] });",
        "  }",
        "}",
        "return groups;"
      ]),
      "}",
      "",
      `export function ${createFunctionName}(device: GPUDevice, bindings: ${bindingInterfaceName}, options?: { entryPoint?: string; source?: string; label?: string; }): ${stateInterfaceName} {`,
      indent([
        "const bindGroupLayouts: GPUBindGroupLayout[] = [];",
        ...groupLayoutLines,
        `for (let i = 0; i <= ${maxGroup}; i++) {`,
        "  if (!bindGroupLayouts[i]) {",
        "    bindGroupLayouts[i] = device.createBindGroupLayout({ entries: [] });",
        "  }",
        "}",
        `const label = options?.label ?? '${shaderIdentifier}';`,
        `const shaderModule = device.createShaderModule({ label, code: options?.source ?? ${shaderSourceRef} });`,
        "const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts });",
        "const pipeline = device.createComputePipeline({ label, layout: pipelineLayout, compute: { module: shaderModule, entryPoint: options?.entryPoint ?? 'main' } });",
        "const bindGroups = buildBindGroups(device, bindGroupLayouts, bindings);",
        "return { device, pipeline, bindGroupLayouts, bindGroups, bindings };"
      ]),
      "}",
      "",
      `export function ${updateFunctionName}(state: ${stateInterfaceName}, updates: Partial<${bindingInterfaceName}>): void {`,
      indent([
        "let dirty = false;",
        ...updateLines.length ? updateLines : ["// Nothing to update"],
        "if (!dirty) {",
        "  return;",
        "}",
        "state.bindGroups = buildBindGroups(state.device, state.bindGroupLayouts, state.bindings);"
      ]),
      "}"
    ].join("\n");
  }
  function generateComputeShaderTypesSource(options) {
    const { shaderCode, shaderStem } = options;
    const reflect = new _t(shaderCode);
    const sanitizedBaseName = shaderStem.replace(/\.compute$/i, "");
    const shaderPrefix = toPascalCase(sanitizedBaseName);
    const usedStructs = reflect.structs.filter((s2) => s2.inUse);
    const structDescriptors = usedStructs.map((struct) => ({
      struct,
      interfaceName: `${shaderPrefix}${struct.name}`,
      layoutName: `${shaderPrefix}${struct.name}Layout`,
      packFn: `pack${shaderPrefix}${struct.name}`
    }));
    const structDescriptorMap = /* @__PURE__ */ new Map();
    structDescriptors.forEach((descriptor) => {
      structDescriptorMap.set(descriptor.struct.name, descriptor);
    });
    const structBlocks = structDescriptors.map((descriptor) => generateStructBlock(shaderPrefix, descriptor, structDescriptorMap));
    const uniformDescriptors = reflect.uniforms.map((variable) => {
      const pascalName = toPascalCase(variable.name);
      return {
        variable,
        interfaceName: `${pascalName}Uniforms`,
        stateName: `${pascalName}UniformState`,
        layoutName: `uniformLayout_${variable.name}`,
        createFn: `createUniformBuffer_${variable.name}`,
        updateFn: `updateUniformBuffer_${variable.name}`,
        aliasCreate: void 0,
        aliasUpdate: void 0
      };
    });
    if (uniformDescriptors.length === 1) {
      uniformDescriptors[0].aliasCreate = "createUniformBuffer";
      uniformDescriptors[0].aliasUpdate = "updateUniformBuffer";
    }
    const uniformBlocks = uniformDescriptors.map((descriptor) => {
      const struct = structDescriptors.find((entry) => entry.struct.name === descriptor.variable.type.getTypeName());
      return generateUniformBlock(descriptor, struct);
    });
    const storageDescriptors = reflect.storage.map((variable) => {
      const pascalName = toPascalCase(variable.name);
      const struct = structDescriptors.find((entry) => entry.struct.name === variable.format?.getTypeName());
      const valueType = struct ? struct.interfaceName : "number[]";
      return {
        variable,
        stateName: `${pascalName}StorageState`,
        layoutName: struct ? struct.layoutName : `storageLayout_${variable.name}`,
        createFn: `createStorageBuffer_${variable.name}`,
        updateFn: `updateStorageBuffer_${variable.name}`,
        writeFn: `writeStorageValue_${variable.name}`,
        valueType
      };
    });
    const storageBlocks = storageDescriptors.map((descriptor) => {
      const struct = structDescriptors.find((entry) => entry.struct.name === descriptor.variable.format?.getTypeName());
      return generateStorageBlock(descriptor, struct);
    });
    const sampledTextureVariables = reflect.textures.filter((variable) => variable.resourceType === i.Texture);
    const storageTextureVariablesReflect = reflect.textures.filter((variable) => variable.resourceType === i.StorageTexture);
    const textureDescriptors = sampledTextureVariables.map((variable) => ({
      variable,
      kind: classify(variable),
      typeRef: "GPUTextureView"
    }));
    const samplerDescriptors = reflect.samplers.map((variable) => ({
      variable,
      kind: classify(variable),
      typeRef: "GPUSampler"
    }));
    const storageTextureDescriptors = storageTextureVariablesReflect.map((variable) => ({
      variable,
      kind: classify(variable),
      typeRef: "GPUTextureView"
    }));
    const shaderBindings = [
      ...reflect.uniforms.map((variable) => ({
        variable,
        kind: classify(variable),
        typeRef: "GPUBuffer"
      })),
      ...reflect.storage.map((variable) => ({
        variable,
        kind: classify(variable),
        typeRef: "GPUBuffer"
      })),
      ...textureDescriptors,
      ...samplerDescriptors,
      ...storageTextureDescriptors
    ];
    const shaderFactory = generateShaderFactory(
      sanitizedBaseName,
      `${shaderPrefix}Source`,
      shaderBindings,
      uniformDescriptors
    );
    const aliasLines = uniformDescriptors.filter((descriptor) => descriptor.aliasCreate && descriptor.aliasUpdate).map(
      (descriptor) => [`export const ${descriptor.aliasCreate} = ${descriptor.createFn};`, `export const ${descriptor.aliasUpdate} = ${descriptor.updateFn};`].join("\n")
    );
    const fileSections = [
      HEADER_COMMENT4,
      `export const ${shaderPrefix}Source = ${escapeTemplateLiteral(shaderCode.trimEnd())};`,
      "",
      ...structBlocks,
      structBlocks.length ? "" : "",
      ...uniformBlocks,
      uniformBlocks.length ? "" : "",
      ...storageBlocks,
      storageBlocks.length ? "" : "",
      shaderFactory,
      aliasLines.join("\n")
    ].filter((section) => section !== "");
    const typesSource = fileSections.join("\n\n");
    return { typesSource, shaderPrefix };
  }

  // tools/td-sketch-build/codegen.ts
  function generate(path, source) {
    const name = path.split("/").at(-1);
    if (name.endsWith(".strokeMaterial.wgsl")) return { suffix: ".strokeMaterial.raw.generated.ts", code: generateStrokeMaterialTypesSource(source, name.replace(".strokeMaterial.wgsl", "")).typesSource };
    if (name.endsWith(".material.wgsl")) return { suffix: ".material.raw.generated.ts", code: generateMaterialTypesSource(source, name.replace(".material.wgsl", "")).typesSource };
    if (name.endsWith(".fragFunc.wgsl")) return { suffix: ".frag.raw.generated.ts", code: generateFragmentShaderArtifactsSource({ shaderCode: source, shaderBaseName: name.replace(".fragFunc.wgsl", ""), shaderFxImportPath: "@avtools/shader-fx/raw" }).typesSource };
    if (name.endsWith(".compute.wgsl")) return { suffix: ".compute.raw.generated.ts", code: generateComputeShaderTypesSource({ shaderCode: source, shaderFileName: name, shaderStem: name.replace(/\.wgsl$/, "") }).typesSource };
  }
  return __toCommonJS(codegen_exports);
})();
