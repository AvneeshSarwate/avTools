"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
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
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/alea.js
  var require_alea = __commonJS({
    "node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/alea.js"(exports, module) {
      (function(global, module2, define2) {
        function Alea(seed) {
          var me = this, mash = Mash();
          me.next = function() {
            var t = 2091639 * me.s0 + me.c * 23283064365386963e-26;
            me.s0 = me.s1;
            me.s1 = me.s2;
            return me.s2 = t - (me.c = t | 0);
          };
          me.c = 1;
          me.s0 = mash(" ");
          me.s1 = mash(" ");
          me.s2 = mash(" ");
          me.s0 -= mash(seed);
          if (me.s0 < 0) {
            me.s0 += 1;
          }
          me.s1 -= mash(seed);
          if (me.s1 < 0) {
            me.s1 += 1;
          }
          me.s2 -= mash(seed);
          if (me.s2 < 0) {
            me.s2 += 1;
          }
          mash = null;
        }
        function copy(f, t) {
          t.c = f.c;
          t.s0 = f.s0;
          t.s1 = f.s1;
          t.s2 = f.s2;
          return t;
        }
        function impl(seed, opts) {
          var xg = new Alea(seed), state = opts && opts.state, prng = xg.next;
          prng.int32 = function() {
            return xg.next() * 4294967296 | 0;
          };
          prng.double = function() {
            return prng() + (prng() * 2097152 | 0) * 11102230246251565e-32;
          };
          prng.quick = prng;
          if (state) {
            if (typeof state == "object") copy(state, xg);
            prng.state = function() {
              return copy(xg, {});
            };
          }
          return prng;
        }
        function Mash() {
          var n = 4022871197;
          var mash = function(data) {
            data = String(data);
            for (var i = 0; i < data.length; i++) {
              n += data.charCodeAt(i);
              var h = 0.02519603282416938 * n;
              n = h >>> 0;
              h -= n;
              h *= n;
              n = h >>> 0;
              h -= n;
              n += h * 4294967296;
            }
            return (n >>> 0) * 23283064365386963e-26;
          };
          return mash;
        }
        if (module2 && module2.exports) {
          module2.exports = impl;
        } else if (define2 && define2.amd) {
          define2(function() {
            return impl;
          });
        } else {
          this.alea = impl;
        }
      })(
        exports,
        typeof module == "object" && module,
        // present in node.js
        typeof define == "function" && define
        // present with an AMD loader
      );
    }
  });

  // node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xor128.js
  var require_xor128 = __commonJS({
    "node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xor128.js"(exports, module) {
      (function(global, module2, define2) {
        function XorGen(seed) {
          var me = this, strseed = "";
          me.x = 0;
          me.y = 0;
          me.z = 0;
          me.w = 0;
          me.next = function() {
            var t = me.x ^ me.x << 11;
            me.x = me.y;
            me.y = me.z;
            me.z = me.w;
            return me.w ^= me.w >>> 19 ^ t ^ t >>> 8;
          };
          if (seed === (seed | 0)) {
            me.x = seed;
          } else {
            strseed += seed;
          }
          for (var k = 0; k < strseed.length + 64; k++) {
            me.x ^= strseed.charCodeAt(k) | 0;
            me.next();
          }
        }
        function copy(f, t) {
          t.x = f.x;
          t.y = f.y;
          t.z = f.z;
          t.w = f.w;
          return t;
        }
        function impl(seed, opts) {
          var xg = new XorGen(seed), state = opts && opts.state, prng = function() {
            return (xg.next() >>> 0) / 4294967296;
          };
          prng.double = function() {
            do {
              var top = xg.next() >>> 11, bot = (xg.next() >>> 0) / 4294967296, result = (top + bot) / (1 << 21);
            } while (result === 0);
            return result;
          };
          prng.int32 = xg.next;
          prng.quick = prng;
          if (state) {
            if (typeof state == "object") copy(state, xg);
            prng.state = function() {
              return copy(xg, {});
            };
          }
          return prng;
        }
        if (module2 && module2.exports) {
          module2.exports = impl;
        } else if (define2 && define2.amd) {
          define2(function() {
            return impl;
          });
        } else {
          this.xor128 = impl;
        }
      })(
        exports,
        typeof module == "object" && module,
        // present in node.js
        typeof define == "function" && define
        // present with an AMD loader
      );
    }
  });

  // node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xorwow.js
  var require_xorwow = __commonJS({
    "node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xorwow.js"(exports, module) {
      (function(global, module2, define2) {
        function XorGen(seed) {
          var me = this, strseed = "";
          me.next = function() {
            var t = me.x ^ me.x >>> 2;
            me.x = me.y;
            me.y = me.z;
            me.z = me.w;
            me.w = me.v;
            return (me.d = me.d + 362437 | 0) + (me.v = me.v ^ me.v << 4 ^ (t ^ t << 1)) | 0;
          };
          me.x = 0;
          me.y = 0;
          me.z = 0;
          me.w = 0;
          me.v = 0;
          if (seed === (seed | 0)) {
            me.x = seed;
          } else {
            strseed += seed;
          }
          for (var k = 0; k < strseed.length + 64; k++) {
            me.x ^= strseed.charCodeAt(k) | 0;
            if (k == strseed.length) {
              me.d = me.x << 10 ^ me.x >>> 4;
            }
            me.next();
          }
        }
        function copy(f, t) {
          t.x = f.x;
          t.y = f.y;
          t.z = f.z;
          t.w = f.w;
          t.v = f.v;
          t.d = f.d;
          return t;
        }
        function impl(seed, opts) {
          var xg = new XorGen(seed), state = opts && opts.state, prng = function() {
            return (xg.next() >>> 0) / 4294967296;
          };
          prng.double = function() {
            do {
              var top = xg.next() >>> 11, bot = (xg.next() >>> 0) / 4294967296, result = (top + bot) / (1 << 21);
            } while (result === 0);
            return result;
          };
          prng.int32 = xg.next;
          prng.quick = prng;
          if (state) {
            if (typeof state == "object") copy(state, xg);
            prng.state = function() {
              return copy(xg, {});
            };
          }
          return prng;
        }
        if (module2 && module2.exports) {
          module2.exports = impl;
        } else if (define2 && define2.amd) {
          define2(function() {
            return impl;
          });
        } else {
          this.xorwow = impl;
        }
      })(
        exports,
        typeof module == "object" && module,
        // present in node.js
        typeof define == "function" && define
        // present with an AMD loader
      );
    }
  });

  // node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xorshift7.js
  var require_xorshift7 = __commonJS({
    "node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xorshift7.js"(exports, module) {
      (function(global, module2, define2) {
        function XorGen(seed) {
          var me = this;
          me.next = function() {
            var X = me.x, i = me.i, t, v, w;
            t = X[i];
            t ^= t >>> 7;
            v = t ^ t << 24;
            t = X[i + 1 & 7];
            v ^= t ^ t >>> 10;
            t = X[i + 3 & 7];
            v ^= t ^ t >>> 3;
            t = X[i + 4 & 7];
            v ^= t ^ t << 7;
            t = X[i + 7 & 7];
            t = t ^ t << 13;
            v ^= t ^ t << 9;
            X[i] = v;
            me.i = i + 1 & 7;
            return v;
          };
          function init(me2, seed2) {
            var j, w, X = [];
            if (seed2 === (seed2 | 0)) {
              w = X[0] = seed2;
            } else {
              seed2 = "" + seed2;
              for (j = 0; j < seed2.length; ++j) {
                X[j & 7] = X[j & 7] << 15 ^ seed2.charCodeAt(j) + X[j + 1 & 7] << 13;
              }
            }
            while (X.length < 8) X.push(0);
            for (j = 0; j < 8 && X[j] === 0; ++j) ;
            if (j == 8) w = X[7] = -1;
            else w = X[j];
            me2.x = X;
            me2.i = 0;
            for (j = 256; j > 0; --j) {
              me2.next();
            }
          }
          init(me, seed);
        }
        function copy(f, t) {
          t.x = f.x.slice();
          t.i = f.i;
          return t;
        }
        function impl(seed, opts) {
          if (seed == null) seed = +/* @__PURE__ */ new Date();
          var xg = new XorGen(seed), state = opts && opts.state, prng = function() {
            return (xg.next() >>> 0) / 4294967296;
          };
          prng.double = function() {
            do {
              var top = xg.next() >>> 11, bot = (xg.next() >>> 0) / 4294967296, result = (top + bot) / (1 << 21);
            } while (result === 0);
            return result;
          };
          prng.int32 = xg.next;
          prng.quick = prng;
          if (state) {
            if (state.x) copy(state, xg);
            prng.state = function() {
              return copy(xg, {});
            };
          }
          return prng;
        }
        if (module2 && module2.exports) {
          module2.exports = impl;
        } else if (define2 && define2.amd) {
          define2(function() {
            return impl;
          });
        } else {
          this.xorshift7 = impl;
        }
      })(
        exports,
        typeof module == "object" && module,
        // present in node.js
        typeof define == "function" && define
        // present with an AMD loader
      );
    }
  });

  // node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xor4096.js
  var require_xor4096 = __commonJS({
    "node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xor4096.js"(exports, module) {
      (function(global, module2, define2) {
        function XorGen(seed) {
          var me = this;
          me.next = function() {
            var w = me.w, X = me.X, i = me.i, t, v;
            me.w = w = w + 1640531527 | 0;
            v = X[i + 34 & 127];
            t = X[i = i + 1 & 127];
            v ^= v << 13;
            t ^= t << 17;
            v ^= v >>> 15;
            t ^= t >>> 12;
            v = X[i] = v ^ t;
            me.i = i;
            return v + (w ^ w >>> 16) | 0;
          };
          function init(me2, seed2) {
            var t, v, i, j, w, X = [], limit = 128;
            if (seed2 === (seed2 | 0)) {
              v = seed2;
              seed2 = null;
            } else {
              seed2 = seed2 + "\0";
              v = 0;
              limit = Math.max(limit, seed2.length);
            }
            for (i = 0, j = -32; j < limit; ++j) {
              if (seed2) v ^= seed2.charCodeAt((j + 32) % seed2.length);
              if (j === 0) w = v;
              v ^= v << 10;
              v ^= v >>> 15;
              v ^= v << 4;
              v ^= v >>> 13;
              if (j >= 0) {
                w = w + 1640531527 | 0;
                t = X[j & 127] ^= v + w;
                i = 0 == t ? i + 1 : 0;
              }
            }
            if (i >= 128) {
              X[(seed2 && seed2.length || 0) & 127] = -1;
            }
            i = 127;
            for (j = 4 * 128; j > 0; --j) {
              v = X[i + 34 & 127];
              t = X[i = i + 1 & 127];
              v ^= v << 13;
              t ^= t << 17;
              v ^= v >>> 15;
              t ^= t >>> 12;
              X[i] = v ^ t;
            }
            me2.w = w;
            me2.X = X;
            me2.i = i;
          }
          init(me, seed);
        }
        function copy(f, t) {
          t.i = f.i;
          t.w = f.w;
          t.X = f.X.slice();
          return t;
        }
        ;
        function impl(seed, opts) {
          if (seed == null) seed = +/* @__PURE__ */ new Date();
          var xg = new XorGen(seed), state = opts && opts.state, prng = function() {
            return (xg.next() >>> 0) / 4294967296;
          };
          prng.double = function() {
            do {
              var top = xg.next() >>> 11, bot = (xg.next() >>> 0) / 4294967296, result = (top + bot) / (1 << 21);
            } while (result === 0);
            return result;
          };
          prng.int32 = xg.next;
          prng.quick = prng;
          if (state) {
            if (state.X) copy(state, xg);
            prng.state = function() {
              return copy(xg, {});
            };
          }
          return prng;
        }
        if (module2 && module2.exports) {
          module2.exports = impl;
        } else if (define2 && define2.amd) {
          define2(function() {
            return impl;
          });
        } else {
          this.xor4096 = impl;
        }
      })(
        exports,
        // window object or global
        typeof module == "object" && module,
        // present in node.js
        typeof define == "function" && define
        // present with an AMD loader
      );
    }
  });

  // node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/tychei.js
  var require_tychei = __commonJS({
    "node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/tychei.js"(exports, module) {
      (function(global, module2, define2) {
        function XorGen(seed) {
          var me = this, strseed = "";
          me.next = function() {
            var b = me.b, c = me.c, d = me.d, a = me.a;
            b = b << 25 ^ b >>> 7 ^ c;
            c = c - d | 0;
            d = d << 24 ^ d >>> 8 ^ a;
            a = a - b | 0;
            me.b = b = b << 20 ^ b >>> 12 ^ c;
            me.c = c = c - d | 0;
            me.d = d << 16 ^ c >>> 16 ^ a;
            return me.a = a - b | 0;
          };
          me.a = 0;
          me.b = 0;
          me.c = 2654435769 | 0;
          me.d = 1367130551;
          if (seed === Math.floor(seed)) {
            me.a = seed / 4294967296 | 0;
            me.b = seed | 0;
          } else {
            strseed += seed;
          }
          for (var k = 0; k < strseed.length + 20; k++) {
            me.b ^= strseed.charCodeAt(k) | 0;
            me.next();
          }
        }
        function copy(f, t) {
          t.a = f.a;
          t.b = f.b;
          t.c = f.c;
          t.d = f.d;
          return t;
        }
        ;
        function impl(seed, opts) {
          var xg = new XorGen(seed), state = opts && opts.state, prng = function() {
            return (xg.next() >>> 0) / 4294967296;
          };
          prng.double = function() {
            do {
              var top = xg.next() >>> 11, bot = (xg.next() >>> 0) / 4294967296, result = (top + bot) / (1 << 21);
            } while (result === 0);
            return result;
          };
          prng.int32 = xg.next;
          prng.quick = prng;
          if (state) {
            if (typeof state == "object") copy(state, xg);
            prng.state = function() {
              return copy(xg, {});
            };
          }
          return prng;
        }
        if (module2 && module2.exports) {
          module2.exports = impl;
        } else if (define2 && define2.amd) {
          define2(function() {
            return impl;
          });
        } else {
          this.tychei = impl;
        }
      })(
        exports,
        typeof module == "object" && module,
        // present in node.js
        typeof define == "function" && define
        // present with an AMD loader
      );
    }
  });

  // node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/seedrandom.js
  var require_seedrandom = __commonJS({
    "node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/seedrandom.js"(exports, module) {
      (function(global, pool, math) {
        var width = 256, chunks = 6, digits = 52, rngname = "random", startdenom = math.pow(width, chunks), significance = math.pow(2, digits), overflow = significance * 2, mask = width - 1, nodecrypto;
        function seedrandom2(seed, options, callback) {
          var key = [];
          options = options == true ? { entropy: true } : options || {};
          var shortseed = mixkey(flatten(
            options.entropy ? [seed, tostring(pool)] : seed == null ? autoseed() : seed,
            3
          ), key);
          var arc4 = new ARC4(key);
          var prng = function() {
            var n = arc4.g(chunks), d = startdenom, x = 0;
            while (n < significance) {
              n = (n + x) * width;
              d *= width;
              x = arc4.g(1);
            }
            while (n >= overflow) {
              n /= 2;
              d /= 2;
              x >>>= 1;
            }
            return (n + x) / d;
          };
          prng.int32 = function() {
            return arc4.g(4) | 0;
          };
          prng.quick = function() {
            return arc4.g(4) / 4294967296;
          };
          prng.double = prng;
          mixkey(tostring(arc4.S), pool);
          return (options.pass || callback || function(prng2, seed2, is_math_call, state) {
            if (state) {
              if (state.S) {
                copy(state, arc4);
              }
              prng2.state = function() {
                return copy(arc4, {});
              };
            }
            if (is_math_call) {
              math[rngname] = prng2;
              return seed2;
            } else return prng2;
          })(
            prng,
            shortseed,
            "global" in options ? options.global : this == math,
            options.state
          );
        }
        function ARC4(key) {
          var t, keylen = key.length, me = this, i = 0, j = me.i = me.j = 0, s = me.S = [];
          if (!keylen) {
            key = [keylen++];
          }
          while (i < width) {
            s[i] = i++;
          }
          for (i = 0; i < width; i++) {
            s[i] = s[j = mask & j + key[i % keylen] + (t = s[i])];
            s[j] = t;
          }
          (me.g = function(count) {
            var t2, r = 0, i2 = me.i, j2 = me.j, s2 = me.S;
            while (count--) {
              t2 = s2[i2 = mask & i2 + 1];
              r = r * width + s2[mask & (s2[i2] = s2[j2 = mask & j2 + t2]) + (s2[j2] = t2)];
            }
            me.i = i2;
            me.j = j2;
            return r;
          })(width);
        }
        function copy(f, t) {
          t.i = f.i;
          t.j = f.j;
          t.S = f.S.slice();
          return t;
        }
        ;
        function flatten(obj, depth) {
          var result = [], typ = typeof obj, prop;
          if (depth && typ == "object") {
            for (prop in obj) {
              try {
                result.push(flatten(obj[prop], depth - 1));
              } catch (e) {
              }
            }
          }
          return result.length ? result : typ == "string" ? obj : obj + "\0";
        }
        function mixkey(seed, key) {
          var stringseed = seed + "", smear, j = 0;
          while (j < stringseed.length) {
            key[mask & j] = mask & (smear ^= key[mask & j] * 19) + stringseed.charCodeAt(j++);
          }
          return tostring(key);
        }
        function autoseed() {
          try {
            var out;
            if (nodecrypto && (out = nodecrypto.randomBytes)) {
              out = out(width);
            } else {
              out = new Uint8Array(width);
              (global.crypto || global.msCrypto).getRandomValues(out);
            }
            return tostring(out);
          } catch (e) {
            var browser = global.navigator, plugins = browser && browser.plugins;
            return [+/* @__PURE__ */ new Date(), global, plugins, global.screen, tostring(pool)];
          }
        }
        function tostring(a) {
          return String.fromCharCode.apply(0, a);
        }
        mixkey(math.random(), pool);
        if (typeof module == "object" && module.exports) {
          module.exports = seedrandom2;
          try {
            nodecrypto = __require("crypto");
          } catch (ex) {
          }
        } else if (typeof define == "function" && define.amd) {
          define(function() {
            return seedrandom2;
          });
        } else {
          math["seed" + rngname] = seedrandom2;
        }
      })(
        // global: `self` in browsers (including strict mode and web workers),
        // otherwise `this` in Node and other environments
        typeof self !== "undefined" ? self : exports,
        [],
        // pool: entropy pool starts empty
        Math
        // math: package containing random, pow, and seedrandom
      );
    }
  });

  // node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/index.js
  var require_seedrandom2 = __commonJS({
    "node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/index.js"(exports, module) {
      var alea = require_alea();
      var xor128 = require_xor128();
      var xorwow = require_xorwow();
      var xorshift7 = require_xorshift7();
      var xor4096 = require_xor4096();
      var tychei = require_tychei();
      var sr = require_seedrandom();
      sr.alea = alea;
      sr.xor128 = xor128;
      sr.xorwow = xorwow;
      sr.xorshift7 = xorshift7;
      sr.xor4096 = xor4096;
      sr.tychei = tychei;
      module.exports = sr;
    }
  });

  // packages/core-timing/mod.ts
  var mod_exports = {};
  __export(mod_exports, {
    BrowserTimeContext: () => BrowserTimeContext,
    CancelablePromiseProxy: () => CancelablePromiseProxy,
    DateTimeContext: () => DateTimeContext,
    MAX_ZERO_ADVANCE_SLICES: () => MAX_ZERO_ADVANCE_SLICES,
    OfflineRunner: () => OfflineRunner,
    OfflineTimeContext: () => OfflineTimeContext,
    PriorityQueue: () => PriorityQueue,
    TempoMap: () => TempoMap,
    TimeContext: () => TimeContext,
    TimeScheduler: () => TimeScheduler,
    awaitBarrier: () => awaitBarrier,
    cancelAllContexts: () => cancelAllContexts,
    createAndLaunchContext: () => createAndLaunchContext,
    launch: () => launch,
    launchBrowser: () => launchBrowser,
    resolveBarrier: () => resolveBarrier,
    startBarrier: () => startBarrier,
    wallNow: () => wallNow
  });

  // packages/core-timing/priority_queue.ts
  var PriorityQueue = class {
    heap = [];
    idToIndex = /* @__PURE__ */ new Map();
    logWarnings = false;
    add(id, deadline, metadata) {
      if (this.idToIndex.has(id)) {
        if (this.logWarnings) {
          console.warn(`Item with id "${id}" already exists in queue`);
        }
        return;
      }
      const item = { id, deadline, metadata };
      this.heap.push(item);
      const index = this.heap.length - 1;
      this.idToIndex.set(id, index);
      this.heapifyUp(index);
    }
    peek() {
      return this.heap.length > 0 ? this.heap[0] : null;
    }
    pop() {
      if (this.heap.length === 0) return null;
      const result = this.heap[0];
      this.idToIndex.delete(result.id);
      if (this.heap.length === 1) {
        this.heap.pop();
        return result;
      }
      const lastItem = this.heap.pop();
      this.heap[0] = lastItem;
      this.idToIndex.set(lastItem.id, 0);
      this.heapifyDown(0);
      return result;
    }
    remove(id) {
      const index = this.idToIndex.get(id);
      if (index === void 0) {
        if (this.logWarnings) {
          console.warn(`Item with id "${id}" not found in queue`);
        }
        return false;
      }
      this.idToIndex.delete(id);
      if (index === this.heap.length - 1) {
        this.heap.pop();
        return true;
      }
      const lastItem = this.heap.pop();
      this.heap[index] = lastItem;
      this.idToIndex.set(lastItem.id, index);
      const parentIndex = Math.floor((index - 1) / 2);
      if (index > 0 && this.heap[index].deadline < this.heap[parentIndex].deadline) {
        this.heapifyUp(index);
      } else {
        this.heapifyDown(index);
      }
      return true;
    }
    adjustDeadline(id, newDeadline) {
      const index = this.idToIndex.get(id);
      if (index === void 0) {
        if (this.logWarnings) {
          console.warn(`Item with id "${id}" not found in queue`);
        }
        return false;
      }
      const oldDeadline = this.heap[index].deadline;
      this.heap[index].deadline = newDeadline;
      if (newDeadline < oldDeadline) {
        this.heapifyUp(index);
      } else if (newDeadline > oldDeadline) {
        this.heapifyDown(index);
      }
      return true;
    }
    getData(id) {
      const index = this.idToIndex.get(id);
      if (index === void 0) {
        if (this.logWarnings) {
          console.warn(`Item with id "${id}" not found in queue`);
        }
        return null;
      }
      return this.heap[index].metadata;
    }
    size() {
      return this.heap.length;
    }
    isEmpty() {
      return this.heap.length === 0;
    }
    heapifyUp(index) {
      while (index > 0) {
        const parentIndex = Math.floor((index - 1) / 2);
        if (this.heap[index].deadline >= this.heap[parentIndex].deadline) break;
        this.swap(index, parentIndex);
        index = parentIndex;
      }
    }
    heapifyDown(index) {
      while (true) {
        let smallest = index;
        const leftChild = 2 * index + 1;
        const rightChild = 2 * index + 2;
        if (leftChild < this.heap.length && this.heap[leftChild].deadline < this.heap[smallest].deadline) {
          smallest = leftChild;
        }
        if (rightChild < this.heap.length && this.heap[rightChild].deadline < this.heap[smallest].deadline) {
          smallest = rightChild;
        }
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    swap(i, j) {
      [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
      this.idToIndex.set(this.heap[i].id, i);
      this.idToIndex.set(this.heap[j].id, j);
    }
  };

  // packages/core-timing/seedrandom_shim.ts
  var import_seedrandom = __toESM(require_seedrandom2());
  var seedrandom_shim_default = import_seedrandom.default;

  // packages/core-timing/offline_time_context.ts
  var MAX_ZERO_ADVANCE_SLICES = 1e4;
  function zeroAdvanceStallError(t) {
    return new Error(
      `Logical time stalled at t=${t}: more than ${MAX_ZERO_ADVANCE_SLICES} consecutive zero-advance timeslices (wait(0) hot loop?); rejecting stalled waits`
    );
  }
  var DEFAULT_SET_TIMEOUT = (callback, ms) => globalThis.setTimeout(callback, ms);
  var DEFAULT_CLEAR_TIMEOUT = (id) => {
    globalThis.clearTimeout(id);
  };
  function normalizeSeed(seed) {
    if (seed === void 0 || seed === null) return crypto.randomUUID();
    return typeof seed === "string" ? seed : String(seed);
  }
  function deriveSeed(parentSeed, forkIndex) {
    return `${parentSeed}::fork:${forkIndex}`;
  }
  var createYieldToMacrotask = (setTimeoutFn) => {
    const g3 = globalThis;
    if (typeof g3.setImmediate === "function") {
      const setImmediateFn = g3.setImmediate;
      return () => new Promise((res) => setImmediateFn(res));
    }
    if (typeof MessageChannel !== "undefined") {
      const mc = new MessageChannel();
      const q = [];
      mc.port1.onmessage = () => {
        const fn = q.shift();
        if (fn) fn();
      };
      mc.port1.start?.();
      return () => new Promise((res) => {
        q.push(res);
        mc.port2.postMessage(0);
      });
    }
    return () => new Promise((res) => setTimeoutFn(res, 0));
  };
  var createScheduleMacrotask = (setTimeoutFn) => {
    const g3 = globalThis;
    if (typeof g3.setImmediate === "function") {
      const setImmediateFn = g3.setImmediate;
      return (cb) => setImmediateFn(cb);
    }
    if (typeof MessageChannel !== "undefined") {
      const mc = new MessageChannel();
      const q = [];
      mc.port1.onmessage = () => {
        const fn = q.shift();
        if (fn) fn();
      };
      mc.port1.start?.();
      return (cb) => {
        q.push(cb);
        mc.port2.postMessage(0);
      };
    }
    return (cb) => setTimeoutFn(cb, 0);
  };
  var wallStart = performance.now() / 1e3;
  var wallNow = () => performance.now() / 1e3 - wallStart;
  var CancelablePromiseProxy = class {
    abortController;
    timeContext;
    // Consumers (then/catch/finally) await this deferred rather than the raw
    // block promise, so cancelSafe(value) can settle the join with a value
    // even though the underlying block will later reject on cancellation.
    // First settle wins. The pre-attached no-op catch marks the deferred as
    // handled so an unawaited proxy whose block rejects on cancel does not
    // emit a process-fatal unhandled rejection in Deno.
    // Typed as unknown internally so CancelablePromiseProxy stays covariant in
    // T (a typed resolve parameter would make instantiations non-assignable to
    // CancelablePromiseProxy<unknown>, which TimeContext.cancelPromise uses).
    settledResolve;
    settledReject;
    settled;
    blockPromise;
    constructor(ab) {
      this.abortController = ab;
      this.settled = new Promise((resolve, reject) => {
        this.settledResolve = resolve;
        this.settledReject = reject;
      });
      this.settled.catch(() => {
      });
    }
    /** The raw block promise. Assigning it wires the deferred consumers await. */
    get promise() {
      return this.blockPromise;
    }
    set promise(blockPromise) {
      this.blockPromise = blockPromise;
      blockPromise?.then(
        (value) => this.settledResolve(value),
        (reason) => this.settledReject(reason)
      );
    }
    cancel() {
      this.abortController.abort();
      this.timeContext?.cancel();
    }
    /**
     * Graceful cancel: settle the awaited join with `value`, then cancel the
     * context subtree. A parent awaiting a branchWait proxy receives `value`
     * instead of a cancellation rejection ("yield with an arg"). For
     * CancelablePromiseProxy<void>, call with no argument. Plain cancel()
     * remains the hard path that rejects the awaiting parent.
     */
    cancelSafe(value) {
      this.settledResolve(value);
      this.cancel();
    }
    /**
     * Register a handler that runs when this task is canceled (AbortController aborts).
     * Returns an unsubscribe function. If already canceled, the handler fires immediately.
     */
    handleCancel(onCancel) {
      if (!onCancel) return () => {
      };
      const signal = this.abortController.signal;
      let called = false;
      const wrapped = () => {
        if (called) return;
        called = true;
        signal.removeEventListener("abort", wrapped);
        onCancel();
      };
      if (signal.aborted) {
        wrapped();
        return () => {
        };
      }
      signal.addEventListener("abort", wrapped);
      return () => signal.removeEventListener("abort", wrapped);
    }
    [Symbol.toStringTag] = "[object CancelablePromiseProxy]";
    then(onfulfilled, onrejected) {
      return this.settled.then(onfulfilled, onrejected);
    }
    catch(onrejected) {
      return this.settled.catch(onrejected);
    }
    finally(onfinally) {
      return this.settled.finally(onfinally);
    }
  };
  function clampPos(x) {
    return Number.isFinite(x) && x > 0 ? x : 1;
  }
  var TempoMap = class _TempoMap {
    static MAX_HISTORICAL_SEGMENTS = 16;
    id;
    version = 0;
    segs;
    constructor(initialBpm = 60) {
      const bpm = clampPos(initialBpm);
      this.id = crypto.randomUUID();
      this.segs = [{
        t0: 0,
        t1: Infinity,
        bpm0: bpm,
        bpm1: bpm,
        beats0: 0,
        beats1: Infinity
      }];
    }
    clone() {
      const t = new _TempoMap(60);
      t.id = crypto.randomUUID();
      t.segs = this.segs.map((s) => ({ ...s }));
      t.version = this.version;
      return t;
    }
    bpmAtTime(t) {
      const s = this.segmentAtTime(t);
      if (!s) return this.segs[this.segs.length - 1].bpm1;
      if (!Number.isFinite(s.t1) || s.t1 === s.t0) return s.bpm0;
      const a = (t - s.t0) / (s.t1 - s.t0);
      return s.bpm0 + (s.bpm1 - s.bpm0) * a;
    }
    beatsAtTime(t) {
      const s = this.segmentAtTime(t);
      if (!s) {
        return 0;
      }
      const dt = Math.max(0, t - s.t0);
      const L = s.t1 - s.t0;
      const k = Number.isFinite(L) && L > 0 ? (s.bpm1 - s.bpm0) / L : 0;
      return s.beats0 + (s.bpm0 * dt + 0.5 * k * dt * dt) / 60;
    }
    timeAtBeats(targetBeats) {
      if (!Number.isFinite(targetBeats)) return Infinity;
      if (targetBeats <= 0) return 0;
      let lo = 0;
      let hi = this.segs.length - 1;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        const b1 = this.segs[mid].beats1;
        if (b1 >= targetBeats) hi = mid;
        else lo = mid + 1;
      }
      const s = this.segs[lo];
      const beatsDelta = targetBeats - s.beats0;
      if (beatsDelta <= 0) return s.t0;
      const L = s.t1 - s.t0;
      const k = Number.isFinite(L) && L > 0 ? (s.bpm1 - s.bpm0) / L : 0;
      if (Math.abs(k) < 1e-12) {
        const bpm = clampPos(s.bpm0);
        return s.t0 + beatsDelta * 60 / bpm;
      }
      const bpm0 = s.bpm0;
      const C = beatsDelta * 60;
      const disc = bpm0 * bpm0 + 2 * k * C;
      const sqrtDisc = Math.sqrt(Math.max(0, disc));
      const dt = (-bpm0 + sqrtDisc) / k;
      return s.t0 + Math.max(0, dt);
    }
    /** Public API: set BPM "now" (time argument intentionally not exposed). */
    _setBpmAtTime(bpm, t) {
      const newBpm = clampPos(bpm);
      const time = Math.max(0, t);
      const { bpmAtT, beatsAtT, segIndex } = this.splitAt(time);
      this.segs = this.segs.slice(0, segIndex + 1);
      const s = this.segs[this.segs.length - 1];
      s.t1 = time;
      s.bpm1 = bpmAtT;
      s.beats1 = beatsAtT;
      this.segs.push({
        t0: time,
        t1: Infinity,
        bpm0: newBpm,
        bpm1: newBpm,
        beats0: beatsAtT,
        beats1: Infinity
      });
      this.compactHistoryBefore(time);
      this.version++;
    }
    /** Optional: smooth-ish ramp. (Not required by your current constraints, but useful.) */
    _rampToBpmAtTime(targetBpm, durSec, t) {
      const endBpm = clampPos(targetBpm);
      const time = Math.max(0, t);
      const dur = Math.max(0, durSec);
      if (dur <= 0) {
        this._setBpmAtTime(endBpm, time);
        return;
      }
      const { bpmAtT, beatsAtT, segIndex } = this.splitAt(time);
      this.segs = this.segs.slice(0, segIndex + 1);
      const s = this.segs[this.segs.length - 1];
      s.t1 = time;
      s.bpm1 = bpmAtT;
      s.beats1 = beatsAtT;
      const t1 = time + dur;
      const k = (endBpm - bpmAtT) / dur;
      const beats1 = beatsAtT + (bpmAtT * dur + 0.5 * k * dur * dur) / 60;
      this.segs.push({
        t0: time,
        t1,
        bpm0: bpmAtT,
        bpm1: endBpm,
        beats0: beatsAtT,
        beats1
      });
      this.segs.push({
        t0: t1,
        t1: Infinity,
        bpm0: endBpm,
        bpm1: endBpm,
        beats0: beats1,
        beats1: Infinity
      });
      this.compactHistoryBefore(time);
      this.version++;
    }
    segmentAtTime(t) {
      if (t <= 0) return this.segs[0];
      let lo = 0;
      let hi = this.segs.length - 1;
      while (lo < hi) {
        const mid = lo + hi + 1 >> 1;
        if (this.segs[mid].t0 <= t) lo = mid;
        else hi = mid - 1;
      }
      return this.segs[lo] ?? null;
    }
    /** Split the active segment at time t (conceptually), returning bpm/beats at t and segment index. */
    splitAt(t) {
      const time = Math.max(0, t);
      const s = this.segmentAtTime(time);
      const segIndex = this.segs.indexOf(s);
      const beatsAtT = this.beatsAtTime(time);
      const bpmAtT = this.bpmAtTime(time);
      return { bpmAtT, beatsAtT, segIndex };
    }
    /**
     * Bounds unbounded tempo-segment growth by merging all segments before a boundary
     * into a single averaged constant-bpm segment. This preserves beatsAtTime exactly
     * at t=0 and at t>=boundaryTime, but for times STRICTLY INSIDE the merged region
     * beatsAtTime returns a linear approximation of the true (piecewise) beat count.
     *
     * Engine-internal queries never observe this approximation: contexts cache their
     * startBeats at creation (see TimeContext.startBeats / createAndLaunchContext) and
     * scheduler paths only ever query current/future times. Only direct user calls to
     * tempo.beatsAtTime(historicT) may see approximated values, and only after more
     * than MAX_HISTORICAL_SEGMENTS (16) tempo edits have accumulated.
     */
    compactHistoryBefore(time) {
      const boundaryIndex = this.segmentIndexAtTime(time);
      if (boundaryIndex <= _TempoMap.MAX_HISTORICAL_SEGMENTS) return;
      const keepStart = boundaryIndex - _TempoMap.MAX_HISTORICAL_SEGMENTS;
      const boundary = this.segs[keepStart];
      if (!boundary || boundary.t0 <= 0) return;
      const boundaryTime = boundary.t0;
      const boundaryBeats = this.beatsAtTime(boundaryTime);
      const averageBpm = clampPos(boundaryBeats * 60 / boundaryTime);
      const merged = {
        t0: 0,
        t1: boundaryTime,
        bpm0: averageBpm,
        bpm1: averageBpm,
        beats0: 0,
        beats1: boundaryBeats
      };
      this.segs = [merged, ...this.segs.slice(keepStart)];
    }
    segmentIndexAtTime(t) {
      if (t <= 0) return 0;
      let lo = 0;
      let hi = this.segs.length - 1;
      while (lo < hi) {
        const mid = lo + hi + 1 >> 1;
        if (this.segs[mid].t0 <= t) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }
  };
  var TimeScheduler = class {
    id = crypto.randomUUID();
    mode;
    // Most recent logical time-slice processed by the scheduler.
    // Used by the zero-advance stall guard to detect consecutive slices at an
    // unchanged logical time. (Tempo writes do NOT read this — setBpm/rampBpmTo
    // stamp at root.mostRecentDescendentTime; see TimeContext.setBpm.)
    lastProcessedTime = 0;
    // Zero-advance stall guard state (see MAX_ZERO_ADVANCE_SLICES). Counts
    // consecutive slices processed at an unchanged logical time; once tripped,
    // waiters at that instant are rejected until logical time advances.
    zeroAdvanceSliceCount = 0;
    zeroAdvanceGuardTripped = false;
    // Deterministic tie-break sequence for events scheduled in this root.
    seqCounter = 0;
    timePQ = new PriorityQueue();
    beatPQs = /* @__PURE__ */ new Map();
    tempoHeadPQ = new PriorityQueue();
    frameWaiters = /* @__PURE__ */ new Map();
    // realtime wake
    timeoutId = null;
    pumpQueued = false;
    // time dilation (realtime only)
    rate = 1;
    wallAnchor = wallNow();
    logicalAnchor = 0;
    // offline clock
    offlineNow = 0;
    // raf loop (browser only; used only if waitFrame is used)
    rafRunning = false;
    rafHandle = null;
    pumpMacroQueued = false;
    setTimeoutFn;
    clearTimeoutFn;
    yieldToMacrotask;
    scheduleMacrotask;
    constructor(mode, opts) {
      this.mode = mode;
      this.setTimeoutFn = opts?.setTimeout ?? DEFAULT_SET_TIMEOUT;
      this.clearTimeoutFn = opts?.clearTimeout ?? DEFAULT_CLEAR_TIMEOUT;
      this.yieldToMacrotask = createYieldToMacrotask(this.setTimeoutFn);
      this.scheduleMacrotask = createScheduleMacrotask(this.setTimeoutFn);
      if (mode === "realtime") {
        this.setRate(opts?.rate ?? 1);
        this.logicalAnchor = 0;
        this.wallAnchor = wallNow();
      } else {
        this.offlineNow = 0;
        this.rate = 1;
      }
    }
    /** Allocates a deterministic increasing sequence number. */
    allocSeq() {
      return this.seqCounter++;
    }
    now() {
      if (this.mode === "offline") return this.offlineNow;
      return this.logicalAnchor + (wallNow() - this.wallAnchor) * this.rate;
    }
    setRate(rate) {
      if (this.mode === "offline") return;
      const r = clampPos(rate);
      const w = wallNow();
      const l = this.now();
      this.wallAnchor = w;
      this.logicalAnchor = l;
      this.rate = r;
      this.scheduleNext();
    }
    /* ------------------------------- wait primitives ------------------------------- */
    sleepUntilTime(ctx, targetTime) {
      const root = ctx.rootContext;
      const t = Math.max(targetTime, 0);
      if (ctx.isCanceled) return Promise.reject(new Error("context canceled"));
      return new Promise((resolve, reject) => {
        const seq = this.allocSeq();
        const id = `time:${seq}`;
        const abortListener = () => {
          this.timePQ.remove(id);
          ctx.abortController.signal.removeEventListener("abort", abortListener);
          reject(new Error("aborted"));
          this.scheduleNext();
        };
        ctx.abortController.signal.addEventListener("abort", abortListener);
        this.timePQ.add(id, t, {
          kind: "time",
          seq,
          ctx,
          targetTime: t,
          resolve,
          reject,
          abortListener
        });
        this.requestPumpOrWake();
      });
    }
    sleepUntilBeats(ctx, tempo, targetBeat) {
      const b = Math.max(targetBeat, 0);
      if (ctx.isCanceled) return Promise.reject(new Error("context canceled"));
      return new Promise((resolve, reject) => {
        const tempoId = tempo.id;
        const seq = this.allocSeq();
        const id = `beat:${tempoId}:${seq}`;
        const abortListener = () => {
          const pq2 = this.beatPQs.get(tempoId);
          pq2?.remove(id);
          ctx.abortController.signal.removeEventListener("abort", abortListener);
          reject(new Error("aborted"));
          this.refreshTempoHead(tempoId);
          this.deleteBeatQueueIfEmpty(tempoId);
          this.requestPumpOrWake();
        };
        ctx.abortController.signal.addEventListener("abort", abortListener);
        let pq = this.beatPQs.get(tempoId);
        if (!pq) {
          pq = new PriorityQueue();
          this.beatPQs.set(tempoId, pq);
        }
        pq.add(id, b, {
          kind: "beat",
          seq,
          ctx,
          tempo,
          targetBeat: b,
          resolve,
          reject,
          abortListener
        });
        this.refreshTempoHead(tempoId);
        this.requestPumpOrWake();
      });
    }
    awaitNextFrame(ctx) {
      if (ctx.isCanceled) return Promise.reject(new Error("context canceled"));
      if (this.mode === "offline") {
        return new Promise((resolve, reject) => {
          const seq = this.allocSeq();
          const id = `frame:${seq}`;
          const abortListener = () => {
            this.frameWaiters.delete(id);
            ctx.abortController.signal.removeEventListener(
              "abort",
              abortListener
            );
            reject(new Error("aborted"));
          };
          ctx.abortController.signal.addEventListener("abort", abortListener);
          this.frameWaiters.set(id, { seq, ctx, resolve, reject, abortListener });
        });
      }
      const rafGlobal = globalThis;
      if (typeof rafGlobal.requestAnimationFrame !== "function") {
        return Promise.reject(
          new Error(
            "waitFrame requires requestAnimationFrame (use DateTimeContext outside browsers)"
          )
        );
      }
      return new Promise((resolve, reject) => {
        const seq = this.allocSeq();
        const id = `frame:${seq}`;
        const abortListener = () => {
          this.frameWaiters.delete(id);
          this.stopRafIfIdle();
          ctx.abortController.signal.removeEventListener("abort", abortListener);
          reject(new Error("aborted"));
        };
        ctx.abortController.signal.addEventListener("abort", abortListener);
        this.frameWaiters.set(id, { seq, ctx, resolve, reject, abortListener });
        this.ensureRafLoop();
      });
    }
    /* ------------------------------- offline driving ------------------------------- */
    /** Offline: advance "now" and process all due waits (time + beat). */
    async advanceTo(t) {
      if (this.mode !== "offline") throw new Error("advanceTo() is offline-only");
      const target = Math.max(0, t);
      const MAX_TIMESLICES = 2e5;
      let processed = 0;
      while (true) {
        const next = this.peekNextEventTime();
        if (next == null || next > target) break;
        this.offlineNow = next;
        this.processOneTimeslice(next);
        processed++;
        if (processed > MAX_TIMESLICES) {
          throw new Error(
            `advanceTo(${target}) exceeded MAX_TIMESLICES. Possible infinite scheduling at/before target.`
          );
        }
        await this.yieldToMacrotask();
      }
      this.offlineNow = target;
      await this.yieldToMacrotask();
    }
    /** Offline: resolve all waitFrame() calls once per frame tick at the current offline time. */
    async resolveFrameTick() {
      if (this.mode !== "offline") {
        throw new Error("resolveFrameTick() is offline-only");
      }
      const t = this.offlineNow;
      this.resolveAllFrameWaitersAt(t);
      await this.yieldToMacrotask();
      await this.advanceTo(this.offlineNow);
    }
    /* ------------------------------- internal scheduling ------------------------------- */
    requestPumpOrWake() {
      if (this.mode === "offline") return;
      const next = this.peekNextEventTime();
      if (next == null) {
        this.clearTimeoutWake();
        return;
      }
      const now = this.now();
      if (next <= now) {
        this.queuePump();
      } else {
        this.scheduleNext();
      }
    }
    queuePump() {
      if (this.mode === "offline") return;
      if (this.pumpQueued) return;
      this.pumpQueued = true;
      queueMicrotask(() => {
        this.pumpQueued = false;
        this.pumpDue();
      });
    }
    pumpDue() {
      if (this.mode === "offline") return;
      const now = this.now();
      const next = this.peekNextEventTime();
      if (next == null) {
        this.clearTimeoutWake();
        return;
      }
      if (next > now) {
        this.scheduleNext();
        return;
      }
      this.processOneTimeslice(next);
      const stillDue = () => {
        const n = this.peekNextEventTime();
        return n != null && n <= this.now();
      };
      if (stillDue()) {
        this.queuePumpMacrotask();
      } else {
        this.scheduleNext();
      }
    }
    queuePumpMacrotask() {
      if (this.mode === "offline") return;
      if (this.pumpMacroQueued) return;
      this.pumpMacroQueued = true;
      this.scheduleMacrotask(() => {
        this.pumpMacroQueued = false;
        this.pumpDue();
      });
    }
    scheduleNext() {
      if (this.mode === "offline") return;
      const next = this.peekNextEventTime();
      if (next == null) {
        this.clearTimeoutWake();
        return;
      }
      const now = this.now();
      const dtLogical = next - now;
      if (dtLogical <= 0) {
        this.queuePump();
        return;
      }
      const dtWallMs = Math.max(0, dtLogical / this.rate * 1e3);
      this.clearTimeoutWake();
      this.timeoutId = this.setTimeoutFn(() => {
        this.timeoutId = null;
        this.pumpDue();
      }, dtWallMs);
    }
    clearTimeoutWake() {
      if (this.timeoutId != null) {
        this.clearTimeoutFn(this.timeoutId);
        this.timeoutId = null;
      }
    }
    peekNextEventTime() {
      const timeHead = this.timePQ.peek();
      const beatHead = this.tempoHeadPQ.peek();
      const t1 = timeHead?.deadline ?? Infinity;
      const t2 = beatHead?.deadline ?? Infinity;
      const next = Math.min(t1, t2);
      return Number.isFinite(next) ? next : null;
    }
    refreshTempoHead(tempoId) {
      const pq = this.beatPQs.get(tempoId);
      const head = pq?.peek();
      const tempoHeadId = `tempohead:${tempoId}`;
      if (!head) {
        this.tempoHeadPQ.remove(tempoHeadId);
        this.deleteBeatQueueIfEmpty(tempoId);
        return;
      }
      const meta = head.metadata;
      const t = meta.tempo.timeAtBeats(meta.targetBeat);
      if (!Number.isFinite(t)) return;
      if (!this.tempoHeadPQ.adjustDeadline(tempoHeadId, t)) {
        this.tempoHeadPQ.add(tempoHeadId, t, { tempoId });
      }
    }
    /** Call after tempo changes to retime beat waits efficiently. */
    onTempoChanged(tempo) {
      this.refreshTempoHead(tempo.id);
      this.requestPumpOrWake();
    }
    processOneTimeslice(tSlice) {
      const sliceTime = tSlice;
      if (sliceTime === this.lastProcessedTime) {
        this.zeroAdvanceSliceCount += 1;
        if (this.zeroAdvanceSliceCount > MAX_ZERO_ADVANCE_SLICES) {
          this.zeroAdvanceGuardTripped = true;
        }
      } else {
        this.zeroAdvanceSliceCount = 0;
        this.zeroAdvanceGuardTripped = false;
      }
      this.lastProcessedTime = sliceTime;
      const timeHead = this.timePQ.peek();
      const beatHead = this.tempoHeadPQ.peek();
      const tTime = timeHead?.deadline ?? Infinity;
      const tBeat = beatHead?.deadline ?? Infinity;
      if (tTime <= tBeat) {
        this.processTimeWaitersAt(tTime);
      } else {
        this.processBeatWaitersForTempoHead();
      }
    }
    processTimeWaitersAt(t) {
      const batch = [];
      while (true) {
        const head = this.timePQ.peek();
        if (!head || head.deadline !== t) break;
        const item = this.timePQ.pop();
        batch.push(item.metadata);
      }
      batch.sort((a, b) => a.seq - b.seq);
      for (const w of batch) {
        const ctx = w.ctx;
        ctx.abortController.signal.removeEventListener("abort", w.abortListener);
        if (ctx.isCanceled) {
          w.reject(new Error("aborted"));
          continue;
        }
        if (this.zeroAdvanceGuardTripped) {
          w.reject(zeroAdvanceStallError(t));
          continue;
        }
        ctx.time = Math.max(ctx.time, w.targetTime);
        ctx.rootContext.mostRecentDescendentTime = Math.max(
          ctx.rootContext.mostRecentDescendentTime,
          ctx.time
        );
        w.resolve();
      }
    }
    processBeatWaitersForTempoHead() {
      const head = this.tempoHeadPQ.peek();
      if (!head) return;
      const tempoId = head.metadata.tempoId;
      const beatPQ = this.beatPQs.get(tempoId);
      const beatHead = beatPQ?.peek();
      if (!beatHead) {
        this.tempoHeadPQ.pop();
        return;
      }
      const meta0 = beatHead.metadata;
      const dueTime = meta0.tempo.timeAtBeats(meta0.targetBeat);
      if (!Number.isFinite(dueTime)) {
        beatPQ?.pop();
        this.refreshTempoHead(tempoId);
        return;
      }
      const targetBeat = meta0.targetBeat;
      const batch = [];
      while (true) {
        const h = beatPQ.peek();
        if (!h || h.deadline !== targetBeat) break;
        batch.push(beatPQ.pop().metadata);
      }
      batch.sort((a, b) => a.seq - b.seq);
      this.tempoHeadPQ.pop();
      for (const w of batch) {
        const ctx = w.ctx;
        ctx.abortController.signal.removeEventListener("abort", w.abortListener);
        if (ctx.isCanceled) {
          w.reject(new Error("aborted"));
          continue;
        }
        if (this.zeroAdvanceGuardTripped) {
          w.reject(zeroAdvanceStallError(dueTime));
          continue;
        }
        ctx.time = Math.max(ctx.time, dueTime);
        ctx.rootContext.mostRecentDescendentTime = Math.max(
          ctx.rootContext.mostRecentDescendentTime,
          ctx.time
        );
        w.resolve();
      }
      this.refreshTempoHead(tempoId);
      this.deleteBeatQueueIfEmpty(tempoId);
    }
    deleteBeatQueueIfEmpty(tempoId) {
      const pq = this.beatPQs.get(tempoId);
      if (pq?.isEmpty()) {
        this.beatPQs.delete(tempoId);
        this.tempoHeadPQ.remove(`tempohead:${tempoId}`);
      }
    }
    /* ------------------------------- frames ------------------------------- */
    stopRafIfIdle() {
      if (this.frameWaiters.size || !this.rafRunning) return;
      this.rafRunning = false;
      if (this.rafHandle !== null) globalThis.cancelAnimationFrame?.(this.rafHandle);
      this.rafHandle = null;
    }
    ensureRafLoop() {
      if (this.rafRunning) return;
      this.rafRunning = true;
      const rafGlobal = globalThis;
      const raf = rafGlobal.requestAnimationFrame;
      if (!raf) {
        throw new Error("requestAnimationFrame is required for waitFrame()");
      }
      const rafFn = raf.bind(globalThis);
      const tick = () => {
        if (!this.rafRunning) return;
        this.rafRunning = false;
        this.rafHandle = null;
        const t = this.now();
        this.resolveAllFrameWaitersAt(t);
        this.queuePump();
      };
      this.rafHandle = rafFn(() => tick());
    }
    resolveAllFrameWaitersAt(t) {
      if (this.frameWaiters.size === 0) return;
      const entries = Array.from(this.frameWaiters.entries());
      this.frameWaiters.clear();
      entries.sort((a, b) => a[1].seq - b[1].seq);
      for (const [id, w] of entries) {
        const ctx = w.ctx;
        ctx.abortController.signal.removeEventListener("abort", w.abortListener);
        if (ctx.isCanceled) {
          w.reject(new Error("aborted"));
          continue;
        }
        ctx.time = Math.max(
          ctx.time,
          t,
          ctx.rootContext.mostRecentDescendentTime
        );
        ctx.rootContext.mostRecentDescendentTime = Math.max(
          ctx.rootContext.mostRecentDescendentTime,
          ctx.time
        );
        w.resolve();
      }
    }
  };
  var barrierMap = /* @__PURE__ */ new Map();
  function barrierStoreKey(rootId, key) {
    return `${rootId}\0${key}`;
  }
  function purgeBarriersForRoot(rootId) {
    const prefix = `${rootId}\0`;
    for (const storeKey of barrierMap.keys()) {
      if (storeKey.startsWith(prefix)) barrierMap.delete(storeKey);
    }
  }
  function getBarrier(key, rootId) {
    const storeKey = barrierStoreKey(rootId, key);
    const existing = barrierMap.get(storeKey);
    if (existing) return existing;
    const b = {
      key,
      rootId,
      lastResolvedTime: -Infinity,
      inProgress: false,
      startTime: -Infinity,
      waiters: /* @__PURE__ */ new Set()
    };
    barrierMap.set(storeKey, b);
    return b;
  }
  function startBarrier(key, ctx) {
    const rootId = ctx.rootContext.id;
    const b = getBarrier(key, rootId);
    if (!b.inProgress) {
      b.inProgress = true;
      b.startTime = ctx.time;
    }
  }
  function resolveBarrier(key, ctx) {
    const rootId = ctx.rootContext.id;
    const storeKey = barrierStoreKey(rootId, key);
    const b = barrierMap.get(storeKey);
    if (!b) {
      console.warn(`No barrier found for key: ${key}`);
      return;
    }
    b.inProgress = false;
    b.lastResolvedTime = ctx.time;
    const t = b.lastResolvedTime;
    for (const w of b.waiters) {
      w.ctx.abortController.signal.removeEventListener("abort", w.abortListener);
      if (w.ctx.isCanceled) {
        w.reject(new Error("aborted"));
        continue;
      }
      w.ctx.time = Math.max(w.ctx.time, t);
      w.ctx.rootContext.mostRecentDescendentTime = Math.max(
        w.ctx.rootContext.mostRecentDescendentTime,
        w.ctx.time
      );
      w.resolve();
    }
    b.waiters.clear();
  }
  function awaitBarrier(key, ctx) {
    const rootId = ctx.rootContext.id;
    const storeKey = barrierStoreKey(rootId, key);
    const b = barrierMap.get(storeKey);
    if (!b) {
      console.warn(`No barrier found for key: ${key}`);
      return Promise.resolve();
    }
    if (b.lastResolvedTime >= ctx.time) {
      ctx.time = Math.max(ctx.time, b.lastResolvedTime);
      ctx.rootContext.mostRecentDescendentTime = Math.max(
        ctx.rootContext.mostRecentDescendentTime,
        ctx.time
      );
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const w = {
        ctx,
        resolve,
        reject,
        abortListener: () => {
          b.waiters.delete(w);
          reject(new Error("aborted"));
        }
      };
      ctx.abortController.signal.addEventListener("abort", w.abortListener);
      b.waiters.add(w);
    });
  }
  var contextId = 0;
  var rootContexts = /* @__PURE__ */ new Set();
  function cancelAllContexts() {
    const roots = Array.from(rootContexts);
    for (const ctx of roots) {
      try {
        ctx.cancel();
      } catch {
      }
    }
    rootContexts.clear();
  }
  var TimeContext = class {
    rootContext;
    mostRecentDescendentTime = 0;
    debugName = "";
    abortController;
    time;
    startTime;
    // Beat position captured at context creation (after tempo is wired). Cached here
    // instead of recomputed via tempo.beatsAtTime(startTime) so that history compaction
    // (which merges old segments into a single averaged segment) cannot retroactively
    // shift a long-lived context's beat origin. See compactHistoryBefore.
    startBeats = 0;
    isCanceled = false;
    id;
    cancelPromise;
    childContexts = /* @__PURE__ */ new Set();
    // Scheduler + tempo are wired during launch/branch creation
    scheduler;
    tempo;
    rng;
    rngSeed;
    rngForkCounter = 0;
    constructor(time, ab, id, cancelPromise) {
      this.time = time;
      this.startTime = time;
      this.abortController = ab;
      this.id = id;
      this.cancelPromise = cancelPromise;
      this.abortController.signal.addEventListener("abort", () => {
        this.isCanceled = true;
      });
    }
    get progTime() {
      return this.time - this.startTime;
    }
    /** Beat position under variable tempo. */
    get beats() {
      return this.tempo.beatsAtTime(this.time);
    }
    get progBeats() {
      return this.tempo.beatsAtTime(this.time) - this.startBeats;
    }
    /** Deterministic random in [0,1). Use this instead of Math.random(). */
    random() {
      return this.rng();
    }
    /** Read-only BPM at the context's current logical time. */
    get bpm() {
      return this.tempo.bpmAtTime(this.time);
    }
    /** Tempo write: always stamped at the latest processed logical time of this root tree. */
    setBpm(bpm) {
      const t = this.rootContext.mostRecentDescendentTime;
      this.tempo._setBpmAtTime(bpm, t);
      this.rootContext.scheduler.onTempoChanged(this.tempo);
    }
    /** Optional: small ramp helper (also stamped at latest processed logical time). */
    rampBpmTo(bpm, durSec) {
      const t = this.rootContext.mostRecentDescendentTime;
      this.tempo._rampToBpmAtTime(bpm, durSec, t);
      this.rootContext.scheduler.onTempoChanged(this.tempo);
    }
    connectChildContext(childContext, opts) {
      childContext.rootContext = this.rootContext;
      childContext.scheduler = this.rootContext.scheduler;
      const tempoMode = opts?.tempo ?? "shared";
      childContext.tempo = tempoMode === "shared" ? this.tempo : this.tempo.clone();
      const rngMode = opts?.rng ?? "forked";
      if (rngMode === "shared") {
        childContext.rngSeed = this.rngSeed;
        childContext.rng = this.rng;
      } else {
        const childSeed = deriveSeed(this.rngSeed, this.rngForkCounter++);
        childContext.rngSeed = childSeed;
        childContext.rng = seedrandom_shim_default(childSeed);
        childContext.rngForkCounter = 0;
      }
      this.childContexts.add(childContext);
    }
    cancel() {
      this.abortController.abort();
      this.childContexts.forEach((ctx) => ctx.cancel());
    }
    branch(block, debugName = "", opts) {
      const promise = createAndLaunchContext(
        block,
        this.rootContext.mostRecentDescendentTime,
        Object.getPrototypeOf(this).constructor,
        false,
        this,
        debugName,
        opts
      );
      return {
        finally: (finalFunc) => {
          const chained = promise.finally(finalFunc);
          chained.catch(() => {
          });
          return chained;
        },
        cancel: () => promise.cancel(),
        handleCancel: (cancelFunc) => promise.handleCancel(cancelFunc)
      };
    }
    branchWait(block, debugName = "", opts) {
      return createAndLaunchContext(
        block,
        this.time,
        Object.getPrototypeOf(this).constructor,
        true,
        this,
        debugName,
        opts
      );
    }
    wait(beats) {
      if (this.isCanceled) return Promise.reject(new Error("context canceled"));
      const delta = Number.isFinite(beats) ? beats : 0;
      if (delta <= 0) {
        const baseTime2 = Math.max(
          this.rootContext.mostRecentDescendentTime,
          this.time
        );
        return this.rootContext.scheduler.sleepUntilTime(this, baseTime2);
      }
      const baseTime = Math.max(
        this.rootContext.mostRecentDescendentTime,
        this.time
      );
      const baseBeats = this.tempo.beatsAtTime(baseTime);
      const targetBeat = baseBeats + delta;
      return this.rootContext.scheduler.sleepUntilBeats(
        this,
        this.tempo,
        targetBeat
      );
    }
  };
  var DateTimeContext = class extends TimeContext {
    waitSec(sec) {
      if (this.isCanceled) return Promise.reject(new Error("context canceled"));
      let s = Number.isFinite(sec) ? sec : 0;
      if (s < 0) s = 0;
      const baseTime = Math.max(
        this.rootContext.mostRecentDescendentTime,
        this.time
      );
      const targetTime = baseTime + s;
      return this.rootContext.scheduler.sleepUntilTime(this, targetTime);
    }
  };
  var BrowserTimeContext = class extends DateTimeContext {
    waitFrame() {
      return this.rootContext.scheduler.awaitNextFrame(this);
    }
  };
  var OfflineTimeContext = class extends DateTimeContext {
    waitFrame() {
      return this.rootContext.scheduler.awaitNextFrame(this);
    }
  };
  function createAndLaunchContext(block, rootTime, ctor, updateParent, parentContext, debugName = "", opts, rootScheduler, rootTempo, rootSeed) {
    const abortController = new AbortController();
    const promiseProxy = new CancelablePromiseProxy(abortController);
    const newContext = new ctor(
      rootTime,
      abortController,
      contextId++,
      promiseProxy
    );
    newContext.debugName = debugName;
    promiseProxy.timeContext = newContext;
    if (parentContext) {
      parentContext.connectChildContext(newContext, opts);
    } else {
      newContext.rootContext = newContext;
      newContext.mostRecentDescendentTime = rootTime;
      if (!rootScheduler) throw new Error("Root context requires a scheduler");
      if (!rootTempo) throw new Error("Root context requires a tempo map");
      newContext.scheduler = rootScheduler;
      newContext.tempo = rootTempo;
      const seedStr = normalizeSeed(rootSeed);
      newContext.rngSeed = seedStr;
      newContext.rng = seedrandom_shim_default(seedStr);
    }
    newContext.startBeats = newContext.tempo.beatsAtTime(newContext.time);
    const blockPromise = block(newContext);
    promiseProxy.promise = blockPromise;
    const bp = blockPromise.catch((e) => {
      const err = e;
      console.log("promise catch error", err, err?.message, err?.stack);
    });
    if (!parentContext) {
      rootContexts.add(newContext);
      const cleanupRoot = () => {
        rootContexts.delete(newContext);
        purgeBarriersForRoot(newContext.id);
      };
      promiseProxy.handleCancel(cleanupRoot);
      bp.finally(cleanupRoot);
    }
    if (parentContext) {
      bp.finally(() => {
        if (updateParent) {
          parentContext.time = Math.max(newContext.time, parentContext.time);
        }
        parentContext.childContexts.delete(newContext);
      });
    }
    return promiseProxy;
  }
  function launch(block, opts) {
    const scheduler = new TimeScheduler("realtime", {
      rate: opts?.rate ?? 1,
      setTimeout: opts?.setTimeout,
      clearTimeout: opts?.clearTimeout
    });
    const tempo = new TempoMap(opts?.bpm ?? 60);
    const t0 = 0;
    return createAndLaunchContext(
      block,
      t0,
      DateTimeContext,
      false,
      void 0,
      opts?.debugName ?? "",
      void 0,
      scheduler,
      tempo,
      opts?.seed
    );
  }
  function launchBrowser(block, opts) {
    const scheduler = new TimeScheduler("realtime", {
      rate: opts?.rate ?? 1,
      setTimeout: opts?.setTimeout,
      clearTimeout: opts?.clearTimeout
    });
    const tempo = new TempoMap(opts?.bpm ?? 60);
    const t0 = 0;
    return createAndLaunchContext(
      block,
      t0,
      BrowserTimeContext,
      false,
      void 0,
      opts?.debugName ?? "",
      void 0,
      scheduler,
      tempo,
      opts?.seed
    );
  }
  var OfflineRunner = class {
    scheduler;
    ctx;
    promise;
    fps;
    constructor(block, opts) {
      this.scheduler = new TimeScheduler("offline", {
        setTimeout: opts?.setTimeout,
        clearTimeout: opts?.clearTimeout
      });
      const tempo = new TempoMap(opts?.bpm ?? 60);
      this.fps = opts?.fps ?? 60;
      const t0 = 0;
      this.promise = createAndLaunchContext(
        block,
        t0,
        OfflineTimeContext,
        false,
        void 0,
        opts?.debugName ?? "",
        void 0,
        this.scheduler,
        tempo,
        opts?.seed
      );
      this.ctx = this.promise.timeContext;
    }
    /** Advance simulation by dt seconds (processes all time+beat waits due). */
    async stepSec(dt) {
      const s = Math.max(0, Number.isFinite(dt) ? dt : 0);
      await this.scheduler.advanceTo(this.scheduler.now() + s);
    }
    /** Advance simulation by 1 frame (default 60fps): pumps due waits, resolves waitFrame(), pumps again. */
    async stepFrame() {
      const dt = 1 / this.fps;
      await this.stepSec(dt);
      await this.scheduler.resolveFrameTick();
    }
    /** Convenience: render N frames. */
    async stepFrames(n) {
      const N = Math.max(0, Math.floor(n));
      for (let i = 0; i < N; i++) {
        await this.stepFrame();
      }
    }
  };

  // packages/native-webgpu/src/td-timing.ts
  var g = globalThis;
  var scopes = /* @__PURE__ */ new Map();
  var SketchLifetime = class {
    id = g.__hostRegister();
    active = true;
    error = "";
    roots = /* @__PURE__ */ new Set();
    cleanups = [];
    resources = /* @__PURE__ */ new Set();
    disposing = false;
    /** Synchronous, reverse registration order; called before GPU resources expire. */
    onDispose(callback) {
      this.run(() => {
        if (this.disposing) throw new Error("Sketch cleanup has already started");
        if (typeof callback !== "function") throw new TypeError("onDispose requires a function");
        this.cleanups.push(callback);
      });
    }
    constructor() {
      scopes.set(this.id, this);
    }
    run(fn) {
      if (!this.active) throw new Error("Sketch generation has been disposed");
      const previous = g.__hostGeneration(this.id);
      try {
        return fn();
      } finally {
        g.__hostGeneration(previous);
      }
    }
    track(fn) {
      return this.run(() => {
        const handle = fn();
        this.roots.add(handle);
        handle.then(() => this.roots.delete(handle), (error) => {
          this.roots.delete(handle);
          if (!handle.abortController.signal.aborted) this.fail(error);
        });
        return handle;
      });
    }
    timing = Object.freeze({
      ...mod_exports,
      launch: ((...args) => this.track(() => launch(...args))),
      launchBrowser: ((...args) => this.track(() => launchBrowser(...args))),
      createAndLaunchContext: ((...args) => this.track(() => createAndLaunchContext(...args))),
      cancelAllContexts: () => this.cancelRoots()
    });
    cancelRoots() {
      for (const root of [...this.roots]) root.cancel();
      this.roots.clear();
    }
    fail(error) {
      if (!this.active || this.error) return;
      this.error = String(error?.stack ?? error);
      this.run(() => this.cancelRoots());
      g.__hostInvalidate(this.id);
      g.__hostCancelFrames(this.id);
    }
    async dispose() {
      if (!this.active) return;
      this.disposing = true;
      this.run(() => this.cancelRoots());
      await new Promise((resolve) => g.__avNativeImmediate(resolve));
      for (const cleanup of this.cleanups.splice(0).reverse()) {
        try {
          const result = this.run(cleanup);
          if (result && typeof result.then === "function") {
            result.catch(() => {
            });
            throw new Error("onDispose callbacks must be synchronous");
          }
        } catch (error) {
          console.error("Sketch cleanup failed:", String(error));
        }
      }
      for (const resource of this.resources) {
        try {
          resource.destroy();
        } catch (error) {
          console.error("GPU cleanup failed:", String(error));
        }
      }
      this.resources.clear();
      g.__hostInvalidate(this.id);
      g.__hostCancelFrames(this.id);
      this.active = false;
      scopes.delete(this.id);
    }
    wrapped = /* @__PURE__ */ new WeakMap();
    raw = /* @__PURE__ */ new WeakMap();
    /** Retained renderer/host functions fail before entering disposed native resources. */
    guard(value) {
      const { wrapped, raw } = this;
      const unwrap = (value2) => {
        if (!value2 || typeof value2 !== "object") return value2;
        if (raw.has(value2)) return raw.get(value2);
        if (Array.isArray(value2)) return value2.map(unwrap);
        if (Object.getPrototypeOf(value2) === Object.prototype) return Object.fromEntries(Object.entries(value2).map(([key, v]) => [key, unwrap(v)]));
        return value2;
      };
      const wrap = (target) => {
        if (!target || typeof target !== "object" || ArrayBuffer.isView(target) || target instanceof ArrayBuffer) return target;
        if (target instanceof Promise) return target.then(wrap);
        if (wrapped.has(target)) return wrapped.get(target);
        const methods = /* @__PURE__ */ new Map();
        const proxy = new Proxy(target, { get: (object, key) => {
          const result = this.run(() => Reflect.get(object, key, object));
          if (typeof result !== "function") return wrap(result);
          if (!methods.has(key)) methods.set(key, (...args) => this.run(() => {
            const value2 = Reflect.apply(result, object, args.map(unwrap));
            if ((key === "createBuffer" || key === "createTexture") && value2 && typeof value2.destroy === "function") this.resources.add(value2);
            if (key === "destroy") this.resources.delete(object);
            return wrap(value2);
          }));
          return methods.get(key);
        }, set: (object, key, value2) => this.run(() => Reflect.set(object, key, unwrap(value2), object)) });
        wrapped.set(target, proxy);
        raw.set(proxy, target);
        return proxy;
      };
      return wrap(value);
    }
  };
  g.__hostError = (error, generation) => {
    const scope = scopes.get(generation);
    if (scope) scope.fail(error);
    else if (generation === 0) {
      g.__avError = String(error?.stack ?? error);
      g.__avBackgroundError = g.__avError;
    }
  };

  // packages/native-webgpu/src/td-chop-runtime.ts
  var g2 = globalThis;
  var active;
  var inputs = [];
  var frame;
  var names = [];
  var pulses = [];
  var reset = false;
  var sampleCount = 1;
  var attemptedSource;
  var attemptedNames = "";
  var reloadError = "";
  var message = (error) => String(error?.stack ?? error);
  var synchronous = (value, name) => {
    if (value && typeof value.then === "function") {
      Promise.resolve(value).catch(() => {
      });
      throw Error(`${name} must be synchronous; use host.timing for independent tasks`);
    }
  };
  g2.__avDone = true;
  g2.__avError = "";
  g2.__avHasFrame = false;
  g2.__avChopAccept = () => {
    const incoming = JSON.parse(g2.__avFrameJSON);
    const data = new Float32Array(g2.__avData.buffer, g2.__avData.byteOffset, g2.__avData.byteLength / 4);
    const next = Array.from({ length: 4 }, () => /* @__PURE__ */ new Map());
    for (const c of incoming.channels) next[c.input].set(c.name, data.subarray(c.offset, c.offset + c.count));
    inputs = next;
    names = incoming.names;
    pulses = incoming.pulses;
    reset = !!incoming.reset;
    sampleCount = incoming.outputSamples;
    frame = Object.freeze({ frame: incoming.frame, absFrame: incoming.absFrame, rate: incoming.rate, deltaSeconds: incoming.deltaSeconds, time: (incoming.frame - 1) / incoming.rate });
    g2.__avData = null;
  };
  function createGeneration() {
    const life = new SketchLifetime();
    const count = sampleCount;
    const values = new Map(names.map((name) => [name, new Float32Array(count)]));
    const outputChannel = (name) => {
      const data = values.get(name);
      if (!data) throw Error(`Unknown output channel '${name}'; add it to Output Channels`);
      return data;
    };
    const finite = (name, value) => {
      if (typeof value !== "number" || !Number.isFinite(Math.fround(value))) throw Error(`Output '${name}' must be a finite float32 number`);
      return Math.fround(value);
    };
    const host = Object.freeze({
      timing: life.timing,
      inputs: Object.freeze({
        get: (name, input = 0, sample) => life.run(() => {
          const data = inputs[input]?.get(name);
          return data?.[sample ?? data.length - 1] ?? 0;
        }),
        samples: (name, input = 0) => life.run(() => inputs[input]?.get(name)?.slice() ?? new Float32Array()),
        names: (input = 0) => life.run(() => [...inputs[input]?.keys() ?? []])
      }),
      outputs: Object.freeze({
        sampleCount: count,
        set: (name, value, sample = 0) => life.run(() => {
          const data = outputChannel(name);
          if (!Number.isInteger(sample) || sample < 0 || sample >= count) throw Error("Output sample index out of range");
          data[sample] = finite(name, value);
        }),
        get: (name, sample = 0) => life.run(() => values.get(name)?.[sample] ?? 0),
        samples: (name) => life.run(() => values.get(name)?.slice() ?? new Float32Array()),
        setSamples: (name, source) => life.run(() => {
          const data = outputChannel(name);
          if (!source || source.length !== count) throw Error(`Output '${name}' needs exactly ${count} samples`);
          const next = new Float32Array(count);
          for (let i = 0; i < count; i++) next[i] = finite(name, source[i]);
          data.set(next);
        }),
        names: () => life.run(() => [...values.keys()])
      }),
      onDispose: (fn) => life.onDispose(fn)
    });
    return { life, host, values, program: {} };
  }
  g2.__avChopCook = async () => {
    g2.__avDone = false;
    g2.__avError = "";
    g2.__avHasFrame = false;
    try {
      const signature = JSON.stringify([names, sampleCount]);
      if (reset || g2.__avSource !== attemptedSource || signature !== attemptedNames) {
        attemptedSource = g2.__avSource;
        attemptedNames = signature;
        const candidate = createGeneration();
        try {
          candidate.program = candidate.life.run(() => new Function(`${g2.__avSource}
;return {setup:typeof setup==='function'?setup:undefined,onCook:typeof onCook==='function'?onCook:undefined,onPulse:typeof onPulse==='function'?onPulse:undefined};`)());
          if (!candidate.program.setup && !candidate.program.onCook) throw Error("CHOP script must define setup(host) or onCook(host, frame)");
          await candidate.life.run(() => candidate.program.setup?.(candidate.host));
          if (candidate.life.error) throw Error(candidate.life.error);
          await active?.life.dispose();
          active = candidate;
          reloadError = "";
        } catch (error) {
          await candidate.life.dispose();
          reloadError = message(error);
        }
      }
      if (!active) throw Error(reloadError || "No valid CHOP script");
      const current = active;
      if (current.life.error) throw Error(current.life.error);
      if (g2.__avBackgroundError) throw Error(g2.__avBackgroundError);
      await g2.__hostFrame();
      if (current.life.error) throw Error(current.life.error);
      try {
        for (const name of pulses) synchronous(current.life.run(() => current.program.onPulse?.(name, current.host)), "onPulse");
        synchronous(current.life.run(() => current.program.onCook?.(current.host, frame)), "onCook");
        const output = new Float32Array(names.length * sampleCount);
        names.forEach((name, index) => {
          const data = current.values.get(name);
          if (data) output.set(data.subarray(0, sampleCount), index * sampleCount);
        });
        g2.__avBytes = new Uint8Array(output.buffer);
        g2.__avHasFrame = true;
        g2.__avError = reloadError;
      } catch (error) {
        current.life.fail(error);
        throw error;
      }
    } catch (error) {
      g2.__avError = message(error);
    } finally {
      g2.__avDone = true;
    }
  };
  g2.__avDispose = async () => {
    g2.__avDone = false;
    try {
      await active?.life.dispose();
      active = void 0;
    } finally {
      g2.__avDone = true;
    }
  };
})();
