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

  // ../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/alea.js
  var require_alea = __commonJS({
    "../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/alea.js"(exports, module) {
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

  // ../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xor128.js
  var require_xor128 = __commonJS({
    "../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xor128.js"(exports, module) {
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

  // ../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xorwow.js
  var require_xorwow = __commonJS({
    "../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xorwow.js"(exports, module) {
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

  // ../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xorshift7.js
  var require_xorshift7 = __commonJS({
    "../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xorshift7.js"(exports, module) {
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

  // ../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xor4096.js
  var require_xor4096 = __commonJS({
    "../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/xor4096.js"(exports, module) {
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

  // ../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/tychei.js
  var require_tychei = __commonJS({
    "../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/lib/tychei.js"(exports, module) {
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

  // ../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/seedrandom.js
  var require_seedrandom = __commonJS({
    "../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/seedrandom.js"(exports, module) {
      (function(global, pool, math) {
        var width2 = 256, chunks = 6, digits = 52, rngname = "random", startdenom = math.pow(width2, chunks), significance = math.pow(2, digits), overflow = significance * 2, mask = width2 - 1, nodecrypto;
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
              n = (n + x) * width2;
              d *= width2;
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
          while (i < width2) {
            s[i] = i++;
          }
          for (i = 0; i < width2; i++) {
            s[i] = s[j = mask & j + key[i % keylen] + (t = s[i])];
            s[j] = t;
          }
          (me.g = function(count) {
            var t2, r = 0, i2 = me.i, j2 = me.j, s2 = me.S;
            while (count--) {
              t2 = s2[i2 = mask & i2 + 1];
              r = r * width2 + s2[mask & (s2[i2] = s2[j2 = mask & j2 + t2]) + (s2[j2] = t2)];
            }
            me.i = i2;
            me.j = j2;
            return r;
          })(width2);
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
              out = out(width2);
            } else {
              out = new Uint8Array(width2);
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

  // ../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/index.js
  var require_seedrandom2 = __commonJS({
    "../../node_modules/.deno/seedrandom@3.0.5/node_modules/seedrandom/index.js"(exports, module) {
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

  // ../../node_modules/.deno/earcut@3.0.2/node_modules/earcut/src/earcut.js
  function earcut(data, holeIndices, dim = 2) {
    const hasHoles = holeIndices && holeIndices.length;
    const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
    let outerNode = linkedList(data, 0, outerLen, dim, true);
    const triangles = [];
    if (!outerNode || outerNode.next === outerNode.prev) return triangles;
    let minX, minY, invSize;
    if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
    if (data.length > 80 * dim) {
      minX = data[0];
      minY = data[1];
      let maxX = minX;
      let maxY = minY;
      for (let i = dim; i < outerLen; i += dim) {
        const x = data[i];
        const y = data[i + 1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      invSize = Math.max(maxX - minX, maxY - minY);
      invSize = invSize !== 0 ? 32767 / invSize : 0;
    }
    earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
    return triangles;
  }
  function linkedList(data, start, end, dim, clockwise) {
    let last;
    if (clockwise === signedArea(data, start, end, dim) > 0) {
      for (let i = start; i < end; i += dim) last = insertNode(i / dim | 0, data[i], data[i + 1], last);
    } else {
      for (let i = end - dim; i >= start; i -= dim) last = insertNode(i / dim | 0, data[i], data[i + 1], last);
    }
    if (last && equals(last, last.next)) {
      removeNode(last);
      last = last.next;
    }
    return last;
  }
  function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;
    let p2 = start, again;
    do {
      again = false;
      if (!p2.steiner && (equals(p2, p2.next) || area(p2.prev, p2, p2.next) === 0)) {
        removeNode(p2);
        p2 = end = p2.prev;
        if (p2 === p2.next) break;
        again = true;
      } else {
        p2 = p2.next;
      }
    } while (again || p2 !== end);
    return end;
  }
  function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
    if (!ear) return;
    if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
    let stop = ear;
    while (ear.prev !== ear.next) {
      const prev = ear.prev;
      const next = ear.next;
      if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
        triangles.push(prev.i, ear.i, next.i);
        removeNode(ear);
        ear = next.next;
        stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) {
        if (!pass) {
          earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
        } else if (pass === 1) {
          ear = cureLocalIntersections(filterPoints(ear), triangles);
          earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
        } else if (pass === 2) {
          splitEarcut(ear, triangles, dim, minX, minY, invSize);
        }
        break;
      }
    }
  }
  function isEar(ear) {
    const a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
    const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
    let p2 = c.next;
    while (p2 !== a) {
      if (p2.x >= x0 && p2.x <= x1 && p2.y >= y0 && p2.y <= y1 && pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p2.x, p2.y) && area(p2.prev, p2, p2.next) >= 0) return false;
      p2 = p2.next;
    }
    return true;
  }
  function isEarHashed(ear, minX, minY, invSize) {
    const a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
    const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
    const minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
    let p2 = ear.prevZ, n = ear.nextZ;
    while (p2 && p2.z >= minZ && n && n.z <= maxZ) {
      if (p2.x >= x0 && p2.x <= x1 && p2.y >= y0 && p2.y <= y1 && p2 !== a && p2 !== c && pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p2.x, p2.y) && area(p2.prev, p2, p2.next) >= 0) return false;
      p2 = p2.prevZ;
      if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c && pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
      n = n.nextZ;
    }
    while (p2 && p2.z >= minZ) {
      if (p2.x >= x0 && p2.x <= x1 && p2.y >= y0 && p2.y <= y1 && p2 !== a && p2 !== c && pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p2.x, p2.y) && area(p2.prev, p2, p2.next) >= 0) return false;
      p2 = p2.prevZ;
    }
    while (n && n.z <= maxZ) {
      if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c && pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
      n = n.nextZ;
    }
    return true;
  }
  function cureLocalIntersections(start, triangles) {
    let p2 = start;
    do {
      const a = p2.prev, b = p2.next.next;
      if (!equals(a, b) && intersects(a, p2, p2.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
        triangles.push(a.i, p2.i, b.i);
        removeNode(p2);
        removeNode(p2.next);
        p2 = start = b;
      }
      p2 = p2.next;
    } while (p2 !== start);
    return filterPoints(p2);
  }
  function splitEarcut(start, triangles, dim, minX, minY, invSize) {
    let a = start;
    do {
      let b = a.next.next;
      while (b !== a.prev) {
        if (a.i !== b.i && isValidDiagonal(a, b)) {
          let c = splitPolygon(a, b);
          a = filterPoints(a, a.next);
          c = filterPoints(c, c.next);
          earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
          earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
          return;
        }
        b = b.next;
      }
      a = a.next;
    } while (a !== start);
  }
  function eliminateHoles(data, holeIndices, outerNode, dim) {
    const queue = [];
    for (let i = 0, len = holeIndices.length; i < len; i++) {
      const start = holeIndices[i] * dim;
      const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
      const list = linkedList(data, start, end, dim, false);
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
    queue.sort(compareXYSlope);
    for (let i = 0; i < queue.length; i++) {
      outerNode = eliminateHole(queue[i], outerNode);
    }
    return outerNode;
  }
  function compareXYSlope(a, b) {
    let result = a.x - b.x;
    if (result === 0) {
      result = a.y - b.y;
      if (result === 0) {
        const aSlope = (a.next.y - a.y) / (a.next.x - a.x);
        const bSlope = (b.next.y - b.y) / (b.next.x - b.x);
        result = aSlope - bSlope;
      }
    }
    return result;
  }
  function eliminateHole(hole, outerNode) {
    const bridge = findHoleBridge(hole, outerNode);
    if (!bridge) {
      return outerNode;
    }
    const bridgeReverse = splitPolygon(bridge, hole);
    filterPoints(bridgeReverse, bridgeReverse.next);
    return filterPoints(bridge, bridge.next);
  }
  function findHoleBridge(hole, outerNode) {
    let p2 = outerNode;
    const hx = hole.x;
    const hy = hole.y;
    let qx = -Infinity;
    let m;
    if (equals(hole, p2)) return p2;
    do {
      if (equals(hole, p2.next)) return p2.next;
      else if (hy <= p2.y && hy >= p2.next.y && p2.next.y !== p2.y) {
        const x = p2.x + (hy - p2.y) * (p2.next.x - p2.x) / (p2.next.y - p2.y);
        if (x <= hx && x > qx) {
          qx = x;
          m = p2.x < p2.next.x ? p2 : p2.next;
          if (x === hx) return m;
        }
      }
      p2 = p2.next;
    } while (p2 !== outerNode);
    if (!m) return null;
    const stop = m;
    const mx = m.x;
    const my = m.y;
    let tanMin = Infinity;
    p2 = m;
    do {
      if (hx >= p2.x && p2.x >= mx && hx !== p2.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p2.x, p2.y)) {
        const tan = Math.abs(hy - p2.y) / (hx - p2.x);
        if (locallyInside(p2, hole) && (tan < tanMin || tan === tanMin && (p2.x > m.x || p2.x === m.x && sectorContainsSector(m, p2)))) {
          m = p2;
          tanMin = tan;
        }
      }
      p2 = p2.next;
    } while (p2 !== stop);
    return m;
  }
  function sectorContainsSector(m, p2) {
    return area(m.prev, m, p2.prev) < 0 && area(p2.next, m, m.next) < 0;
  }
  function indexCurve(start, minX, minY, invSize) {
    let p2 = start;
    do {
      if (p2.z === 0) p2.z = zOrder(p2.x, p2.y, minX, minY, invSize);
      p2.prevZ = p2.prev;
      p2.nextZ = p2.next;
      p2 = p2.next;
    } while (p2 !== start);
    p2.prevZ.nextZ = null;
    p2.prevZ = null;
    sortLinked(p2);
  }
  function sortLinked(list) {
    let numMerges;
    let inSize = 1;
    do {
      let p2 = list;
      let e;
      list = null;
      let tail = null;
      numMerges = 0;
      while (p2) {
        numMerges++;
        let q = p2;
        let pSize = 0;
        for (let i = 0; i < inSize; i++) {
          pSize++;
          q = q.nextZ;
          if (!q) break;
        }
        let qSize = inSize;
        while (pSize > 0 || qSize > 0 && q) {
          if (pSize !== 0 && (qSize === 0 || !q || p2.z <= q.z)) {
            e = p2;
            p2 = p2.nextZ;
            pSize--;
          } else {
            e = q;
            q = q.nextZ;
            qSize--;
          }
          if (tail) tail.nextZ = e;
          else list = e;
          e.prevZ = tail;
          tail = e;
        }
        p2 = q;
      }
      tail.nextZ = null;
      inSize *= 2;
    } while (numMerges > 1);
    return list;
  }
  function zOrder(x, y, minX, minY, invSize) {
    x = (x - minX) * invSize | 0;
    y = (y - minY) * invSize | 0;
    x = (x | x << 8) & 16711935;
    x = (x | x << 4) & 252645135;
    x = (x | x << 2) & 858993459;
    x = (x | x << 1) & 1431655765;
    y = (y | y << 8) & 16711935;
    y = (y | y << 4) & 252645135;
    y = (y | y << 2) & 858993459;
    y = (y | y << 1) & 1431655765;
    return x | y << 1;
  }
  function getLeftmost(start) {
    let p2 = start, leftmost = start;
    do {
      if (p2.x < leftmost.x || p2.x === leftmost.x && p2.y < leftmost.y) leftmost = p2;
      p2 = p2.next;
    } while (p2 !== start);
    return leftmost;
  }
  function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }
  function pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, px, py) {
    return !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py);
  }
  function isValidDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) && // doesn't intersect other edges
    (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && // locally visible
    (area(a.prev, a, b.prev) || area(a, b.prev, b)) || // does not create opposite-facing sectors
    equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0);
  }
  function area(p2, q, r) {
    return (q.y - p2.y) * (r.x - q.x) - (q.x - p2.x) * (r.y - q.y);
  }
  function equals(p1, p2) {
    return p1.x === p2.x && p1.y === p2.y;
  }
  function intersects(p1, q1, p2, q2) {
    const o1 = sign(area(p1, q1, p2));
    const o2 = sign(area(p1, q1, q2));
    const o3 = sign(area(p2, q2, p1));
    const o4 = sign(area(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && onSegment(p2, q1, q2)) return true;
    return false;
  }
  function onSegment(p2, q, r) {
    return q.x <= Math.max(p2.x, r.x) && q.x >= Math.min(p2.x, r.x) && q.y <= Math.max(p2.y, r.y) && q.y >= Math.min(p2.y, r.y);
  }
  function sign(num) {
    return num > 0 ? 1 : num < 0 ? -1 : 0;
  }
  function intersectsPolygon(a, b) {
    let p2 = a;
    do {
      if (p2.i !== a.i && p2.next.i !== a.i && p2.i !== b.i && p2.next.i !== b.i && intersects(p2, p2.next, a, b)) return true;
      p2 = p2.next;
    } while (p2 !== a);
    return false;
  }
  function locallyInside(a, b) {
    return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
  }
  function middleInside(a, b) {
    let p2 = a;
    let inside = false;
    const px = (a.x + b.x) / 2;
    const py = (a.y + b.y) / 2;
    do {
      if (p2.y > py !== p2.next.y > py && p2.next.y !== p2.y && px < (p2.next.x - p2.x) * (py - p2.y) / (p2.next.y - p2.y) + p2.x)
        inside = !inside;
      p2 = p2.next;
    } while (p2 !== a);
    return inside;
  }
  function splitPolygon(a, b) {
    const a2 = createNode(a.i, a.x, a.y), b2 = createNode(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b;
    b.prev = a;
    a2.next = an;
    an.prev = a2;
    b2.next = a2;
    a2.prev = b2;
    bp.next = b2;
    b2.prev = bp;
    return b2;
  }
  function insertNode(i, x, y, last) {
    const p2 = createNode(i, x, y);
    if (!last) {
      p2.prev = p2;
      p2.next = p2;
    } else {
      p2.next = last.next;
      p2.prev = last;
      last.next.prev = p2;
      last.next = p2;
    }
    return p2;
  }
  function removeNode(p2) {
    p2.next.prev = p2.prev;
    p2.prev.next = p2.next;
    if (p2.prevZ) p2.prevZ.nextZ = p2.nextZ;
    if (p2.nextZ) p2.nextZ.prevZ = p2.prevZ;
  }
  function createNode(i, x, y) {
    return {
      i,
      // vertex index in coordinates array
      x,
      y,
      // vertex coordinates
      prev: null,
      // previous and next vertex nodes in a polygon ring
      next: null,
      z: 0,
      // z-order curve value
      prevZ: null,
      // previous and next nodes in z-order
      nextZ: null,
      steiner: false
      // indicates whether this is a steiner point
    };
  }
  function signedArea(data, start, end, dim) {
    let sum = 0;
    for (let i = start, j = end - dim; i < end; i += dim) {
      sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
      j = i;
    }
    return sum;
  }

  // ../../apps/deno-notebooks/tools/p5gpu_text/atlas.ts
  var GlyphAtlas = class {
    device;
    queue;
    format = "r8unorm";
    sampler;
    texture;
    version = 1;
    size;
    maxSize;
    maxEntries;
    /**
     * @deprecated No longer used. LRU eviction is always active.
     * Kept for API compatibility; reads/writes are ignored internally.
     */
    dynamicScratchMode;
    _padding;
    _inkAlphaThreshold = 128;
    _cursorX = 0;
    _cursorY = 0;
    _rowHeight = 0;
    _frameId = 0;
    _clearNextFrame = false;
    _needsGrowNextFrame = false;
    _evictionThreshold;
    _entries = /* @__PURE__ */ new Map();
    _pendingTextureDestroys = [];
    _stats = {
      hits: 0,
      misses: 0,
      uploads: 0,
      bytesUploaded: 0,
      grows: 0,
      clears: 0,
      evictions: 0
    };
    constructor(device2, queue, options = {}) {
      this.device = device2;
      this.queue = queue;
      this.size = Math.max(64, options.initialSize ?? 512);
      this.maxSize = Math.max(this.size, options.maxSize ?? 4096);
      this.maxEntries = Math.max(64, options.maxEntries ?? 8192);
      this.dynamicScratchMode = options.dynamicScratchMode ?? false;
      this._padding = Math.max(0, options.padding ?? 1);
      this._evictionThreshold = Math.max(1, options.evictionThreshold ?? 3);
      this.texture = this._createTexture(this.size);
      this.sampler = this.device.createSampler({
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear"
      });
    }
    beginFrame() {
      this._frameId += 1;
      this._stats = {
        hits: 0,
        misses: 0,
        uploads: 0,
        bytesUploaded: 0,
        grows: 0,
        clears: 0,
        evictions: 0
      };
      if (this._needsGrowNextFrame) {
        if (this._growTexture()) {
        }
        this._needsGrowNextFrame = false;
      }
      if (this._clearNextFrame) {
        this._clearAtlas();
        this._clearNextFrame = false;
        this._stats.clears += 1;
        return;
      }
      const staleThreshold = this._frameId - this._evictionThreshold;
      let evicted = 0;
      for (const [key, entry] of this._entries) {
        if (entry.lastUsedFrame < staleThreshold) {
          this._entries.delete(key);
          evicted++;
        }
      }
      this._stats.evictions = evicted;
      if (evicted > 0) {
        this._clearAtlas();
        this._stats.clears += 1;
      }
    }
    get entries() {
      return this._entries;
    }
    takeFrameStats() {
      return { ...this._stats };
    }
    textureView() {
      return this.texture.createView();
    }
    ensureGlyph(key, engine) {
      const existing = this._entries.get(key);
      if (existing) {
        existing.lastUsedFrame = this._frameId;
        this._stats.hits += 1;
        return existing;
      }
      this._stats.misses += 1;
      if (this._entries.size >= this.maxEntries) {
        this._clearNextFrame = true;
        return null;
      }
      const raster = engine.rasterizeGlyph(key);
      if (!raster || raster.width === 0 || raster.height === 0) {
        return null;
      }
      if (!this._glyphFitsInCurrentSize(raster)) {
        this._needsGrowNextFrame = true;
        return null;
      }
      const slot = this._allocate(raster.width, raster.height);
      if (!slot) {
        this._needsGrowNextFrame = true;
        return null;
      }
      this._upload(slot.x, slot.y, raster);
      const ink = this._computeInkXRange(raster);
      const inv = 1 / this.size;
      const entry = {
        key,
        x: slot.x,
        y: slot.y,
        width: raster.width,
        height: raster.height,
        inkX0: ink.x0,
        inkX1: ink.x1,
        left: raster.left,
        top: raster.top,
        u0: slot.x * inv,
        v0: slot.y * inv,
        u1: (slot.x + raster.width) * inv,
        v1: (slot.y + raster.height) * inv,
        lastUsedFrame: this._frameId
      };
      this._entries.set(key, entry);
      return entry;
    }
    clear() {
      this._clearAtlas();
    }
    dispose() {
      try {
        this.texture.destroy();
      } catch {
      }
      for (const pending of this._pendingTextureDestroys) {
        void pending.catch(() => {
        });
      }
      this._pendingTextureDestroys.length = 0;
      this._entries.clear();
    }
    _createTexture(size) {
      const texture = this.device.createTexture({
        size: { width: size, height: size, depthOrArrayLayers: 1 },
        format: this.format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
      });
      this._zeroTexture(texture, size);
      return texture;
    }
    /**
     * Check whether the raster fits within the current texture dimensions.
     * Does NOT attempt to grow -- caller must handle the failure.
     */
    _glyphFitsInCurrentSize(raster) {
      return raster.width + this._padding <= this.size && raster.height + this._padding <= this.size;
    }
    _growTexture() {
      if (this.size >= this.maxSize) {
        return false;
      }
      const prevTexture = this.texture;
      const prevSize = this.size;
      const nextSize = Math.min(this.maxSize, this.size * 2);
      const nextTexture = this._createTexture(nextSize);
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToTexture(
        { texture: prevTexture },
        { texture: nextTexture },
        { width: prevSize, height: prevSize, depthOrArrayLayers: 1 }
      );
      this.queue.submit([encoder.finish()]);
      this._deferTextureDestroy(prevTexture);
      this.size = nextSize;
      this.texture = nextTexture;
      const inv = 1 / this.size;
      for (const entry of this._entries.values()) {
        entry.u0 = entry.x * inv;
        entry.v0 = entry.y * inv;
        entry.u1 = (entry.x + entry.width) * inv;
        entry.v1 = (entry.y + entry.height) * inv;
      }
      this.version += 1;
      this._stats.grows += 1;
      return true;
    }
    _clearAtlas() {
      this._entries.clear();
      this._cursorX = 0;
      this._cursorY = 0;
      this._rowHeight = 0;
      this._zeroTexture(this.texture, this.size);
      this.version += 1;
    }
    _zeroTexture(texture, size) {
      const zeros = new Uint8Array(size * size);
      this.queue.writeTexture(
        { texture, origin: { x: 0, y: 0, z: 0 } },
        zeros,
        {
          offset: 0,
          bytesPerRow: size,
          rowsPerImage: size
        },
        {
          width: size,
          height: size,
          depthOrArrayLayers: 1
        }
      );
    }
    _allocate(width2, height2) {
      const paddedW = width2 + this._padding;
      const paddedH = height2 + this._padding;
      if (paddedW > this.size || paddedH > this.size) {
        return null;
      }
      if (this._cursorX + paddedW > this.size) {
        this._cursorX = 0;
        this._cursorY += this._rowHeight;
        this._rowHeight = 0;
      }
      if (this._cursorY + paddedH > this.size) {
        return null;
      }
      const out = { x: this._cursorX, y: this._cursorY };
      this._cursorX += paddedW;
      this._rowHeight = Math.max(this._rowHeight, paddedH);
      return out;
    }
    _upload(x, y, raster) {
      const upload = new Uint8Array(raster.pixels);
      this.queue.writeTexture(
        {
          texture: this.texture,
          origin: { x, y, z: 0 }
        },
        upload,
        {
          offset: 0,
          bytesPerRow: raster.width,
          rowsPerImage: raster.height
        },
        {
          width: raster.width,
          height: raster.height,
          depthOrArrayLayers: 1
        }
      );
      this._stats.uploads += 1;
      this._stats.bytesUploaded += upload.length;
    }
    _computeInkXRange(raster) {
      const { width: width2, height: height2, pixels } = raster;
      if (width2 <= 0 || height2 <= 0 || pixels.length === 0) {
        return { x0: 0, x1: width2 };
      }
      let minX = width2;
      let maxX = -1;
      const threshold = this._inkAlphaThreshold;
      for (let y = 0; y < height2; y++) {
        const row = y * width2;
        for (let x = 0; x < width2; x++) {
          if ((pixels[row + x] ?? 0) >= threshold) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      if (maxX < minX) {
        return { x0: 0, x1: width2 };
      }
      return { x0: minX, x1: maxX + 1 };
    }
    _deferTextureDestroy(texture) {
      const queue = this.queue;
      if (typeof queue.onSubmittedWorkDone === "function") {
        const pending = queue.onSubmittedWorkDone().catch(() => {
        }).then(() => {
          try {
            texture.destroy();
          } catch {
          }
        });
        this._pendingTextureDestroys.push(pending);
        if (this._pendingTextureDestroys.length > 24) {
          this._pendingTextureDestroys = this._pendingTextureDestroys.slice(-12);
        }
        return;
      }
      this._pendingTextureDestroys.push(Promise.resolve());
    }
  };

  // ../../apps/deno-notebooks/tools/p5gpu_renderer.ts
  var EPS = 1e-6;
  var CURVE_TOLERANCE = 0.5;
  var CURVE_MIN_SEGMENTS = 2;
  var CURVE_MAX_SEGMENTS = 64;
  var ENABLE_STENCIL_STROKES = true;
  var ENABLE_STENCIL_FILLS = true;
  var STENCIL_STROKE_SEGMENT_THRESHOLD = 64;
  var STENCIL_FILL_SEGMENT_THRESHOLD = 64;
  var STENCIL_TEXTURE_FORMAT = "depth24plus-stencil8";
  var GEOM_FLOATS_PER_VERTEX = 6;
  var GEOM_BYTES_PER_VERTEX = GEOM_FLOATS_PER_VERTEX * 4;
  var TEXT_FLOATS_PER_VERTEX = 8;
  var TEXT_BYTES_PER_VERTEX = TEXT_FLOATS_PER_VERTEX * 4;
  var P5_CONST = {
    CORNER: 0,
    CORNERS: 1,
    CENTER: 2,
    RADIUS: 3,
    LEFT: "left",
    RIGHT: "right",
    TOP: "top",
    BOTTOM: "bottom",
    BASELINE: "alphabetic",
    NORMAL: "normal",
    ITALIC: "italic",
    BOLD: "bold",
    BOLDITALIC: "bold italic",
    WORD: "WORD",
    CHAR: "CHAR",
    ROUND: 10,
    SQUARE: 11,
    PROJECT: 12,
    MITER: 13,
    BEVEL: 14,
    CLOSE: 20,
    POINTS: 30,
    LINES: 31,
    TRIANGLES: 32,
    TRIANGLE_FAN: 33,
    TRIANGLE_STRIP: 34,
    QUADS: 35,
    QUAD_STRIP: 36,
    OPEN: 40,
    CHORD: 41,
    PIE: 42,
    RGB: 50,
    HSB: 51,
    HSL: 52,
    BLEND: 60,
    ADD: 61,
    DARKEST: 62,
    LIGHTEST: 63,
    DIFFERENCE: 64,
    EXCLUSION: 65,
    MULTIPLY: 66,
    SCREEN: 67,
    REPLACE: 68,
    REMOVE: 69,
    OVERLAY: 70,
    HARD_LIGHT: 71,
    SOFT_LIGHT: 72,
    DODGE: 73,
    BURN: 74
  };
  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }
  function toNumber(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }
  function identityMatrix() {
    return new Float32Array([1, 0, 0, 1, 0, 0]);
  }
  function cloneState(state) {
    return {
      matrix: new Float32Array(state.matrix),
      fillEnabled: state.fillEnabled,
      fillSet: state.fillSet,
      fillColor: [...state.fillColor],
      strokeEnabled: state.strokeEnabled,
      strokeSet: state.strokeSet,
      strokeColor: [...state.strokeColor],
      strokeWeight: state.strokeWeight,
      strokeCap: state.strokeCap,
      strokeJoin: state.strokeJoin,
      strokeMiterLimit: state.strokeMiterLimit,
      imageMode: state.imageMode,
      tint: [...state.tint],
      rectMode: state.rectMode,
      ellipseMode: state.ellipseMode,
      colorMode: state.colorMode,
      colorMaxes: [...state.colorMaxes],
      blendMode: state.blendMode,
      curveTightness: state.curveTightness,
      curveDetail: state.curveDetail,
      bezierDetail: state.bezierDetail,
      eraseMode: state.eraseMode,
      eraseFillStrength: state.eraseFillStrength,
      eraseStrokeStrength: state.eraseStrokeStrength,
      textFontFamily: state.textFontFamily,
      textSize: state.textSize,
      textLeading: state.textLeading,
      textLeadingSet: state.textLeadingSet,
      textAlignH: state.textAlignH,
      textAlignV: state.textAlignV,
      textStyle: state.textStyle,
      textWeight: state.textWeight,
      textWeightSet: state.textWeightSet,
      textWrap: state.textWrap,
      textDirection: state.textDirection,
      textAxes: { ...state.textAxes },
      textAxisQuantization: state.textAxisQuantization,
      textDynamicScratch: state.textDynamicScratch
    };
  }
  function multiplyAffineInPlace(m, n0, n1, n2, n3, n4, n5) {
    const a = m[0];
    const b = m[1];
    const c = m[2];
    const d = m[3];
    const tx = m[4];
    const ty = m[5];
    m[0] = a * n0 + c * n1;
    m[1] = b * n0 + d * n1;
    m[2] = a * n2 + c * n3;
    m[3] = b * n2 + d * n3;
    m[4] = a * n4 + c * n5 + tx;
    m[5] = b * n4 + d * n5 + ty;
  }
  function transformPoint(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  function normalize(vx, vy) {
    const len = Math.hypot(vx, vy);
    if (len <= EPS) return [0, 0];
    return [vx / len, vy / len];
  }
  function orient(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }
  function pointOnSegment(p2, a, b) {
    return Math.abs(orient(a, b, p2)) <= 1e-5 && p2[0] >= Math.min(a[0], b[0]) - 1e-5 && p2[0] <= Math.max(a[0], b[0]) + 1e-5 && p2[1] >= Math.min(a[1], b[1]) - 1e-5 && p2[1] <= Math.max(a[1], b[1]) + 1e-5;
  }
  function segmentsIntersect(a0, a1, b0, b1) {
    const o1 = orient(a0, a1, b0);
    const o2 = orient(a0, a1, b1);
    const o3 = orient(b0, b1, a0);
    const o4 = orient(b0, b1, a1);
    if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) {
      return true;
    }
    return pointOnSegment(b0, a0, a1) || pointOnSegment(b1, a0, a1) || pointOnSegment(a0, b0, b1) || pointOnSegment(a1, b0, b1);
  }
  function hsbToRgb(h, s, v) {
    const hh = (h % 1 + 1) % 1;
    const i = Math.floor(hh * 6);
    const f = hh * 6 - i;
    const p2 = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0:
        return [v, t, p2];
      case 1:
        return [q, v, p2];
      case 2:
        return [p2, v, t];
      case 3:
        return [p2, q, v];
      case 4:
        return [t, p2, v];
      default:
        return [v, p2, q];
    }
  }
  function hslToRgb(h, s, l) {
    const hh = (h % 1 + 1) % 1;
    if (s <= EPS) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p2 = 2 * l - q;
    const hueToRgb = (t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p2 + (q - p2) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p2 + (q - p2) * (2 / 3 - tt) * 6;
      return p2;
    };
    return [hueToRgb(hh + 1 / 3), hueToRgb(hh), hueToRgb(hh - 1 / 3)];
  }
  function parseRgbLikeComponent(raw) {
    const trimmed = raw.trim();
    if (trimmed.endsWith("%")) {
      const value2 = Number(trimmed.slice(0, -1));
      if (!Number.isFinite(value2)) return 0;
      return clamp(value2 / 100) * 255;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return 0;
    return value;
  }
  function alignTo(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
  }
  function createDefaultState() {
    return {
      matrix: identityMatrix(),
      fillEnabled: true,
      fillSet: false,
      fillColor: [1, 1, 1, 1],
      strokeEnabled: true,
      strokeSet: false,
      strokeColor: [0, 0, 0, 1],
      strokeWeight: 1,
      strokeCap: P5_CONST.ROUND,
      strokeJoin: P5_CONST.MITER,
      strokeMiterLimit: 4,
      imageMode: P5_CONST.CORNER,
      tint: [1, 1, 1, 1],
      rectMode: P5_CONST.CORNER,
      ellipseMode: P5_CONST.CENTER,
      colorMode: P5_CONST.RGB,
      colorMaxes: [255, 255, 255, 255],
      blendMode: P5_CONST.BLEND,
      curveTightness: 0,
      curveDetail: 1,
      bezierDetail: 1,
      eraseMode: false,
      eraseFillStrength: 255,
      eraseStrokeStrength: 255,
      textFontFamily: "Noto Sans",
      textSize: 12,
      textLeading: 12 * 1.275,
      textLeadingSet: false,
      textAlignH: "left",
      textAlignV: "alphabetic",
      textStyle: "normal",
      textWeight: 400,
      textWeightSet: false,
      textWrap: "WORD",
      textDirection: "inherit",
      textAxes: {},
      textAxisQuantization: 1,
      textDynamicScratch: false
    };
  }
  function resolveBlendState(mode) {
    switch (mode) {
      case P5_CONST.ADD:
        return {
          color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one" },
          alpha: { operation: "add", srcFactor: "one", dstFactor: "one" }
        };
      case P5_CONST.MULTIPLY:
        return {
          color: { operation: "add", srcFactor: "dst", dstFactor: "one-minus-src-alpha" },
          alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" }
        };
      case P5_CONST.SCREEN:
        return {
          color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src" },
          alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" }
        };
      case P5_CONST.REPLACE:
        return {
          color: { operation: "add", srcFactor: "one", dstFactor: "zero" },
          alpha: { operation: "add", srcFactor: "one", dstFactor: "zero" }
        };
      case P5_CONST.BLEND:
      default:
        return {
          color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
          alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" }
        };
    }
  }
  var GEOM_SHADER_SOURCE = (
    /* wgsl */
    `
struct CanvasUniform {
  size: vec2f,
}

@group(0) @binding(0) var<uniform> uCanvas: CanvasUniform;

struct VertexIn {
  @location(0) position: vec2f,
  @location(1) color: vec4f,
}

struct VertexOut {
  @builtin(position) clipPos: vec4f,
  @location(0) color: vec4f,
}

@vertex
fn vsMain(v: VertexIn) -> VertexOut {
  let ndc = vec2f(
    (v.position.x / uCanvas.size.x) * 2.0 - 1.0,
    -((v.position.y / uCanvas.size.y) * 2.0 - 1.0)
  );

  var out: VertexOut;
  out.clipPos = vec4f(ndc, 0.0, 1.0);
  out.color = v.color;
  return out;
}

@fragment
fn fsMain(v: VertexOut) -> @location(0) vec4f {
  return v.color;
}
`
  );
  var TEXT_SHADER_SOURCE = (
    /* wgsl */
    `
struct CanvasUniform {
  size: vec2f,
}

@group(0) @binding(0) var<uniform> uCanvas: CanvasUniform;
@group(1) @binding(0) var uAtlas: texture_2d<f32>;
@group(1) @binding(1) var uSampler: sampler;

struct VertexIn {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec4f,
}

struct VertexOut {
  @builtin(position) clipPos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
}

@vertex
fn vsText(v: VertexIn) -> VertexOut {
  let ndc = vec2f(
    (v.position.x / uCanvas.size.x) * 2.0 - 1.0,
    -((v.position.y / uCanvas.size.y) * 2.0 - 1.0)
  );

  var out: VertexOut;
  out.clipPos = vec4f(ndc, 0.0, 1.0);
  out.uv = v.uv;
  out.color = v.color;
  return out;
}

@fragment
fn fsText(v: VertexOut) -> @location(0) vec4f {
  let alpha = textureSample(uAtlas, uSampler, v.uv).r;
  return vec4f(v.color.rgb, v.color.a * alpha);
}
`
  );
  var IMAGE_SHADER_SOURCE = TEXT_SHADER_SOURCE.replace(
    "let alpha = textureSample(uAtlas, uSampler, v.uv).r;\n  return vec4f(v.color.rgb, v.color.a * alpha);",
    "return textureSample(uAtlas, uSampler, v.uv) * v.color;"
  );
  var P5GPU = class {
    constructor(device2, opts, host) {
      this.host = host;
      this.device = device2;
      this.width = Math.max(1, Math.floor(opts.width));
      this.height = Math.max(1, Math.floor(opts.height));
      this.format = opts.format ?? "rgba8unorm";
      this.optimizedMode = opts.optimizedMode ?? false;
      this._textEngine = host.createTextEngine();
      this.outputTexture = this.device.createTexture({
        size: { width: this.width, height: this.height },
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
      });
      this._sampleCount = Math.max(1, Math.floor(opts.sampleCount ?? 4));
      if (this._sampleCount > 1) {
        try {
          this._msaaColorTexture = this.device.createTexture({
            size: { width: this.width, height: this.height },
            sampleCount: this._sampleCount,
            format: this.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT
          });
        } catch (_) {
          this._sampleCount = 1;
          this._msaaColorTexture = null;
        }
      }
      this._state = createDefaultState();
      this._state.strokeColor = [0, 0, 0, 1];
      this._state.fillColor = [1, 1, 1, 1];
      this._geomShaderModule = this.device.createShaderModule({ code: GEOM_SHADER_SOURCE });
      this._textShaderModule = this.device.createShaderModule({ code: TEXT_SHADER_SOURCE });
      this._imageShaderModule = this.device.createShaderModule({ code: IMAGE_SHADER_SOURCE });
      this._canvasBindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: "uniform" }
          }
        ]
      });
      this._textBindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float", viewDimension: "2d", multisampled: false }
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: "filtering" }
          }
        ]
      });
      this._geomPipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this._canvasBindGroupLayout] });
      this._textPipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [this._canvasBindGroupLayout, this._textBindGroupLayout]
      });
      this._uniformBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(this._uniformBuffer, 0, new Float32Array([this.width, this.height]));
      this._canvasBindGroup = this.device.createBindGroup({
        layout: this._canvasBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }]
      });
      if (this._textEngine) {
        this._textAtlas = new GlyphAtlas(this.device, this.device.queue, {
          initialSize: 512,
          maxSize: 4096,
          maxEntries: 65536
        });
      }
      this._textMetricsDebug = host.env?.("P5_TEXT_METRICS_DEBUG") === "1";
      this._textMetricsDebugVerbose = host.env?.("P5_TEXT_METRICS_DEBUG_VERBOSE") === "1";
      this._textAtlasGrowthDebug = host.env?.("P5_TEXT_ATLAS_GROW_DEBUG") === "1";
      this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
      this._geomStagingBuffer = new Float32Array(4096);
    }
    CORNER = P5_CONST.CORNER;
    CORNERS = P5_CONST.CORNERS;
    CENTER = P5_CONST.CENTER;
    RADIUS = P5_CONST.RADIUS;
    LEFT = P5_CONST.LEFT;
    RIGHT = P5_CONST.RIGHT;
    TOP = P5_CONST.TOP;
    BOTTOM = P5_CONST.BOTTOM;
    BASELINE = P5_CONST.BASELINE;
    NORMAL = P5_CONST.NORMAL;
    ITALIC = P5_CONST.ITALIC;
    BOLD = P5_CONST.BOLD;
    BOLDITALIC = P5_CONST.BOLDITALIC;
    WORD = P5_CONST.WORD;
    CHAR = P5_CONST.CHAR;
    ROUND = P5_CONST.ROUND;
    SQUARE = P5_CONST.SQUARE;
    PROJECT = P5_CONST.PROJECT;
    MITER = P5_CONST.MITER;
    BEVEL = P5_CONST.BEVEL;
    CLOSE = P5_CONST.CLOSE;
    POINTS = P5_CONST.POINTS;
    LINES = P5_CONST.LINES;
    TRIANGLES = P5_CONST.TRIANGLES;
    TRIANGLE_FAN = P5_CONST.TRIANGLE_FAN;
    TRIANGLE_STRIP = P5_CONST.TRIANGLE_STRIP;
    QUADS = P5_CONST.QUADS;
    QUAD_STRIP = P5_CONST.QUAD_STRIP;
    OPEN = P5_CONST.OPEN;
    CHORD = P5_CONST.CHORD;
    PIE = P5_CONST.PIE;
    RGB = P5_CONST.RGB;
    HSB = P5_CONST.HSB;
    HSL = P5_CONST.HSL;
    BLEND = P5_CONST.BLEND;
    ADD = P5_CONST.ADD;
    DARKEST = P5_CONST.DARKEST;
    LIGHTEST = P5_CONST.LIGHTEST;
    DIFFERENCE = P5_CONST.DIFFERENCE;
    EXCLUSION = P5_CONST.EXCLUSION;
    MULTIPLY = P5_CONST.MULTIPLY;
    SCREEN = P5_CONST.SCREEN;
    REPLACE = P5_CONST.REPLACE;
    REMOVE = P5_CONST.REMOVE;
    OVERLAY = P5_CONST.OVERLAY;
    HARD_LIGHT = P5_CONST.HARD_LIGHT;
    SOFT_LIGHT = P5_CONST.SOFT_LIGHT;
    DODGE = P5_CONST.DODGE;
    BURN = P5_CONST.BURN;
    PI = Math.PI;
    TWO_PI = Math.PI * 2;
    HALF_PI = Math.PI * 0.5;
    QUARTER_PI = Math.PI * 0.25;
    TAU = Math.PI * 2;
    device;
    width;
    height;
    format;
    outputTexture;
    optimizedMode;
    pixels;
    _state;
    _stack = [];
    _shape = null;
    _geomShaderModule;
    _textShaderModule;
    _imageShaderModule;
    _imageSamplers = /* @__PURE__ */ new Map();
    _uniformBuffer;
    _canvasBindGroupLayout;
    _textBindGroupLayout;
    _canvasBindGroup;
    _geomPipelineLayout;
    _textPipelineLayout;
    _geomPipelineCache = /* @__PURE__ */ new Map();
    _textPipelineCache = /* @__PURE__ */ new Map();
    _strokeStencilPipelineCache = /* @__PURE__ */ new Map();
    _stencilCoverPipelineCache = /* @__PURE__ */ new Map();
    _fillStencilPipelineCache = /* @__PURE__ */ new Map();
    _fillCoverPipelineCache = /* @__PURE__ */ new Map();
    _geomStagingBuffer;
    _geomStagingCursor = 0;
    _geomVertexCount = 0;
    _textVertices = [];
    _textVertexCount = 0;
    _batches = [];
    _geomVertexBuffer = null;
    _geomVertexBufferCapacityBytes = 0;
    _textVertexBuffer = null;
    _textVertexBufferCapacityBytes = 0;
    _sampleCount = 1;
    _msaaColorTexture = null;
    _stencilTexture = null;
    _stencilTextureSampleCount = 0;
    _stencilUnavailable = false;
    _textEngine = null;
    _textAtlas = null;
    _textBindGroup = null;
    _textBindGroupAtlasVersion = -1;
    _textLastLayout = {
      tightWidth: 0,
      fontWidth: 0,
      ascent: 0,
      descent: 0,
      fontAscent: 0,
      fontDescent: 0,
      fontCapHeight: 0,
      totalHeight: 0
    };
    _textMetricsDebug = false;
    _textMetricsDebugVerbose = false;
    _textMetricsDebugBudget = 48;
    _textAtlasGrowthDebug = false;
    _textAtlasGrowthDebugBudget = 32;
    _clearRequested = false;
    _clearColor = [0, 0, 0, 0];
    _hasRenderedFrame = false;
    beginFrame() {
      this._geomStagingCursor = 0;
      this._geomVertexCount = 0;
      this._textVertices.length = 0;
      this._textVertexCount = 0;
      this._batches.length = 0;
      this._shape = null;
      this._clearRequested = false;
      this._clearColor = [0, 0, 0, 0];
      this._textAtlas?.beginFrame();
      this._textAtlasGrowthDebugBudget = 32;
    }
    endFrame() {
      const encoder = this.device.createCommandEncoder();
      const useLoadOp = !this._clearRequested && this._hasRenderedFrame;
      const loadOp = useLoadOp ? "load" : "clear";
      const isStencilBatch = (batch) => batch.kind === "stencilStrokeMask" || batch.kind === "stencilStrokeCover" || batch.kind === "stencilFillMask" || batch.kind === "stencilFillCover";
      const hasStencilCommands = this._batches.some(isStencilBatch);
      const frameSampleCount = hasStencilCommands ? 1 : !useLoadOp && this._msaaColorTexture && this._sampleCount > 1 ? this._sampleCount : 1;
      const clearColor = {
        r: this._clearColor[0],
        g: this._clearColor[1],
        b: this._clearColor[2],
        a: this._clearColor[3]
      };
      const outputView = this.outputTexture.createView();
      const msaaView = frameSampleCount > 1 ? this._msaaColorTexture.createView() : null;
      const stencilView = hasStencilCommands ? this._ensureStencilTexture(frameSampleCount)?.createView() ?? null : null;
      let hasGeom = false;
      let hasText = false;
      if (this._geomVertexCount > 0) {
        const byteLength = this._geomStagingCursor * 4;
        this._ensureGeomVertexBuffer(byteLength);
        this.device.queue.writeBuffer(this._geomVertexBuffer, 0, this._geomStagingBuffer.buffer, 0, byteLength);
        hasGeom = true;
      }
      if (this._textVertexCount > 0) {
        const textData = new Float32Array(this._textVertices);
        this._ensureTextVertexBuffer(textData.byteLength);
        this.device.queue.writeBuffer(this._textVertexBuffer, 0, textData.buffer, textData.byteOffset, textData.byteLength);
        hasText = this._syncTextBindGroup() || this._batches.some((batch) => batch.kind === "image");
      }
      let nextColorLoadOp = loadOp;
      const beginRenderPass = (withStencil) => {
        const descriptor = {
          colorAttachments: [
            {
              view: msaaView ?? outputView,
              resolveTarget: msaaView ? outputView : void 0,
              loadOp: nextColorLoadOp,
              storeOp: "store",
              clearValue: clearColor
            }
          ]
        };
        if (withStencil && stencilView) {
          descriptor.depthStencilAttachment = this._stencilRenderPassAttachment(stencilView);
        }
        const pass = encoder.beginRenderPass(descriptor);
        pass.setBindGroup(0, this._canvasBindGroup);
        nextColorLoadOp = "load";
        return pass;
      };
      const drawBatch = (pass, batch, stencilPass, state) => {
        if (batch.vertexCount <= 0) return;
        if (stencilPass) {
          if (!hasGeom || !this._geomVertexBuffer || !stencilView) return;
          const pipeline2 = batch.kind === "stencilStrokeMask" ? this._getStrokeStencilPipeline(frameSampleCount) : batch.kind === "stencilFillMask" ? this._getFillStencilPipeline(frameSampleCount) : batch.kind === "stencilFillCover" ? this._getFillCoverPipeline(batch.blendMode, frameSampleCount) : this._getStencilCoverPipeline(batch.blendMode, frameSampleCount);
          if (pipeline2 !== state.lastPipeline) {
            pass.setPipeline(pipeline2);
            state.lastPipeline = pipeline2;
          }
          if (this._geomVertexBuffer !== state.lastVB) {
            pass.setVertexBuffer(0, this._geomVertexBuffer);
            state.lastVB = this._geomVertexBuffer;
          }
          pass.setStencilReference(batch.kind === "stencilFillCover" ? 0 : 1);
          pass.draw(batch.vertexCount, 1, batch.startVertex, 0);
          state.lastTextBG = false;
          return;
        }
        if (batch.kind === "stencilStrokeCover" || batch.kind === "stencilFillCover") return;
        if (batch.isText) {
          const isImage = batch.kind === "image";
          const bindGroup = isImage ? batch.imageBindGroup : this._textBindGroup;
          if (!hasText || !this._textVertexBuffer || !bindGroup) return;
          const pipeline2 = this._getTextPipeline(batch.blendMode, frameSampleCount, isImage);
          if (pipeline2 !== state.lastPipeline) {
            pass.setPipeline(pipeline2);
            state.lastPipeline = pipeline2;
          }
          if (isImage || !state.lastTextBG) pass.setBindGroup(1, bindGroup);
          state.lastTextBG = !isImage;
          if (this._textVertexBuffer !== state.lastVB) {
            pass.setVertexBuffer(0, this._textVertexBuffer);
            state.lastVB = this._textVertexBuffer;
          }
          pass.draw(batch.vertexCount, 1, batch.startVertex, 0);
          return;
        }
        if (!hasGeom || !this._geomVertexBuffer) return;
        const pipeline = this._getGeomPipeline(batch.blendMode, frameSampleCount);
        if (pipeline !== state.lastPipeline) {
          pass.setPipeline(pipeline);
          state.lastPipeline = pipeline;
        }
        if (this._geomVertexBuffer !== state.lastVB) {
          pass.setVertexBuffer(0, this._geomVertexBuffer);
          state.lastVB = this._geomVertexBuffer;
        }
        state.lastTextBG = false;
        pass.draw(batch.vertexCount, 1, batch.startVertex, 0);
      };
      if (!hasGeom && !hasText) {
        const pass = beginRenderPass(false);
        pass.end();
      } else {
        let i = 0;
        while (i < this._batches.length) {
          while (i < this._batches.length && this._batches[i].vertexCount <= 0) i++;
          if (i >= this._batches.length) break;
          const firstBatch = this._batches[i];
          const stencilPass = !!stencilView && isStencilBatch(firstBatch);
          const pass = beginRenderPass(stencilPass);
          const state = {
            lastPipeline: null,
            lastVB: null,
            lastTextBG: false
          };
          while (i < this._batches.length) {
            const batch = this._batches[i];
            const batchStencilPass = !!stencilView && isStencilBatch(batch);
            if (batch.vertexCount > 0 && batchStencilPass !== stencilPass) break;
            drawBatch(pass, batch, stencilPass, state);
            i++;
          }
          pass.end();
        }
      }
      this.device.queue.submit([encoder.finish()]);
      this._hasRenderedFrame = true;
      return this.outputTexture;
    }
    dispose() {
      this._batches.length = 0;
      try {
        this._geomVertexBuffer?.destroy();
      } catch (_) {
      }
      try {
        this._textVertexBuffer?.destroy();
      } catch (_) {
      }
      try {
        this._uniformBuffer.destroy();
      } catch (_) {
      }
      try {
        this._msaaColorTexture?.destroy();
      } catch (_) {
      }
      try {
        this._stencilTexture?.destroy();
      } catch (_) {
      }
      try {
        this.outputTexture.destroy();
      } catch (_) {
      }
      try {
        this._textAtlas?.dispose();
      } catch (_) {
      }
      try {
        this._textEngine?.dispose();
      } catch (_) {
      }
    }
    push() {
      this._stack.push(cloneState(this._state));
    }
    pop() {
      const prev = this._stack.pop();
      if (prev) this._state = prev;
    }
    resetMatrix() {
      this._state.matrix.set(identityMatrix());
    }
    translate(x, y) {
      multiplyAffineInPlace(this._state.matrix, 1, 0, 0, 1, toNumber(x), toNumber(y));
    }
    rotate(angle) {
      const theta = toNumber(angle);
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      multiplyAffineInPlace(this._state.matrix, c, s, -s, c, 0, 0);
    }
    scale(s, sy) {
      const sx = toNumber(s, 1);
      const y = sy === void 0 ? sx : toNumber(sy, sx);
      multiplyAffineInPlace(this._state.matrix, sx, 0, 0, y, 0, 0);
    }
    shearX(angle) {
      multiplyAffineInPlace(this._state.matrix, 1, 0, Math.tan(toNumber(angle)), 1, 0, 0);
    }
    shearY(angle) {
      multiplyAffineInPlace(this._state.matrix, 1, Math.tan(toNumber(angle)), 0, 1, 0, 0);
    }
    applyMatrix(a, b, c, d, e, f) {
      multiplyAffineInPlace(this._state.matrix, toNumber(a), toNumber(b), toNumber(c), toNumber(d), toNumber(e), toNumber(f));
    }
    rectMode(mode) {
      this._state.rectMode = toNumber(mode, this.CORNER);
    }
    ellipseMode(mode) {
      this._state.ellipseMode = toNumber(mode, this.CENTER);
    }
    colorMode(mode, max1 = 255, max2 = max1, max3 = max1, maxA = 255) {
      this._state.colorMode = toNumber(mode, this.RGB);
      this._state.colorMaxes = [
        Math.max(EPS, toNumber(max1, 255)),
        Math.max(EPS, toNumber(max2, 255)),
        Math.max(EPS, toNumber(max3, 255)),
        Math.max(EPS, toNumber(maxA, 255))
      ];
    }
    blendMode(mode) {
      this._state.blendMode = toNumber(mode, this.BLEND);
    }
    erase(strengthFill = 255, strengthStroke = 255) {
      this._state.eraseMode = true;
      this._state.eraseFillStrength = clamp(toNumber(strengthFill, 255), 0, 255);
      this._state.eraseStrokeStrength = clamp(toNumber(strengthStroke, 255), 0, 255);
    }
    noErase() {
      this._state.eraseMode = false;
    }
    fill(v1, v2, v3, a) {
      this._state.fillEnabled = true;
      this._state.fillSet = true;
      this._state.fillColor = this._parseColor(v1, v2, v3, a);
    }
    noFill() {
      this._state.fillEnabled = false;
      this._state.fillSet = true;
    }
    stroke(v1, v2, v3, a) {
      this._state.strokeEnabled = true;
      this._state.strokeSet = true;
      this._state.strokeColor = this._parseColor(v1, v2, v3, a);
    }
    noStroke() {
      this._state.strokeEnabled = false;
      this._state.strokeSet = true;
    }
    strokeWeight(weight) {
      this._state.strokeWeight = Math.max(0, toNumber(weight, 1));
    }
    strokeCap(cap) {
      this._state.strokeCap = toNumber(cap, this.ROUND);
    }
    strokeJoin(join) {
      this._state.strokeJoin = toNumber(join, this.MITER);
    }
    strokeMiterLimit(limit) {
      this._state.strokeMiterLimit = Math.max(1, toNumber(limit, 4));
    }
    curveTightness(amount) {
      this._state.curveTightness = toNumber(amount);
    }
    curveDetail(d) {
      if (d === void 0) return this._state.curveDetail;
      this._state.curveDetail = Math.max(0, toNumber(d));
    }
    bezierDetail(d) {
      if (d === void 0) return this._state.bezierDetail;
      this._state.bezierDetail = Math.max(0, toNumber(d));
    }
    textAlign(horiz, vert) {
      if (horiz === void 0) {
        return { horizontal: this._state.textAlignH, vertical: this._state.textAlignV };
      }
      this._state.textAlignH = this._parseTextAlignH(horiz);
      if (vert !== void 0) {
        this._state.textAlignV = this._parseTextAlignV(vert);
      }
    }
    textFont(font, size) {
      if (font === void 0) return this._state.textFontFamily;
      if (typeof font === "string" && font.trim().length > 0) {
        this._state.textFontFamily = font.trim();
      }
      if (size !== void 0) {
        this.textSize(size);
      }
    }
    textSize(size) {
      if (size === void 0) return this._state.textSize;
      const nextSize = Math.max(1, toNumber(size, this._state.textSize));
      this._state.textSize = nextSize;
      if (!this._state.textLeadingSet) {
        this._state.textLeading = nextSize * 1.275;
      }
    }
    textLeading(leading) {
      if (leading === void 0) return this._state.textLeading;
      this._state.textLeading = Math.max(1, toNumber(leading, this._state.textLeading));
      this._state.textLeadingSet = true;
    }
    textStyle(style) {
      if (style === void 0) return this._state.textStyle;
      this._state.textStyle = this._parseTextStyle(style);
    }
    textWeight(weight) {
      if (weight === void 0) return this._state.textWeight;
      this._state.textWeight = toNumber(weight, this._state.textWeight);
      this._state.textWeightSet = true;
      this._state.textAxes = {
        ...this._state.textAxes,
        wght: this._state.textWeight
      };
    }
    textWrap(style) {
      if (style === void 0) return this._state.textWrap;
      this._state.textWrap = String(style).toUpperCase() === "CHAR" ? "CHAR" : "WORD";
    }
    textDirection(direction) {
      if (direction === void 0) return this._state.textDirection;
      const normalized = String(direction).toLowerCase();
      if (normalized === "ltr" || normalized === "rtl") {
        this._state.textDirection = normalized;
        return;
      }
      this._state.textDirection = "inherit";
    }
    textAxisQuantization(step) {
      if (step === void 0) return this._state.textAxisQuantization;
      const next = toNumber(step, this._state.textAxisQuantization);
      this._state.textAxisQuantization = Number.isFinite(next) ? Math.max(0, next) : this._state.textAxisQuantization;
    }
    textDynamicMode(enabled) {
      if (enabled === void 0) return this._state.textDynamicScratch;
      this._state.textDynamicScratch = Boolean(enabled);
    }
    textVariationAxes(axes) {
      if (axes === void 0) return { ...this._state.textAxes };
      const next = {};
      for (const [tag, value] of Object.entries(axes)) {
        if (tag.length !== 4) continue;
        const num = toNumber(value);
        if (!Number.isFinite(num)) continue;
        next[tag] = num;
      }
      this._state.textAxes = next;
    }
    textProperty(prop, value) {
      const key = prop.trim();
      if (value === void 0) {
        if (key === "fontVariationSettings") return this._formatVariationSettings(this._state.textAxes);
        if (key === "direction") return this._state.textDirection;
        if (key === "textAlign") return this._state.textAlignH;
        if (key === "textBaseline") return this._state.textAlignV;
        return void 0;
      }
      if (key === "fontVariationSettings" && typeof value === "string") {
        const parsed = this._parseVariationSettings(value);
        this._state.textAxes = parsed;
        if (Number.isFinite(parsed.wght)) {
          this._state.textWeight = toNumber(parsed.wght, this._state.textWeight);
          this._state.textWeightSet = true;
        }
        return this;
      }
      if (key === "direction") {
        this.textDirection(value);
        return this;
      }
      if (key === "textAlign") {
        this.textAlign(value);
        return this;
      }
      if (key === "textBaseline") {
        this.textAlign(this._state.textAlignH, value);
        return this;
      }
      return this;
    }
    textProperties(values) {
      if (values === void 0) {
        return {
          textAlign: this._state.textAlignH,
          textBaseline: this._state.textAlignV,
          direction: this._state.textDirection,
          fontVariationSettings: this._formatVariationSettings(this._state.textAxes)
        };
      }
      for (const [key, value] of Object.entries(values)) {
        this.textProperty(key, value);
      }
    }
    async loadFont(path, name) {
      const text = this._requireTextSubsystem();
      if (!text) {
        throw new Error("P5GPU text subsystem is unavailable. Build native text engine first.");
      }
      const bytes = await this.host.readFile(path);
      const ok = text.engine.loadFontBytes(bytes);
      if (!ok) throw new Error(`Failed to load font bytes from ${String(path)}`);
      if (name && name.trim().length > 0) {
        this._state.textFontFamily = name.trim();
        return name.trim();
      }
      return String(path);
    }
    text(str, x, y, maxWidth, maxHeight) {
      const text = this._requireTextSubsystem();
      if (!text) return;
      const source = String(str ?? "");
      let tx = toNumber(x);
      let ty = toNumber(y);
      let width2 = null;
      let height2 = null;
      if (maxWidth !== void 0) {
        const rect = this._resolveTextRect(tx, ty, toNumber(maxWidth), maxHeight === void 0 ? void 0 : toNumber(maxHeight));
        tx = rect.x;
        ty = rect.y;
        width2 = Math.max(0, rect.width);
        height2 = rect.height === void 0 ? null : Math.max(0, rect.height);
      }
      const layout = this._layoutText(source, width2, height2);
      const tightWidth = layout.tightWidth;
      this._textLastLayout = {
        tightWidth,
        fontWidth: layout.fontWidth,
        ascent: layout.ascent,
        descent: layout.descent,
        fontAscent: layout.fontAscent,
        fontDescent: layout.fontDescent,
        fontCapHeight: layout.fontCapHeight,
        totalHeight: layout.totalHeight
      };
      if (layout.glyphs.length === 0) return;
      if (width2 === null) {
        if (this._state.textAlignH === "center") tx -= tightWidth * 0.5;
        else if (this._state.textAlignH === "right") tx -= tightWidth;
      }
      const layoutTopY = this._resolveTextTopY(ty, height2, layout);
      const blend = this._currentBlendMode();
      const fillColor = this._state.fillSet ? this._effectiveFillColor() : [0, 0, 0, 1];
      const strokeColor = this._effectiveStrokeColor();
      const drawFill = this._state.fillSet ? this._state.fillEnabled : true;
      const drawStroke = this._state.strokeSet && this._state.strokeEnabled && this._state.strokeWeight > 0;
      const strokeOffset = Math.max(1, this._state.strokeWeight * 0.5);
      for (const glyph of layout.glyphs) {
        const atlasGlyph = text.atlas.ensureGlyph(glyph.key, text.engine);
        if (!atlasGlyph) continue;
        const gx = tx + glyph.x + atlasGlyph.left;
        const gy = Math.round(layoutTopY + glyph.y - atlasGlyph.top);
        if (drawStroke) {
          this._emitTextStroke(gx, gy, atlasGlyph, strokeColor, strokeOffset, blend);
        }
        if (drawFill) {
          this._emitTextQuad(gx, gy, atlasGlyph, fillColor, blend);
        }
      }
    }
    textWidth(text) {
      if (!this._requireTextSubsystem()) return 0;
      const source = String(text ?? "");
      const layout = this._layoutText(source, null, null);
      const tightWidth = layout.tightWidth;
      this._textLastLayout = {
        tightWidth,
        fontWidth: layout.fontWidth,
        ascent: layout.ascent,
        descent: layout.descent,
        fontAscent: layout.fontAscent,
        fontDescent: layout.fontDescent,
        fontCapHeight: layout.fontCapHeight,
        totalHeight: layout.totalHeight
      };
      if (this._textMetricsDebug && !Number.isFinite(tightWidth)) {
        this._debugTextMetrics("textWidth-non-finite", {
          text: source,
          tightWidth,
          layout: {
            tightWidth: layout.tightWidth,
            fontWidth: layout.fontWidth,
            ascent: layout.ascent,
            descent: layout.descent,
            firstBaseline: layout.firstBaseline,
            totalHeight: layout.totalHeight,
            lineCount: layout.lineCount
          }
        });
      }
      return tightWidth;
    }
    fontWidth(text) {
      if (!this._requireTextSubsystem()) return 0;
      const layout = this._layoutText(String(text ?? ""), null, null);
      this._textLastLayout = {
        tightWidth: layout.tightWidth,
        fontWidth: layout.fontWidth,
        ascent: layout.ascent,
        descent: layout.descent,
        fontAscent: layout.fontAscent,
        fontDescent: layout.fontDescent,
        fontCapHeight: layout.fontCapHeight,
        totalHeight: layout.totalHeight
      };
      if (this._textMetricsDebug && !Number.isFinite(layout.fontWidth)) {
        this._debugTextMetrics("fontWidth-non-finite", {
          text: String(text ?? ""),
          fontWidth: layout.fontWidth,
          layout: {
            tightWidth: layout.tightWidth,
            fontWidth: layout.fontWidth,
            ascent: layout.ascent,
            descent: layout.descent,
            firstBaseline: layout.firstBaseline,
            totalHeight: layout.totalHeight,
            lineCount: layout.lineCount
          }
        });
      }
      return layout.fontWidth;
    }
    textAscent(text) {
      if (!this._requireTextSubsystem()) return 0;
      if (text === void 0) {
        return this.fontAscent();
      }
      const source = String(text);
      const measured = this._measureTextGlyphInkExtents(source);
      if (measured) {
        const alphaAscent = measured.baseline - measured.top;
        const alphaDescent = measured.bottom - measured.baseline;
        const fontMetrics2 = this._resolvedFontBoxMetrics(measured.layout);
        const baselineShift2 = this._textBaselineShift(fontMetrics2);
        const ascent2 = alphaAscent + baselineShift2;
        const descent2 = alphaDescent - baselineShift2;
        this._textLastLayout = {
          tightWidth: Math.max(0, measured.maxX - measured.minX),
          fontWidth: measured.layout.fontWidth,
          ascent: ascent2,
          descent: descent2,
          fontAscent: fontMetrics2.ascent,
          fontDescent: fontMetrics2.descent,
          fontCapHeight: fontMetrics2.capHeight,
          totalHeight: measured.layout.totalHeight
        };
        if (this._textMetricsDebug && !Number.isFinite(ascent2)) {
          this._debugTextMetrics("textAscent-non-finite", {
            text: source,
            measured: {
              minX: measured.minX,
              maxX: measured.maxX,
              top: measured.top,
              bottom: measured.bottom,
              baseline: measured.baseline
            },
            layout: {
              tightWidth: measured.layout.tightWidth,
              fontWidth: measured.layout.fontWidth,
              ascent: measured.layout.ascent,
              descent: measured.layout.descent,
              fontAscent: measured.layout.fontAscent,
              fontDescent: measured.layout.fontDescent,
              firstBaseline: measured.layout.firstBaseline,
              totalHeight: measured.layout.totalHeight,
              lineCount: measured.layout.lineCount
            }
          });
        }
        return ascent2;
      }
      const layout = this._layoutText(source, null, null);
      const fontMetrics = this._resolvedFontBoxMetrics(layout);
      const baselineShift = this._textBaselineShift(fontMetrics);
      const ascent = layout.ascent + baselineShift;
      const descent = layout.descent - baselineShift;
      this._textLastLayout = {
        tightWidth: layout.tightWidth,
        fontWidth: layout.fontWidth,
        ascent,
        descent,
        fontAscent: fontMetrics.ascent,
        fontDescent: fontMetrics.descent,
        fontCapHeight: fontMetrics.capHeight,
        totalHeight: layout.totalHeight
      };
      return ascent;
    }
    textDescent(text) {
      if (!this._requireTextSubsystem()) return 0;
      if (text === void 0) {
        return this.fontDescent();
      }
      const source = String(text);
      const measured = this._measureTextGlyphInkExtents(source);
      if (measured) {
        const alphaAscent = measured.baseline - measured.top;
        const alphaDescent = measured.bottom - measured.baseline;
        const fontMetrics2 = this._resolvedFontBoxMetrics(measured.layout);
        const baselineShift2 = this._textBaselineShift(fontMetrics2);
        const ascent2 = alphaAscent + baselineShift2;
        const descent2 = alphaDescent - baselineShift2;
        this._textLastLayout = {
          tightWidth: Math.max(0, measured.maxX - measured.minX),
          fontWidth: measured.layout.fontWidth,
          ascent: ascent2,
          descent: descent2,
          fontAscent: fontMetrics2.ascent,
          fontDescent: fontMetrics2.descent,
          fontCapHeight: fontMetrics2.capHeight,
          totalHeight: measured.layout.totalHeight
        };
        if (this._textMetricsDebug && !Number.isFinite(descent2)) {
          this._debugTextMetrics("textDescent-non-finite", {
            text: source,
            measured: {
              minX: measured.minX,
              maxX: measured.maxX,
              top: measured.top,
              bottom: measured.bottom,
              baseline: measured.baseline
            },
            layout: {
              tightWidth: measured.layout.tightWidth,
              fontWidth: measured.layout.fontWidth,
              ascent: measured.layout.ascent,
              descent: measured.layout.descent,
              fontAscent: measured.layout.fontAscent,
              fontDescent: measured.layout.fontDescent,
              firstBaseline: measured.layout.firstBaseline,
              totalHeight: measured.layout.totalHeight,
              lineCount: measured.layout.lineCount
            }
          });
        }
        return descent2;
      }
      const layout = this._layoutText(source, null, null);
      const fontMetrics = this._resolvedFontBoxMetrics(layout);
      const baselineShift = this._textBaselineShift(fontMetrics);
      const ascent = layout.ascent + baselineShift;
      const descent = layout.descent - baselineShift;
      this._textLastLayout = {
        tightWidth: layout.tightWidth,
        fontWidth: layout.fontWidth,
        ascent,
        descent,
        fontAscent: fontMetrics.ascent,
        fontDescent: fontMetrics.descent,
        fontCapHeight: fontMetrics.capHeight,
        totalHeight: layout.totalHeight
      };
      return descent;
    }
    fontAscent() {
      if (!this._requireTextSubsystem()) return 0;
      const layout = this._layoutText("_", null, null);
      const fontMetrics = this._resolvedFontBoxMetrics(layout);
      const baselineShift = this._textBaselineShift(fontMetrics);
      const ascent = fontMetrics.ascent + baselineShift;
      const descent = fontMetrics.descent - baselineShift;
      this._textLastLayout = {
        tightWidth: layout.tightWidth,
        fontWidth: layout.fontWidth,
        ascent,
        descent,
        fontAscent: fontMetrics.ascent,
        fontDescent: fontMetrics.descent,
        fontCapHeight: fontMetrics.capHeight,
        totalHeight: layout.totalHeight
      };
      return ascent;
    }
    fontDescent() {
      if (!this._requireTextSubsystem()) return 0;
      const layout = this._layoutText("_", null, null);
      const fontMetrics = this._resolvedFontBoxMetrics(layout);
      const baselineShift = this._textBaselineShift(fontMetrics);
      const ascent = fontMetrics.ascent + baselineShift;
      const descent = fontMetrics.descent - baselineShift;
      this._textLastLayout = {
        tightWidth: layout.tightWidth,
        fontWidth: layout.fontWidth,
        ascent,
        descent,
        fontAscent: fontMetrics.ascent,
        fontDescent: fontMetrics.descent,
        fontCapHeight: fontMetrics.capHeight,
        totalHeight: layout.totalHeight
      };
      return descent;
    }
    textBounds(str, x, y, maxWidth, maxHeight) {
      return this._computeTextBounds(String(str ?? ""), x, y, maxWidth, maxHeight, true);
    }
    fontBounds(str, x, y, maxWidth, maxHeight) {
      return this._computeTextBounds(String(str ?? ""), x, y, maxWidth, maxHeight, false);
    }
    textStats() {
      return this._textAtlas?.takeFrameStats() ?? {
        hits: 0,
        misses: 0,
        uploads: 0,
        bytesUploaded: 0,
        grows: 0,
        clears: 0,
        evictions: 0
      };
    }
    background(v1, v2, v3, a) {
      this._clearRequested = true;
      this._clearColor = this._parseColor(v1, v2, v3, a);
    }
    clear() {
      this._clearRequested = true;
      this._clearColor = [0, 0, 0, 0];
    }
    rect(x, y, w, h, tl, tr, br, bl) {
      const rect = this._resolveRect(x, y, w, h);
      const hasRounding = tl !== void 0 || tr !== void 0 || br !== void 0 || bl !== void 0;
      if (!hasRounding) {
        const p0 = [rect.x, rect.y];
        const p1 = [rect.x + rect.w, rect.y];
        const p2 = [rect.x + rect.w, rect.y + rect.h];
        const p3 = [rect.x, rect.y + rect.h];
        if (this._state.fillEnabled) {
          const fillColor = this._effectiveFillColor();
          this._emitLocalTriangle(p0, p1, p2, fillColor);
          this._emitLocalTriangle(p0, p2, p3, fillColor);
        }
        if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
          const strokeColor = this._effectiveStrokeColor();
          this._emitStrokePathLocal([p0, p1, p2, p3], true, strokeColor);
        }
        return;
      }
      const points = this._buildRoundedRectPoints(
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        [toNumber(tl, 0), toNumber(tr, tl ?? 0), toNumber(br, tl ?? 0), toNumber(bl, tr ?? tl ?? 0)]
      );
      if (this._state.fillEnabled && points.length >= 3) {
        this._emitPolygonFillLocal([points], this._effectiveFillColor());
      }
      if (this._state.strokeEnabled && this._state.strokeWeight > 0 && points.length >= 2) {
        this._emitStrokePathLocal(points, true, this._effectiveStrokeColor());
      }
    }
    square(x, y, size, tl, tr, br, bl) {
      this.rect(x, y, size, size, tl, tr, br, bl);
    }
    triangle(x1, y1, x2, y2, x3, y3) {
      const a = [toNumber(x1), toNumber(y1)];
      const b = [toNumber(x2), toNumber(y2)];
      const c = [toNumber(x3), toNumber(y3)];
      if (this._state.fillEnabled) {
        this._emitLocalTriangle(a, b, c, this._effectiveFillColor());
      }
      if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
        this._emitStrokePathLocal([a, b, c], true, this._effectiveStrokeColor());
      }
    }
    quad(x1, y1, x2, y2, x3, y3, x4, y4) {
      const a = [toNumber(x1), toNumber(y1)];
      const b = [toNumber(x2), toNumber(y2)];
      const c = [toNumber(x3), toNumber(y3)];
      const d = [toNumber(x4), toNumber(y4)];
      if (this._state.fillEnabled) {
        const fillColor = this._effectiveFillColor();
        this._emitLocalTriangle(a, b, c, fillColor);
        this._emitLocalTriangle(a, c, d, fillColor);
      }
      if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
        this._emitStrokePathLocal([a, b, c, d], true, this._effectiveStrokeColor());
      }
    }
    ellipse(x, y, w, h) {
      const e = this._resolveEllipse(x, y, w, h);
      if (e.rx <= EPS || e.ry <= EPS) return;
      const points = this._buildEllipsePoints(e.cx, e.cy, e.rx, e.ry, 0, Math.PI * 2);
      if (this._state.fillEnabled) {
        const fillColor = this._effectiveFillColor();
        const blend = this._currentBlendMode();
        this._ensureBatch(blend, false);
        const m = this._state.matrix;
        const ccx = m[0] * e.cx + m[2] * e.cy + m[4];
        const ccy = m[1] * e.cx + m[3] * e.cy + m[5];
        const p0 = points[0];
        let prevX = m[0] * p0[0] + m[2] * p0[1] + m[4];
        let prevY = m[1] * p0[0] + m[3] * p0[1] + m[5];
        for (let i = 0; i < points.length; i++) {
          const np = points[(i + 1) % points.length];
          const nextX = m[0] * np[0] + m[2] * np[1] + m[4];
          const nextY = m[1] * np[0] + m[3] * np[1] + m[5];
          this._pushTriangleVertices(ccx, ccy, prevX, prevY, nextX, nextY, fillColor);
          prevX = nextX;
          prevY = nextY;
        }
      }
      if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
        this._emitStrokePathLocal(points, true, this._effectiveStrokeColor());
      }
    }
    circle(x, y, d) {
      this.ellipse(x, y, d, d);
    }
    arc(x, y, w, h, start, stop, mode = this.OPEN) {
      const e = this._resolveEllipse(x, y, w, h);
      if (e.rx <= EPS || e.ry <= EPS) return;
      let s = toNumber(start);
      let t = toNumber(stop);
      if (!Number.isFinite(s) || !Number.isFinite(t)) return;
      while (t < s) t += Math.PI * 2;
      const span = Math.max(EPS, t - s);
      const points = this._buildEllipsePoints(e.cx, e.cy, e.rx, e.ry, s, s + span);
      if (this._state.fillEnabled && mode !== this.OPEN) {
        const fillColor = this._effectiveFillColor();
        if (mode === this.CHORD) {
          this._emitPolygonFillLocal([points], fillColor);
        } else {
          const center = transformPoint(this._state.matrix, e.cx, e.cy);
          for (let i = 0; i < points.length - 1; i++) {
            const p0 = transformPoint(this._state.matrix, points[i][0], points[i][1]);
            const p1 = transformPoint(this._state.matrix, points[i + 1][0], points[i + 1][1]);
            this._emitTriangle(center, p0, p1, fillColor);
          }
        }
      }
      if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
        const strokeColor = this._effectiveStrokeColor();
        if (mode === this.PIE) {
          this._emitStrokePathLocal([[e.cx, e.cy], ...points], true, strokeColor);
        } else if (mode === this.CHORD) {
          this._emitStrokePathLocal(points, true, strokeColor);
        } else {
          this._emitStrokePathLocal(points, false, strokeColor);
        }
      }
    }
    line(x1, y1, x2, y2) {
      if (!this._state.strokeEnabled || this._state.strokeWeight <= 0) return;
      this._emitStrokePathLocal(
        [
          [toNumber(x1), toNumber(y1)],
          [toNumber(x2), toNumber(y2)]
        ],
        false,
        this._effectiveStrokeColor()
      );
    }
    point(x, y) {
      if (!this._state.strokeEnabled || this._state.strokeWeight <= 0) return;
      const scale = this._estimatedStrokeScale();
      const diameter = Math.max(1, this._state.strokeWeight * scale);
      const radius = diameter * 0.5;
      const center = transformPoint(this._state.matrix, toNumber(x), toNumber(y));
      const segments = Math.max(8, Math.ceil(Math.PI * 2 * radius / 3));
      const color = this._effectiveStrokeColor();
      for (let i = 0; i < segments; i++) {
        const a0 = i / segments * Math.PI * 2;
        const a1 = (i + 1) / segments * Math.PI * 2;
        const p0 = [center[0] + Math.cos(a0) * radius, center[1] + Math.sin(a0) * radius];
        const p1 = [center[0] + Math.cos(a1) * radius, center[1] + Math.sin(a1) * radius];
        this._emitTriangle(center, p0, p1, color);
      }
    }
    beginShape(kind) {
      this._shape = {
        kind: kind === void 0 ? null : toNumber(kind),
        rings: [[]],
        activeRing: 0,
        curvePoints: []
      };
    }
    endShape(mode) {
      const shape = this._shape;
      if (!shape) return;
      this._shape = null;
      const closeRequested = mode === this.CLOSE;
      const outer = shape.rings[0] ?? [];
      if (outer.length === 0) return;
      if (shape.kind === null) {
        if (this._state.fillEnabled) {
          this._emitPolygonFillLocal(shape.rings.filter((ring) => ring.length >= 3), this._effectiveFillColor());
        }
        if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
          const strokeColor = this._effectiveStrokeColor();
          for (let i = 0; i < shape.rings.length; i++) {
            const ring = shape.rings[i];
            if (ring.length < 2) continue;
            this._emitStrokePathLocal(ring, i > 0 || closeRequested, strokeColor);
          }
        }
        return;
      }
      switch (shape.kind) {
        case P5_CONST.POINTS:
          for (const [x, y] of outer) this.point(x, y);
          return;
        case P5_CONST.LINES:
          for (let i = 0; i + 1 < outer.length; i += 2) {
            const a = outer[i];
            const b = outer[i + 1];
            this.line(a[0], a[1], b[0], b[1]);
          }
          return;
        case P5_CONST.TRIANGLES:
          for (let i = 0; i + 2 < outer.length; i += 3) {
            const a = outer[i];
            const b = outer[i + 1];
            const c = outer[i + 2];
            this.triangle(a[0], a[1], b[0], b[1], c[0], c[1]);
          }
          return;
        case P5_CONST.TRIANGLE_FAN:
          for (let i = 1; i + 1 < outer.length; i++) {
            const a = outer[0];
            const b = outer[i];
            const c = outer[i + 1];
            this.triangle(a[0], a[1], b[0], b[1], c[0], c[1]);
          }
          return;
        case P5_CONST.TRIANGLE_STRIP:
          for (let i = 0; i + 2 < outer.length; i++) {
            const a = outer[i];
            const b = outer[i + 1];
            const c = outer[i + 2];
            this.triangle(a[0], a[1], b[0], b[1], c[0], c[1]);
          }
          return;
        case P5_CONST.QUADS:
          for (let i = 0; i + 3 < outer.length; i += 4) {
            const a = outer[i];
            const b = outer[i + 1];
            const c = outer[i + 2];
            const d = outer[i + 3];
            this.quad(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
          }
          return;
        case P5_CONST.QUAD_STRIP:
          for (let i = 0; i + 3 < outer.length; i += 2) {
            const a = outer[i];
            const b = outer[i + 1];
            const c = outer[i + 3];
            const d = outer[i + 2];
            this.quad(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
          }
          return;
        default:
          return;
      }
    }
    vertex(x, y) {
      if (!this._shape) return;
      const ring = this._shape.rings[this._shape.activeRing];
      ring.push([toNumber(x), toNumber(y)]);
    }
    beginContour() {
      if (!this._shape || this._shape.kind !== null) return;
      this._shape.rings.push([]);
      this._shape.activeRing = this._shape.rings.length - 1;
    }
    endContour() {
      if (!this._shape || this._shape.kind !== null) return;
      this._shape.activeRing = 0;
    }
    curveVertex(x, y) {
      if (!this._shape) return;
      this._shape.curvePoints.push([toNumber(x), toNumber(y)]);
      if (this._shape.curvePoints.length < 4) return;
      const points = this._shape.curvePoints;
      const p0 = points[points.length - 4];
      const p1 = points[points.length - 3];
      const p2 = points[points.length - 2];
      const p3 = points[points.length - 1];
      const [b0, b1, b2, b3] = this._catmullRomToBezier(p0, p1, p2, p3, this._state.curveTightness);
      const wangN = this._wangCubicSegments(b0, b1, b2, b3);
      const n = Math.max(CURVE_MIN_SEGMENTS, Math.ceil(wangN * this._state.curveDetail));
      const sampled = this._sampleCubicBezier(b0, b1, b2, b3, n);
      const ring = this._shape.rings[this._shape.activeRing];
      if (ring.length === 0) ring.push(sampled[0]);
      for (let i = 1; i < sampled.length; i++) ring.push(sampled[i]);
    }
    bezierVertex(x2, y2, x3, y3, x4, y4) {
      if (!this._shape) return;
      const ring = this._shape.rings[this._shape.activeRing];
      const last = ring[ring.length - 1];
      if (!last) return;
      const cp1 = [toNumber(x2), toNumber(y2)];
      const cp2 = [toNumber(x3), toNumber(y3)];
      const end = [toNumber(x4), toNumber(y4)];
      const wangN = this._wangCubicSegments(last, cp1, cp2, end);
      const n = Math.max(CURVE_MIN_SEGMENTS, Math.ceil(wangN * this._state.bezierDetail));
      const sampled = this._sampleCubicBezier(last, cp1, cp2, end, n);
      for (let i = 1; i < sampled.length; i++) ring.push(sampled[i]);
    }
    quadraticVertex(cx, cy, x3, y3) {
      if (!this._shape) return;
      const ring = this._shape.rings[this._shape.activeRing];
      const last = ring[ring.length - 1];
      if (!last) return;
      const cp = [toNumber(cx), toNumber(cy)];
      const end = [toNumber(x3), toNumber(y3)];
      const wangN = this._wangQuadraticSegments(last, cp, end);
      const n = Math.max(CURVE_MIN_SEGMENTS, Math.ceil(wangN * this._state.bezierDetail));
      const sampled = this._sampleQuadraticBezier(last, cp, end, n);
      for (let i = 1; i < sampled.length; i++) ring.push(sampled[i]);
    }
    bezier(x1, y1, x2, y2, x3, y3, x4, y4) {
      if (!this._state.strokeEnabled || this._state.strokeWeight <= 0) return;
      const b0 = [toNumber(x1), toNumber(y1)];
      const b1 = [toNumber(x2), toNumber(y2)];
      const b2 = [toNumber(x3), toNumber(y3)];
      const b3 = [toNumber(x4), toNumber(y4)];
      const wangN = this._wangCubicSegments(b0, b1, b2, b3);
      const n = Math.max(CURVE_MIN_SEGMENTS, Math.ceil(wangN * this._state.bezierDetail));
      const sampled = this._sampleCubicBezier(b0, b1, b2, b3, n);
      this._emitStrokePathLocal(sampled, false, this._effectiveStrokeColor());
    }
    curve(x1, y1, x2, y2, x3, y3, x4, y4) {
      if (!this._state.strokeEnabled || this._state.strokeWeight <= 0) return;
      const cr0 = [toNumber(x1), toNumber(y1)];
      const cr1 = [toNumber(x2), toNumber(y2)];
      const cr2 = [toNumber(x3), toNumber(y3)];
      const cr3 = [toNumber(x4), toNumber(y4)];
      const [b0, b1, b2, b3] = this._catmullRomToBezier(cr0, cr1, cr2, cr3, this._state.curveTightness);
      const wangN = this._wangCubicSegments(b0, b1, b2, b3);
      const n = Math.max(CURVE_MIN_SEGMENTS, Math.ceil(wangN * this._state.curveDetail));
      const sampled = this._sampleCubicBezier(b0, b1, b2, b3, n);
      this._emitStrokePathLocal(sampled, false, this._effectiveStrokeColor());
    }
    lerpColor(c1, c2, amt) {
      const a = this._parseColor(c1);
      const b = this._parseColor(c2);
      const t = clamp(toNumber(amt), 0, 1);
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t
      ];
    }
    async loadPixels() {
      const bytesPerRow = alignTo(this.width * 4, 256);
      const readBuffer = this.device.createBuffer({
        size: bytesPerRow * this.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: this.outputTexture },
        { buffer: readBuffer, bytesPerRow, rowsPerImage: this.height },
        { width: this.width, height: this.height, depthOrArrayLayers: 1 }
      );
      this.device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readBuffer.getMappedRange());
      const out = new Uint8ClampedArray(this.width * this.height * 4);
      for (let y = 0; y < this.height; y++) {
        const srcStart = y * bytesPerRow;
        const dstStart = y * this.width * 4;
        out.set(mapped.subarray(srcStart, srcStart + this.width * 4), dstStart);
      }
      this.pixels = out;
      readBuffer.unmap();
      readBuffer.destroy();
    }
    updatePixels() {
      if (this.pixels.length !== this.width * this.height * 4) {
        throw new Error("pixels length mismatch; call loadPixels() first or provide full canvas data");
      }
      const upload = Uint8Array.from(this.pixels);
      this.device.queue.writeTexture(
        { texture: this.outputTexture },
        upload,
        { bytesPerRow: this.width * 4, rowsPerImage: this.height },
        { width: this.width, height: this.height, depthOrArrayLayers: 1 }
      );
    }
    get(x, y, w, h) {
      const xi = Math.floor(toNumber(x));
      const yi = Math.floor(toNumber(y));
      if (w === void 0 || h === void 0) {
        if (this.pixels.length !== this.width * this.height * 4) {
          throw new Error("pixels not loaded; call await loadPixels() first");
        }
        if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return [0, 0, 0, 0];
        const idx = (yi * this.width + xi) * 4;
        return [this.pixels[idx], this.pixels[idx + 1], this.pixels[idx + 2], this.pixels[idx + 3]];
      }
      const ww = Math.max(0, Math.floor(toNumber(w)));
      const hh = Math.max(0, Math.floor(toNumber(h)));
      const out = new Uint8ClampedArray(ww * hh * 4);
      if (this.pixels.length !== this.width * this.height * 4) {
        throw new Error("pixels not loaded; call await loadPixels() first");
      }
      for (let yy = 0; yy < hh; yy++) {
        for (let xx = 0; xx < ww; xx++) {
          const srcX = xi + xx;
          const srcY = yi + yy;
          const dstIdx = (yy * ww + xx) * 4;
          if (srcX < 0 || srcY < 0 || srcX >= this.width || srcY >= this.height) continue;
          const srcIdx = (srcY * this.width + srcX) * 4;
          out[dstIdx] = this.pixels[srcIdx];
          out[dstIdx + 1] = this.pixels[srcIdx + 1];
          out[dstIdx + 2] = this.pixels[srcIdx + 2];
          out[dstIdx + 3] = this.pixels[srcIdx + 3];
        }
      }
      return out;
    }
    set(x, y, c) {
      const xi = Math.floor(toNumber(x));
      const yi = Math.floor(toNumber(y));
      if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return;
      if (this.pixels.length !== this.width * this.height * 4) {
        this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
      }
      const color = this._parseColor(c);
      const idx = (yi * this.width + xi) * 4;
      this.pixels[idx] = Math.round(clamp(color[0]) * 255);
      this.pixels[idx + 1] = Math.round(clamp(color[1]) * 255);
      this.pixels[idx + 2] = Math.round(clamp(color[2]) * 255);
      this.pixels[idx + 3] = Math.round(clamp(color[3]) * 255);
    }
    // Image drawing is deferred for now; this keeps parity with plan phases.
    imageMode(mode) {
      if (mode !== this.CORNER && mode !== this.CORNERS && mode !== this.CENTER) throw new Error("Invalid image mode");
      this._state.imageMode = mode;
    }
    tint(v1, v2, v3, alpha) {
      this._state.tint = this._parseColor(v1, v2, v3, alpha);
    }
    noTint() {
      this._state.tint = [1, 1, 1, 1];
    }
    image(img, x, y, w = img.texture.width, h = img.texture.height) {
      const texture = img.texture;
      if (texture === this.outputTexture) throw new Error("image cannot sample its current render target");
      if (texture.dimension !== "2d" || texture.depthOrArrayLayers !== 1 || texture.sampleCount !== 1 || !(texture.usage & GPUTextureUsage.TEXTURE_BINDING) || !["rgba8unorm", "bgra8unorm"].includes(texture.format))
        throw new Error("image requires a single-sample RGBA8/BGRA8 2D texture with TEXTURE_BINDING usage");
      if (![x, y, w, h].every(Number.isFinite)) throw new Error("image coordinates must be finite");
      if (this._state.imageMode === this.CORNERS) {
        w -= x;
        h -= y;
      }
      if (this._state.imageMode === this.CENTER) {
        x -= w / 2;
        y -= h / 2;
      }
      if (!w || !h) return;
      const filter = img.filter ?? "linear";
      if (filter !== "linear" && filter !== "nearest") throw new Error("Invalid image filter");
      let sampler = this._imageSamplers.get(filter);
      if (!sampler) {
        sampler = this.device.createSampler({ minFilter: filter, magFilter: filter, addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
        this._imageSamplers.set(filter, sampler);
      }
      const bindGroup = this.device.createBindGroup({
        layout: this._textBindGroupLayout,
        entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: sampler }]
      });
      this._batches.push({
        kind: "image",
        startVertex: this._textVertexCount,
        vertexCount: 0,
        blendMode: this._currentBlendMode(),
        isText: true,
        imageBindGroup: bindGroup
      });
      const v0 = img.flipY ? 1 : 0, v1 = img.flipY ? 0 : 1;
      const vertices = [[x, y, 0, v0], [x + w, y, 1, v0], [x + w, y + h, 1, v1], [x, y, 0, v0], [x + w, y + h, 1, v1], [x, y + h, 0, v1]];
      for (const [px, py, u, v] of vertices) {
        const pos = transformPoint(this._state.matrix, px, py);
        this._pushTextVertex(pos[0], pos[1], u, v, this._state.tint);
      }
    }
    _requireTextSubsystem() {
      if (!this._textEngine || !this._textAtlas) return null;
      return { engine: this._textEngine, atlas: this._textAtlas };
    }
    _resolveTextRect(x, y, width2, height2) {
      let tx = x;
      let ty = y;
      let tw = width2;
      let th = height2;
      switch (this._state.rectMode) {
        case P5_CONST.RADIUS:
          tw *= 2;
          tx -= tw * 0.5;
          if (th !== void 0) {
            th *= 2;
            ty -= th * 0.5;
          }
          break;
        case P5_CONST.CENTER:
          tx -= tw * 0.5;
          if (th !== void 0) {
            ty -= th * 0.5;
          }
          break;
        case P5_CONST.CORNERS:
          tw -= tx;
          if (th !== void 0) {
            th -= ty;
          }
          break;
        case P5_CONST.CORNER:
        default:
          break;
      }
      if (tw < 0) {
        tx += tw;
        tw = -tw;
      }
      if (th !== void 0 && th < 0) {
        ty += th;
        th = -th;
      }
      return { x: tx, y: ty, width: tw, height: th };
    }
    _layoutText(text, width2, height2) {
      const subsystem = this._requireTextSubsystem();
      if (!subsystem) {
        return {
          glyphs: [],
          tightWidth: 0,
          fontWidth: 0,
          ascent: 0,
          descent: 0,
          fontAscent: 0,
          fontDescent: 0,
          fontCapHeight: 0,
          firstBaseline: 0,
          totalHeight: 0,
          lineCount: 0
        };
      }
      const wrapMode = width2 === null ? 2 : this._state.textWrap === "CHAR" ? 1 : 0;
      const alignH = this._state.textAlignH === "center" ? 1 : this._state.textAlignH === "right" ? 2 : 0;
      const styleCode = this._resolvedStyleCode();
      const resolvedWeight = this._resolvedTextWeight();
      const layout = subsystem.engine.layoutText({
        text,
        family: this._state.textFontFamily,
        fontSize: this._state.textSize,
        lineHeight: this._state.textLeading,
        width: width2,
        height: height2,
        alignH,
        wrapMode,
        weight: resolvedWeight,
        style: styleCode,
        axisQuantization: this._state.textAxisQuantization,
        axes: this._resolvedTextAxes(resolvedWeight)
      });
      if (this._textMetricsDebug) {
        if (this._textMetricsDebugVerbose) {
          this._debugTextMetrics("layout-call", {
            req: {
              family: this._state.textFontFamily,
              fontSize: this._state.textSize,
              lineHeight: this._state.textLeading,
              width: width2,
              height: height2,
              textLen: text.length,
              textSample: text.slice(0, 32),
              alignH,
              wrapMode,
              styleCode,
              resolvedWeight
            },
            layout: {
              glyphCount: layout.glyphs.length,
              tightWidth: layout.tightWidth,
              fontWidth: layout.fontWidth,
              ascent: layout.ascent,
              descent: layout.descent,
              firstBaseline: layout.firstBaseline,
              totalHeight: layout.totalHeight,
              lineCount: layout.lineCount,
              glyphSample: layout.glyphs.slice(0, 3).map((glyph) => ({ x: glyph.x, y: glyph.y }))
            }
          });
        }
        const finiteCore = Number.isFinite(layout.tightWidth) && Number.isFinite(layout.fontWidth) && Number.isFinite(layout.ascent) && Number.isFinite(layout.descent) && Number.isFinite(layout.firstBaseline) && Number.isFinite(layout.totalHeight) && Number.isFinite(layout.lineCount);
        let finiteGlyphs = true;
        for (let i = 0; i < layout.glyphs.length; i++) {
          const glyph = layout.glyphs[i];
          if (!Number.isFinite(glyph.x) || !Number.isFinite(glyph.y)) {
            finiteGlyphs = false;
            break;
          }
        }
        if (!finiteCore || !finiteGlyphs) {
          this._debugTextMetrics("layout-non-finite", {
            req: {
              family: this._state.textFontFamily,
              fontSize: this._state.textSize,
              lineHeight: this._state.textLeading,
              width: width2,
              height: height2,
              textLen: text.length,
              alignH,
              wrapMode,
              styleCode,
              resolvedWeight
            },
            layout: {
              glyphCount: layout.glyphs.length,
              tightWidth: layout.tightWidth,
              fontWidth: layout.fontWidth,
              ascent: layout.ascent,
              descent: layout.descent,
              firstBaseline: layout.firstBaseline,
              totalHeight: layout.totalHeight,
              lineCount: layout.lineCount,
              glyphSample: layout.glyphs.slice(0, 6).map((glyph) => ({ x: glyph.x, y: glyph.y }))
            }
          });
        }
      }
      return layout;
    }
    _computeTextBounds(source, x, y, maxWidth, maxHeight, tight = true) {
      let tx = toNumber(x);
      let ty = toNumber(y);
      let width2 = null;
      let height2 = null;
      if (maxWidth !== void 0) {
        const rect = this._resolveTextRect(tx, ty, toNumber(maxWidth), maxHeight === void 0 ? void 0 : toNumber(maxHeight));
        tx = rect.x;
        ty = rect.y;
        width2 = Math.max(0, rect.width);
        height2 = rect.height === void 0 ? null : Math.max(0, rect.height);
      }
      const layout = this._layoutText(source, width2, height2);
      const measuredTight = layout.tightWidth;
      const measureW = tight ? measuredTight : layout.fontWidth;
      if (width2 === null) {
        if (this._state.textAlignH === "center") tx -= measureW * 0.5;
        else if (this._state.textAlignH === "right") tx -= measureW;
      } else {
        if (this._state.textAlignH === "center") tx += (width2 - measureW) * 0.5;
        else if (this._state.textAlignH === "right") tx += width2 - measureW;
      }
      const layoutTopY = this._resolveTextTopY(ty, height2, layout);
      return {
        x: tx,
        y: layoutTopY,
        w: measureW,
        h: layout.totalHeight
      };
    }
    _resolveTextTopY(y, boxHeight, layout) {
      const fontMetrics = this._resolvedFontBoxMetrics(layout);
      const baselineShift = this._textBaselineShift(fontMetrics);
      if (boxHeight !== null) {
        const h = Math.max(0, boxHeight);
        switch (this._state.textAlignV) {
          case "center":
            return y + (h - layout.totalHeight) * 0.5;
          case "bottom":
            return y + (h - layout.totalHeight);
          case "top":
            return y + fontMetrics.ascent - layout.ascent;
          case "alphabetic":
            return y - layout.ascent;
          default:
            return y;
        }
      }
      return y - baselineShift - layout.ascent;
    }
    _emitTextStroke(x, y, glyph, color, radius, blendMode) {
      const offsets = [
        [-radius, 0],
        [radius, 0],
        [0, -radius],
        [0, radius],
        [-radius, -radius],
        [radius, -radius],
        [-radius, radius],
        [radius, radius]
      ];
      for (const [ox, oy] of offsets) {
        this._emitTextQuad(
          x + ox,
          y + oy,
          glyph,
          color,
          blendMode
        );
      }
    }
    _emitTextQuad(x, y, glyph, color, blendMode) {
      const x0 = x;
      const y0 = y;
      const x1 = x + glyph.width;
      const y1 = y + glyph.height;
      const p0 = transformPoint(this._state.matrix, x0, y0);
      const p1 = transformPoint(this._state.matrix, x1, y0);
      const p2 = transformPoint(this._state.matrix, x1, y1);
      const p3 = transformPoint(this._state.matrix, x0, y1);
      this._ensureBatch(blendMode, true);
      this._pushTextVertex(p0[0], p0[1], glyph.u0, glyph.v0, color);
      this._pushTextVertex(p1[0], p1[1], glyph.u1, glyph.v0, color);
      this._pushTextVertex(p2[0], p2[1], glyph.u1, glyph.v1, color);
      this._pushTextVertex(p0[0], p0[1], glyph.u0, glyph.v0, color);
      this._pushTextVertex(p2[0], p2[1], glyph.u1, glyph.v1, color);
      this._pushTextVertex(p3[0], p3[1], glyph.u0, glyph.v1, color);
    }
    _parseTextAlignH(value) {
      const v = String(value).toLowerCase();
      if (value === this.CENTER || v === "center" || v === "middle") return "center";
      if (value === this.RIGHT || v === "right" || v === "end") return "right";
      return "left";
    }
    _parseTextAlignV(value) {
      const v = String(value).toLowerCase();
      if (value === this.CENTER || v === "center" || v === "middle") return "center";
      if (value === this.TOP || v === "top" || v === "hanging") return "top";
      if (value === this.BOTTOM || v === "bottom" || v === "ideographic") return "bottom";
      return "alphabetic";
    }
    _parseTextStyle(value) {
      const v = String(value).toLowerCase().trim();
      if (v === "bold italic" || v === "italic bold" || value === this.BOLDITALIC) return "bold italic";
      if (v === "bold" || value === this.BOLD) return "bold";
      if (v === "italic" || value === this.ITALIC || v === "oblique") return "italic";
      return "normal";
    }
    _resolvedTextWeight() {
      if (this._state.textWeightSet) return this._state.textWeight;
      if (this._state.textStyle === "bold" || this._state.textStyle === "bold italic") return 700;
      return 400;
    }
    _resolvedStyleCode() {
      return this._state.textStyle === "italic" || this._state.textStyle === "bold italic" ? 1 : 0;
    }
    _resolvedTextAxes(resolvedWeight) {
      const axes = { ...this._state.textAxes };
      if (this._state.textWeightSet && !Number.isFinite(axes.wght)) {
        axes.wght = resolvedWeight;
      }
      return axes;
    }
    _resolvedFontBoxMetrics(layout) {
      const ascent = Number.isFinite(layout.fontAscent) && layout.fontAscent > 0 ? layout.fontAscent : Math.max(0, layout.ascent);
      const descent = Number.isFinite(layout.fontDescent) && layout.fontDescent >= 0 ? layout.fontDescent : Math.max(0, layout.descent);
      const capHeight = Number.isFinite(layout.fontCapHeight) && layout.fontCapHeight > 0 ? layout.fontCapHeight : ascent;
      const metricTotal = ascent + descent;
      const emTarget = Number.isFinite(this._state.textSize) && this._state.textSize > 0 ? this._state.textSize : metricTotal;
      const emScale = metricTotal > 0 ? clamp(emTarget / metricTotal, 0.25, 4) : 1;
      const emAscent = ascent * emScale;
      const emDescent = descent * emScale;
      return { ascent, descent, capHeight, emAscent, emDescent };
    }
    _textBaselineShift(fontMetrics) {
      switch (this._state.textAlignV) {
        case "top":
          return -fontMetrics.emAscent;
        case "bottom":
          return fontMetrics.emDescent;
        case "center":
          return (fontMetrics.emDescent - fontMetrics.emAscent) * 0.5;
        case "alphabetic":
        default:
          return 0;
      }
    }
    _measureTextGlyphInkExtents(text, alphaThreshold = 0) {
      const subsystem = this._requireTextSubsystem();
      if (!subsystem) return null;
      const layout = this._layoutText(text, null, null);
      if (layout.glyphs.length === 0) return null;
      let minLeft = Number.POSITIVE_INFINITY;
      let maxRight = Number.NEGATIVE_INFINITY;
      let minTop = Number.POSITIVE_INFINITY;
      let maxBottom = Number.NEGATIVE_INFINITY;
      for (const glyph of layout.glyphs) {
        const atlasGlyph = subsystem.atlas.ensureGlyph(glyph.key, subsystem.engine);
        if (!atlasGlyph) continue;
        const inkX0 = alphaThreshold > 0 ? atlasGlyph.inkX0 : 0;
        const inkX1 = alphaThreshold > 0 ? atlasGlyph.inkX1 : atlasGlyph.width;
        const left = glyph.x + atlasGlyph.left + inkX0;
        const right = glyph.x + atlasGlyph.left + inkX1;
        const top = glyph.y - atlasGlyph.top;
        const bottom = top + atlasGlyph.height;
        if (left < minLeft) minLeft = left;
        if (right > maxRight) maxRight = right;
        if (top < minTop) minTop = top;
        if (bottom > maxBottom) maxBottom = bottom;
      }
      if (!Number.isFinite(minLeft) || !Number.isFinite(maxRight) || !Number.isFinite(minTop) || !Number.isFinite(maxBottom)) return null;
      const baseline = Number.isFinite(layout.firstBaseline) && layout.firstBaseline > 0 ? layout.firstBaseline : layout.ascent;
      if (this._textMetricsDebug && !Number.isFinite(baseline)) {
        this._debugTextMetrics("baseline-non-finite", {
          text,
          layout: {
            firstBaseline: layout.firstBaseline,
            ascent: layout.ascent,
            descent: layout.descent,
            totalHeight: layout.totalHeight,
            lineCount: layout.lineCount,
            glyphCount: layout.glyphs.length
          }
        });
      }
      return {
        minX: minLeft,
        maxX: maxRight,
        top: minTop,
        bottom: maxBottom,
        baseline,
        layout
      };
    }
    _measureTextBlockTightWidth(source, alphaThreshold = 0) {
      const lines = source.split(/\r?\n/g);
      let maxWidth = 0;
      for (const line of lines) {
        const measured = this._measureTextGlyphInkExtents(line, alphaThreshold);
        if (!measured) continue;
        maxWidth = Math.max(maxWidth, Math.max(0, measured.maxX - measured.minX));
      }
      return maxWidth;
    }
    _debugTextMetrics(label, payload) {
      if (!this._textMetricsDebug || this._textMetricsDebugBudget <= 0) return;
      this._textMetricsDebugBudget -= 1;
      try {
        console.log(`[p5gpu][text-metrics][${label}] ${JSON.stringify(payload)}`);
      } catch {
        console.log(`[p5gpu][text-metrics][${label}] (unserializable payload)`);
      }
    }
    _parseVariationSettings(settings) {
      const out = {};
      const regex = /[\"']?([A-Za-z0-9]{4})[\"']?\\s*([+-]?\\d*\\.?\\d+)/g;
      let match = regex.exec(settings);
      while (match) {
        const tag = match[1];
        const value = Number(match[2]);
        if (Number.isFinite(value)) out[tag] = value;
        match = regex.exec(settings);
      }
      return out;
    }
    _formatVariationSettings(axes) {
      return Object.entries(axes).map(([tag, value]) => `"${tag}" ${value}`).join(", ");
    }
    _syncTextBindGroup() {
      if (!this._textAtlas) return false;
      if (this._textBindGroup && this._textBindGroupAtlasVersion === this._textAtlas.version) {
        return true;
      }
      this._textBindGroup = this.device.createBindGroup({
        layout: this._textBindGroupLayout,
        entries: [
          { binding: 0, resource: this._textAtlas.textureView() },
          { binding: 1, resource: this._textAtlas.sampler }
        ]
      });
      this._textBindGroupAtlasVersion = this._textAtlas.version;
      return true;
    }
    _parseColor(v1, v2, v3, v4) {
      if (typeof v1 === "string") {
        const parsed = this._parseColorString(v1);
        if (parsed) return parsed;
      }
      if (Array.isArray(v1) || ArrayBuffer.isView(v1)) {
        const arr = Array.from(v1).slice(0, 4).map((v) => toNumber(v));
        if (arr.length === 0) return [0, 0, 0, 1];
        if (arr.length === 1) arr.push(arr[0], arr[0], this._state.colorMaxes[3]);
        if (arr.length === 2) {
          const gray = arr[0];
          const alpha = arr[1];
          arr[1] = gray;
          arr.push(gray, alpha);
        }
        if (arr.length === 3) arr.push(this._state.colorMaxes[3]);
        const maxes2 = this._state.colorMaxes;
        const looksNormalized = arr.every((value) => value >= 0 && value <= 1);
        if (looksNormalized) {
          return [clamp(arr[0]), clamp(arr[1]), clamp(arr[2]), clamp(arr[3])];
        }
        return this._numericColorToRgba(arr[0], arr[1], arr[2], arr[3], maxes2);
      }
      if (typeof v1 === "object" && v1) {
        const maybeLevels = v1;
        if (maybeLevels.levels && maybeLevels.levels.length >= 3) {
          const lv = maybeLevels.levels;
          return [clamp((lv[0] ?? 0) / 255), clamp((lv[1] ?? 0) / 255), clamp((lv[2] ?? 0) / 255), clamp((lv[3] ?? 255) / 255)];
        }
      }
      const n1 = toNumber(v1, 0);
      const hasV2 = v2 !== void 0;
      const hasV3 = v3 !== void 0;
      const hasV4 = v4 !== void 0;
      const maxes = this._state.colorMaxes;
      if (!hasV2 && !hasV3 && !hasV4) {
        return this._numericColorToRgba(n1, n1, n1, maxes[3], maxes);
      }
      if (hasV2 && !hasV3 && !hasV4) {
        const n22 = toNumber(v2, maxes[3]);
        return this._numericColorToRgba(n1, n1, n1, n22, maxes);
      }
      const n2 = toNumber(v2, 0);
      const n3 = toNumber(v3, 0);
      const n4 = hasV4 ? toNumber(v4, maxes[3]) : maxes[3];
      return this._numericColorToRgba(n1, n2, n3, n4, maxes);
    }
    _numericColorToRgba(c1, c2, c3, a, maxes) {
      const alpha = clamp(a / maxes[3]);
      if (this._state.colorMode === this.HSB) {
        const h = clamp(c1 / maxes[0]);
        const s = clamp(c2 / maxes[1]);
        const b = clamp(c3 / maxes[2]);
        const [r, g3, bb] = hsbToRgb(h, s, b);
        return [r, g3, bb, alpha];
      }
      if (this._state.colorMode === this.HSL) {
        const h = clamp(c1 / maxes[0]);
        const s = clamp(c2 / maxes[1]);
        const l = clamp(c3 / maxes[2]);
        const [r, g3, bb] = hslToRgb(h, s, l);
        return [r, g3, bb, alpha];
      }
      return [
        clamp(c1 / maxes[0]),
        clamp(c2 / maxes[1]),
        clamp(c3 / maxes[2]),
        alpha
      ];
    }
    _parseColorString(value) {
      const input = value.trim().toLowerCase();
      const named = /* @__PURE__ */ new Map([
        ["black", [0, 0, 0, 1]],
        ["white", [1, 1, 1, 1]],
        ["red", [1, 0, 0, 1]],
        ["green", [0, 0.5, 0, 1]],
        ["blue", [0, 0, 1, 1]],
        ["transparent", [0, 0, 0, 0]]
      ]);
      if (named.has(input)) return named.get(input);
      if (/^#[0-9a-f]{3}$/.test(input)) {
        const r = parseInt(input[1] + input[1], 16);
        const g3 = parseInt(input[2] + input[2], 16);
        const b = parseInt(input[3] + input[3], 16);
        return [r / 255, g3 / 255, b / 255, 1];
      }
      if (/^#[0-9a-f]{4}$/.test(input)) {
        const r = parseInt(input[1] + input[1], 16);
        const g3 = parseInt(input[2] + input[2], 16);
        const b = parseInt(input[3] + input[3], 16);
        const a = parseInt(input[4] + input[4], 16);
        return [r / 255, g3 / 255, b / 255, a / 255];
      }
      if (/^#[0-9a-f]{6}$/.test(input)) {
        const r = parseInt(input.slice(1, 3), 16);
        const g3 = parseInt(input.slice(3, 5), 16);
        const b = parseInt(input.slice(5, 7), 16);
        return [r / 255, g3 / 255, b / 255, 1];
      }
      if (/^#[0-9a-f]{8}$/.test(input)) {
        const r = parseInt(input.slice(1, 3), 16);
        const g3 = parseInt(input.slice(3, 5), 16);
        const b = parseInt(input.slice(5, 7), 16);
        const a = parseInt(input.slice(7, 9), 16);
        return [r / 255, g3 / 255, b / 255, a / 255];
      }
      const rgbMatch = input.match(/^rgba?\((.+)\)$/);
      if (rgbMatch) {
        const parts = rgbMatch[1].split(",").map((p2) => p2.trim());
        if (parts.length === 3 || parts.length === 4) {
          const r = parseRgbLikeComponent(parts[0]);
          const g3 = parseRgbLikeComponent(parts[1]);
          const b = parseRgbLikeComponent(parts[2]);
          let a = 255;
          if (parts.length === 4) {
            const alphaRaw = parts[3];
            if (alphaRaw.endsWith("%")) {
              a = clamp(Number(alphaRaw.slice(0, -1)) / 100) * 255;
            } else {
              const alpha = Number(alphaRaw);
              a = alpha <= 1 ? clamp(alpha) * 255 : clamp(alpha, 0, 255);
            }
          }
          return [clamp(r / 255), clamp(g3 / 255), clamp(b / 255), clamp(a / 255)];
        }
      }
      return null;
    }
    _resolveRect(x, y, w, h) {
      let rx = toNumber(x);
      let ry = toNumber(y);
      let rw = toNumber(w);
      let rh = h === void 0 ? rw : toNumber(h);
      switch (this._state.rectMode) {
        case P5_CONST.CORNERS: {
          const x0 = rx;
          const y0 = ry;
          const x2 = rw;
          const y2 = rh;
          const left = Math.min(x0, x2);
          const top = Math.min(y0, y2);
          rx = left;
          ry = top;
          rw = Math.abs(x2 - x0);
          rh = Math.abs(y2 - y0);
          break;
        }
        case P5_CONST.CENTER:
          rx -= rw * 0.5;
          ry -= rh * 0.5;
          break;
        case P5_CONST.RADIUS:
          rx -= rw;
          ry -= rh;
          rw *= 2;
          rh *= 2;
          break;
        case P5_CONST.CORNER:
        default:
          break;
      }
      if (rw < 0) {
        rx += rw;
        rw = -rw;
      }
      if (rh < 0) {
        ry += rh;
        rh = -rh;
      }
      return { x: rx, y: ry, w: rw, h: rh };
    }
    _resolveEllipse(x, y, w, h) {
      let xx = toNumber(x);
      let yy = toNumber(y);
      let ww = toNumber(w);
      let hh = h === void 0 ? ww : toNumber(h);
      switch (this._state.ellipseMode) {
        case P5_CONST.CORNER:
          return {
            cx: xx + ww * 0.5,
            cy: yy + hh * 0.5,
            rx: Math.abs(ww) * 0.5,
            ry: Math.abs(hh) * 0.5
          };
        case P5_CONST.CORNERS: {
          const x2 = ww;
          const y2 = hh;
          return {
            cx: (xx + x2) * 0.5,
            cy: (yy + y2) * 0.5,
            rx: Math.abs(x2 - xx) * 0.5,
            ry: Math.abs(y2 - yy) * 0.5
          };
        }
        case P5_CONST.RADIUS:
          return {
            cx: xx,
            cy: yy,
            rx: Math.abs(ww),
            ry: Math.abs(hh)
          };
        case P5_CONST.CENTER:
        default:
          return {
            cx: xx,
            cy: yy,
            rx: Math.abs(ww) * 0.5,
            ry: Math.abs(hh) * 0.5
          };
      }
    }
    _buildEllipsePoints(cx, cy, rx, ry, start, stop) {
      const arcLength = Math.max(EPS, Math.abs(stop - start));
      const circumference = Math.PI * 2 * Math.sqrt((rx * rx + ry * ry) * 0.5);
      const scaledLength = circumference * (arcLength / (Math.PI * 2));
      const segments = this.optimizedMode ? Math.max(8, Math.ceil(scaledLength / 8)) : Math.max(12, Math.ceil(scaledLength / 4));
      const points = [];
      const step = (stop - start) / segments;
      for (let i = 0; i <= segments; i++) {
        const t = start + step * i;
        points.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
      }
      if (points.length > 1) {
        const first = points[0];
        const last = points[points.length - 1];
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-3) {
          points.pop();
        }
      }
      return points;
    }
    _buildRoundedRectPoints(x, y, w, h, radii) {
      const maxR = Math.min(w, h) * 0.5;
      let tl = clamp(radii[0], 0, maxR);
      let tr = clamp(radii[1], 0, maxR);
      let br = clamp(radii[2], 0, maxR);
      let bl = clamp(radii[3], 0, maxR);
      if (tl + tr > w && w > EPS) {
        const scale = w / (tl + tr);
        tl *= scale;
        tr *= scale;
      }
      if (bl + br > w && w > EPS) {
        const scale = w / (bl + br);
        bl *= scale;
        br *= scale;
      }
      const segFor = (r) => this.optimizedMode ? Math.max(2, Math.ceil(Math.PI * 0.5 * r / 8)) : Math.max(3, Math.ceil(Math.PI * 0.5 * r / 4));
      const points = [];
      const addArc = (cx, cy, r, start, end) => {
        if (r <= EPS) {
          points.push([cx, cy]);
          return;
        }
        const segs = segFor(r);
        for (let i = 0; i <= segs; i++) {
          const t = start + (end - start) * (i / segs);
          points.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
        }
      };
      addArc(x + w - tr, y + tr, tr, -Math.PI * 0.5, 0);
      addArc(x + w - br, y + h - br, br, 0, Math.PI * 0.5);
      addArc(x + bl, y + h - bl, bl, Math.PI * 0.5, Math.PI);
      addArc(x + tl, y + tl, tl, Math.PI, Math.PI * 1.5);
      const deduped = [];
      for (const p2 of points) {
        const prev = deduped[deduped.length - 1];
        if (!prev || Math.hypot(prev[0] - p2[0], prev[1] - p2[1]) > 1e-3) {
          deduped.push(p2);
        }
      }
      if (deduped.length > 1) {
        const first = deduped[0];
        const last = deduped[deduped.length - 1];
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-3) {
          deduped.pop();
        }
      }
      return deduped;
    }
    _emitLocalTriangle(a, b, c, color) {
      const ta = transformPoint(this._state.matrix, a[0], a[1]);
      const tb = transformPoint(this._state.matrix, b[0], b[1]);
      const tc = transformPoint(this._state.matrix, c[0], c[1]);
      this._emitTriangle(ta, tb, tc, color);
    }
    _emitTriangle(a, b, c, color) {
      const blend = this._currentBlendMode();
      this._ensureBatch(blend, false);
      this._pushVertex(a[0], a[1], color);
      this._pushVertex(b[0], b[1], color);
      this._pushVertex(c[0], c[1], color);
    }
    _emitPolygonFillLocal(rings, color) {
      const validRings = rings.filter((ring) => ring.length >= 3);
      if (validRings.length === 0) return;
      if (validRings.length === 1 && this._shouldUseStencilFill(validRings[0], color)) {
        this._emitStencilFillLocal(validRings[0], color);
        return;
      }
      const flat = [];
      const holes = [];
      let cursor = 0;
      for (let i = 0; i < validRings.length; i++) {
        const ring = validRings[i];
        if (i > 0) holes.push(cursor);
        for (const p2 of ring) {
          flat.push(p2[0], p2[1]);
          cursor += 1;
        }
      }
      const indices = earcut(flat, holes.length > 0 ? holes : void 0, 2);
      for (let i = 0; i + 2 < indices.length; i += 3) {
        const ia = indices[i] * 2;
        const ib = indices[i + 1] * 2;
        const ic = indices[i + 2] * 2;
        const a = [flat[ia], flat[ia + 1]];
        const b = [flat[ib], flat[ib + 1]];
        const c = [flat[ic], flat[ic + 1]];
        this._emitLocalTriangle(a, b, c, color);
      }
    }
    _emitStencilFillLocal(ring, color) {
      const path = [];
      for (const p2 of ring) {
        const tp = transformPoint(this._state.matrix, p2[0], p2[1]);
        const prev = path[path.length - 1];
        if (!prev || Math.hypot(tp[0] - prev[0], tp[1] - prev[1]) > EPS) {
          path.push(tp);
        }
      }
      if (path.length > 1) {
        const first = path[0];
        const last = path[path.length - 1];
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= EPS) {
          path.pop();
        }
      }
      if (path.length < 3) return;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const p2 of path) {
        minX = Math.min(minX, p2[0]);
        minY = Math.min(minY, p2[1]);
        maxX = Math.max(maxX, p2[0]);
        maxY = Math.max(maxY, p2[1]);
      }
      const blend = this._currentBlendMode();
      const anchor = path[0];
      this._ensureBatch(blend, false, "stencilFillMask");
      for (let i = 1; i + 1 < path.length; i++) {
        const b = path[i];
        const c = path[i + 1];
        this._pushTriangleVertices(anchor[0], anchor[1], b[0], b[1], c[0], c[1], color);
      }
      this._ensureBatch(blend, false, "stencilFillCover");
      this._pushCoverQuad(minX - 1, minY - 1, maxX + 1, maxY + 1, color);
    }
    _shouldUseStencilFill(ring, color) {
      if (!ENABLE_STENCIL_FILLS) return false;
      if (this._state.eraseMode || this._stencilUnavailable) return false;
      if (color[3] < 0.999) return true;
      if (ring.length >= STENCIL_FILL_SEGMENT_THRESHOLD) return true;
      return this._pathHasSelfIntersection(ring);
    }
    _pathHasSelfIntersection(path) {
      const n = path.length;
      if (n < 4) return false;
      for (let i = 0; i < n; i++) {
        const a0 = path[i];
        const a1 = path[(i + 1) % n];
        for (let j = i + 1; j < n; j++) {
          if (Math.abs(i - j) <= 1) continue;
          if (i === 0 && j === n - 1) continue;
          const b0 = path[j];
          const b1 = path[(j + 1) % n];
          if (segmentsIntersect(a0, a1, b0, b1)) return true;
        }
      }
      return false;
    }
    _emitStrokePathLocal(points, closed, color) {
      if (points.length === 0) return;
      const transformed = points.map((p2) => transformPoint(this._state.matrix, p2[0], p2[1]));
      this._emitStrokePathScreen(transformed, closed, color);
    }
    _emitStrokePathScreen(points, closed, color) {
      if (points.length === 0) return;
      const scale = this._estimatedStrokeScale();
      const weight = Math.max(1e-4, this._state.strokeWeight * scale);
      const half = weight * 0.5;
      const path = [];
      for (const p2 of points) {
        const prev = path[path.length - 1];
        if (!prev || Math.hypot(p2[0] - prev[0], p2[1] - prev[1]) > EPS) {
          path.push([p2[0], p2[1]]);
        }
      }
      if (closed && path.length > 1) {
        const first = path[0];
        const last = path[path.length - 1];
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= EPS) {
          path.pop();
        }
      }
      if (path.length === 0) return;
      const blend = this._currentBlendMode();
      const emitDot = (p2) => {
        this._ensureBatch(blend, false, "geom");
        if (this._state.strokeCap === this.ROUND) {
          this._emitRoundCap(p2, [1, 0], half, color);
          this._emitRoundCap(p2, [-1, 0], half, color);
        } else {
          this._pushTriangleVertices(p2[0] - half, p2[1] - half, p2[0] + half, p2[1] - half, p2[0] + half, p2[1] + half, color);
          this._pushTriangleVertices(p2[0] - half, p2[1] - half, p2[0] + half, p2[1] + half, p2[0] - half, p2[1] + half, color);
        }
      };
      if (path.length === 1) {
        emitDot(path[0]);
        return;
      }
      const isClosed = closed && path.length > 2;
      if (!isClosed && (this._state.strokeCap === this.SQUARE || this._state.strokeCap === this.PROJECT)) {
        const first = path[0];
        const second = path[1];
        const last = path[path.length - 1];
        const prev = path[path.length - 2];
        const d0 = normalize(second[0] - first[0], second[1] - first[1]);
        const d1 = normalize(last[0] - prev[0], last[1] - prev[1]);
        first[0] -= d0[0] * half;
        first[1] -= d0[1] * half;
        last[0] += d1[0] * half;
        last[1] += d1[1] * half;
      }
      const n = path.length;
      const segCount = isClosed ? n : n - 1;
      if (segCount <= 0) {
        emitDot(path[0]);
        return;
      }
      const joinMode = this._state.strokeJoin === this.ROUND || this._state.strokeJoin === this.BEVEL || this._state.strokeJoin === this.MITER ? this._state.strokeJoin : this.MITER;
      const miterLimitRatio = this._state.strokeMiterLimit;
      const dirX = new Float64Array(segCount);
      const dirY = new Float64Array(segCount);
      const normalX = new Float64Array(segCount);
      const normalY = new Float64Array(segCount);
      const useStencilStroke = this._shouldUseStencilStroke(isClosed, segCount, color);
      const coverPad = half * Math.max(1, miterLimitRatio) + 2;
      let coverMinX = Number.POSITIVE_INFINITY;
      let coverMinY = Number.POSITIVE_INFINITY;
      let coverMaxX = Number.NEGATIVE_INFINITY;
      let coverMaxY = Number.NEGATIVE_INFINITY;
      for (const p2 of path) {
        coverMinX = Math.min(coverMinX, p2[0] - coverPad);
        coverMinY = Math.min(coverMinY, p2[1] - coverPad);
        coverMaxX = Math.max(coverMaxX, p2[0] + coverPad);
        coverMaxY = Math.max(coverMaxY, p2[1] + coverPad);
      }
      for (let i = 0; i < segCount; i++) {
        const a = path[i];
        const b = path[(i + 1) % n];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len <= EPS) {
          emitDot(path[0]);
          return;
        }
        const ux = dx / len;
        const uy = dy / len;
        dirX[i] = ux;
        dirY[i] = uy;
        normalX[i] = -uy;
        normalY[i] = ux;
      }
      this._ensureBatch(blend, false, useStencilStroke ? "stencilStrokeMask" : "geom");
      const miterOffsetsAt = (vertexIndex, prevSeg, nextSeg) => {
        if (joinMode !== this.MITER) return null;
        let mx = normalX[prevSeg] + normalX[nextSeg];
        let my = normalY[prevSeg] + normalY[nextSeg];
        const mLen = Math.hypot(mx, my);
        if (mLen <= 1e-5) return null;
        mx /= mLen;
        my /= mLen;
        const dot = mx * normalX[prevSeg] + my * normalY[prevSeg];
        if (Math.abs(dot) <= 1e-5) return null;
        const miterLen = half / dot;
        if (!Number.isFinite(miterLen) || Math.abs(miterLen) > half * miterLimitRatio) {
          return null;
        }
        const p2 = path[vertexIndex];
        return [p2[0] + mx * miterLen, p2[1] + my * miterLen, p2[0] - mx * miterLen, p2[1] - my * miterLen];
      };
      const endpointOffsets = (vertexIndex, segmentIndex, prevSeg, nextSeg, canJoin) => {
        if (canJoin) {
          const miter = miterOffsetsAt(vertexIndex, prevSeg, nextSeg);
          if (miter) return miter;
        }
        const p2 = path[vertexIndex];
        const nx = normalX[segmentIndex] * half;
        const ny = normalY[segmentIndex] * half;
        return [p2[0] + nx, p2[1] + ny, p2[0] - nx, p2[1] - ny];
      };
      for (let seg = 0; seg < segCount; seg++) {
        const startIndex = seg;
        const endIndex = (seg + 1) % n;
        const startCanJoin = isClosed || startIndex > 0;
        const startPrevSeg = (seg - 1 + segCount) % segCount;
        const start = endpointOffsets(startIndex, seg, startPrevSeg, seg, startCanJoin);
        const endCanJoin = isClosed || endIndex < n - 1;
        const endNextSeg = (seg + 1) % segCount;
        const end = endpointOffsets(endIndex, seg, seg, endNextSeg, endCanJoin);
        this._pushTriangleVertices(start[0], start[1], start[2], start[3], end[2], end[3], color);
        this._pushTriangleVertices(start[0], start[1], end[2], end[3], end[0], end[1], color);
      }
      const emitJoin = (vertexIndex, prevSeg, nextSeg) => {
        if (miterOffsetsAt(vertexIndex, prevSeg, nextSeg)) return;
        const cross = dirX[prevSeg] * dirY[nextSeg] - dirY[prevSeg] * dirX[nextSeg];
        const dot = dirX[prevSeg] * dirX[nextSeg] + dirY[prevSeg] * dirY[nextSeg];
        if (Math.abs(cross) < 1e-4 && dot > 0) return;
        const turnSign = cross >= 0 ? 1 : -1;
        const outerSide = cross >= 0 ? -1 : 1;
        const fromX = normalX[prevSeg] * half * outerSide;
        const fromY = normalY[prevSeg] * half * outerSide;
        const toX = normalX[nextSeg] * half * outerSide;
        const toY = normalY[nextSeg] * half * outerSide;
        const p2 = path[vertexIndex];
        if (joinMode === this.ROUND) {
          this._emitRoundJoin(p2, fromX, fromY, toX, toY, half, turnSign, color);
          return;
        }
        this._pushTriangleVertices(p2[0], p2[1], p2[0] + fromX, p2[1] + fromY, p2[0] + toX, p2[1] + toY, color);
      };
      const joinCount = isClosed ? n : Math.max(0, n - 2);
      for (let i = 0; i < joinCount; i++) {
        const vertexIndex = isClosed ? i : i + 1;
        const prevSeg = (vertexIndex - 1 + segCount) % segCount;
        const nextSeg = vertexIndex % segCount;
        emitJoin(vertexIndex, prevSeg, nextSeg);
      }
      if (!isClosed) {
        if (this._state.strokeCap === this.ROUND) {
          const d0 = normalize(path[1][0] - path[0][0], path[1][1] - path[0][1]);
          const d1 = normalize(path[n - 1][0] - path[n - 2][0], path[n - 1][1] - path[n - 2][1]);
          this._emitRoundCap(path[0], [-d0[0], -d0[1]], half, color);
          this._emitRoundCap(path[n - 1], [d1[0], d1[1]], half, color);
        }
      }
      if (useStencilStroke) {
        this._ensureBatch(blend, false, "stencilStrokeCover");
        this._pushCoverQuad(coverMinX, coverMinY, coverMaxX, coverMaxY, color);
      }
    }
    _shouldUseStencilStroke(closed, segmentCount, color) {
      if (!ENABLE_STENCIL_STROKES) return false;
      if (this._state.eraseMode || this._stencilUnavailable) return false;
      if (color[3] < 0.999) return true;
      return closed && segmentCount >= STENCIL_STROKE_SEGMENT_THRESHOLD;
    }
    _pushCoverQuad(minX, minY, maxX, maxY, color) {
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY) || maxX <= minX || maxY <= minY) {
        return;
      }
      this._pushTriangleVertices(minX, minY, maxX, minY, maxX, maxY, color);
      this._pushTriangleVertices(minX, minY, maxX, maxY, minX, maxY, color);
    }
    _emitRoundJoin(center, fromX, fromY, toX, toY, radius, sign2, color) {
      let a0 = Math.atan2(fromY, fromX);
      let a1 = Math.atan2(toY, toX);
      if (sign2 > 0) {
        while (a1 < a0) a1 += Math.PI * 2;
      } else {
        while (a1 > a0) a1 -= Math.PI * 2;
      }
      const delta = a1 - a0;
      const arcLen = Math.abs(delta) * radius;
      const steps = Math.min(64, Math.max(2, Math.ceil(arcLen / 3)));
      const cx = center[0], cy = center[1];
      let prevX = cx + Math.cos(a0) * radius;
      let prevY = cy + Math.sin(a0) * radius;
      for (let i = 1; i <= steps; i++) {
        const angle = a0 + delta * i / steps;
        const nextX = cx + Math.cos(angle) * radius;
        const nextY = cy + Math.sin(angle) * radius;
        this._pushTriangleVertices(cx, cy, prevX, prevY, nextX, nextY, color);
        prevX = nextX;
        prevY = nextY;
      }
    }
    _emitRoundCap(center, dir, radius, color) {
      const base = Math.atan2(dir[1], dir[0]);
      const start = base - Math.PI * 0.5;
      const end = base + Math.PI * 0.5;
      const steps = this.optimizedMode ? Math.min(64, Math.max(4, Math.ceil(Math.PI * radius / 6))) : Math.min(128, Math.max(8, Math.ceil(Math.PI * radius / 3)));
      const cx = center[0], cy = center[1];
      let prevX = cx + Math.cos(start) * radius;
      let prevY = cy + Math.sin(start) * radius;
      for (let i = 1; i <= steps; i++) {
        const angle = start + (end - start) * i / steps;
        const nextX = cx + Math.cos(angle) * radius;
        const nextY = cy + Math.sin(angle) * radius;
        this._pushTriangleVertices(cx, cy, prevX, prevY, nextX, nextY, color);
        prevX = nextX;
        prevY = nextY;
      }
    }
    /**
     * Wang's formula for cubic bezier subdivision count.
     * Returns the number of line segments needed to approximate the cubic bezier
     * within CURVE_TOLERANCE pixels of the true curve.
     */
    _wangCubicSegments(b0, b1, b2, b3) {
      const dx1 = b2[0] - 2 * b1[0] + b0[0];
      const dy1 = b2[1] - 2 * b1[1] + b0[1];
      const dx2 = b3[0] - 2 * b2[0] + b1[0];
      const dy2 = b3[1] - 2 * b2[1] + b1[1];
      const maxDeviation = Math.max(Math.hypot(dx1, dy1), Math.hypot(dx2, dy2));
      if (maxDeviation <= EPS) return CURVE_MIN_SEGMENTS;
      const strokeHalf = this._state.strokeWeight * this._estimatedStrokeScale() * 0.5;
      const tol = Math.min(CURVE_TOLERANCE, Math.max(0.05, strokeHalf * 0.1));
      const n = Math.ceil(Math.sqrt(Math.sqrt(3 / 8) * maxDeviation / tol));
      return Math.max(CURVE_MIN_SEGMENTS, Math.min(n, CURVE_MAX_SEGMENTS));
    }
    /**
     * Wang's formula for quadratic bezier subdivision count.
     */
    _wangQuadraticSegments(p0, p1, p2) {
      const dx = p2[0] - 2 * p1[0] + p0[0];
      const dy = p2[1] - 2 * p1[1] + p0[1];
      const maxDeviation = Math.hypot(dx, dy);
      if (maxDeviation <= EPS) return CURVE_MIN_SEGMENTS;
      const strokeHalf = this._state.strokeWeight * this._estimatedStrokeScale() * 0.5;
      const tol = Math.min(CURVE_TOLERANCE, Math.max(0.05, strokeHalf * 0.1));
      const n = Math.ceil(Math.sqrt(Math.sqrt(1 / 8) * maxDeviation / tol));
      return Math.max(CURVE_MIN_SEGMENTS, Math.min(n, CURVE_MAX_SEGMENTS));
    }
    /**
     * Converts 4 Catmull-Rom control points to 4 cubic bezier control points.
     * Uses the standard p5.js v2 catmullRomToBezier conversion.
     */
    _catmullRomToBezier(p0, p1, p2, p3, tightness) {
      const s = (1 - tightness) / 6;
      const b0 = [p1[0], p1[1]];
      const b1 = [p1[0] + (p2[0] - p0[0]) * s, p1[1] + (p2[1] - p0[1]) * s];
      const b2 = [p2[0] + (p1[0] - p3[0]) * s, p2[1] + (p1[1] - p3[1]) * s];
      const b3 = [p2[0], p2[1]];
      return [b0, b1, b2, b3];
    }
    _sampleCubicBezier(p0, p1, p2, p3, segments) {
      const steps = Math.max(2, Math.floor(segments));
      const out = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0];
        const y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1];
        out.push([x, y]);
      }
      return out;
    }
    _sampleQuadraticBezier(p0, p1, p2, segments) {
      const steps = Math.max(2, Math.floor(segments));
      const out = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
        const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
        out.push([x, y]);
      }
      return out;
    }
    _sampleCatmullRom(p0, p1, p2, p3, segments, tightness) {
      const steps = Math.max(2, Math.floor(segments));
      const t = (1 - tightness) * 0.5;
      const out = [];
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const u2 = u * u;
        const u3 = u2 * u;
        const a0 = -t * u3 + 2 * t * u2 - t * u;
        const a1 = (2 - t) * u3 + (t - 3) * u2 + 1;
        const a2 = (t - 2) * u3 + (3 - 2 * t) * u2 + t * u;
        const a3 = t * u3 - t * u2;
        const x = a0 * p0[0] + a1 * p1[0] + a2 * p2[0] + a3 * p3[0];
        const y = a0 * p0[1] + a1 * p1[1] + a2 * p2[1] + a3 * p3[1];
        out.push([x, y]);
      }
      return out;
    }
    _effectiveFillColor() {
      if (!this._state.eraseMode) return this._state.fillColor;
      const alpha = 1 - this._state.eraseFillStrength / 255;
      return [0, 0, 0, clamp(alpha)];
    }
    _effectiveStrokeColor() {
      if (!this._state.eraseMode) return this._state.strokeColor;
      const alpha = 1 - this._state.eraseStrokeStrength / 255;
      return [0, 0, 0, clamp(alpha)];
    }
    _currentBlendMode() {
      if (this._state.eraseMode) return this.REPLACE;
      return this._state.blendMode;
    }
    _estimatedStrokeScale() {
      const m = this._state.matrix;
      const sx = Math.hypot(m[0], m[1]);
      const sy = Math.hypot(m[2], m[3]);
      return Math.max(1e-4, (sx + sy) * 0.5);
    }
    _ensureBatch(blendMode, isText, kind) {
      const batchKind = kind ?? (isText ? "text" : "geom");
      const batch = this._batches[this._batches.length - 1];
      if (!batch || batch.blendMode !== blendMode || batch.isText !== isText || batch.kind !== batchKind) {
        const startVertex = isText ? this._textVertexCount : this._geomVertexCount;
        this._batches.push({ kind: batchKind, startVertex, vertexCount: 0, blendMode, isText });
      }
    }
    _ensureGeomStagingCapacity(floatsNeeded) {
      const required = this._geomStagingCursor + floatsNeeded;
      if (required <= this._geomStagingBuffer.length) return;
      let newSize = this._geomStagingBuffer.length;
      while (newSize < required) newSize *= 2;
      const newBuf = new Float32Array(newSize);
      newBuf.set(this._geomStagingBuffer);
      this._geomStagingBuffer = newBuf;
    }
    _pushVertex(x, y, color) {
      this._ensureGeomStagingCapacity(GEOM_FLOATS_PER_VERTEX);
      const c = this._geomStagingCursor;
      this._geomStagingBuffer[c] = x;
      this._geomStagingBuffer[c + 1] = y;
      this._geomStagingBuffer[c + 2] = color[0];
      this._geomStagingBuffer[c + 3] = color[1];
      this._geomStagingBuffer[c + 4] = color[2];
      this._geomStagingBuffer[c + 5] = color[3];
      this._geomStagingCursor = c + GEOM_FLOATS_PER_VERTEX;
      this._geomVertexCount += 1;
      const batch = this._batches[this._batches.length - 1];
      if (batch) batch.vertexCount += 1;
    }
    /** Push a full triangle (3 vertices) in one call — avoids per-vertex overhead. */
    _pushTriangleVertices(ax, ay, bx, by, cx, cy, color) {
      this._ensureGeomStagingCapacity(GEOM_FLOATS_PER_VERTEX * 3);
      const buf = this._geomStagingBuffer;
      const r = color[0], g3 = color[1], b = color[2], a = color[3];
      let c = this._geomStagingCursor;
      buf[c] = ax;
      buf[c + 1] = ay;
      buf[c + 2] = r;
      buf[c + 3] = g3;
      buf[c + 4] = b;
      buf[c + 5] = a;
      c += 6;
      buf[c] = bx;
      buf[c + 1] = by;
      buf[c + 2] = r;
      buf[c + 3] = g3;
      buf[c + 4] = b;
      buf[c + 5] = a;
      c += 6;
      buf[c] = cx;
      buf[c + 1] = cy;
      buf[c + 2] = r;
      buf[c + 3] = g3;
      buf[c + 4] = b;
      buf[c + 5] = a;
      this._geomStagingCursor = c + 6;
      this._geomVertexCount += 3;
      this._batches[this._batches.length - 1].vertexCount += 3;
    }
    _pushTextVertex(x, y, u, v, color) {
      this._textVertices.push(x, y, u, v, color[0], color[1], color[2], color[3]);
      this._textVertexCount += 1;
      const batch = this._batches[this._batches.length - 1];
      if (batch) batch.vertexCount += 1;
    }
    _rescaleBufferedTextUVs(scale) {
      if (!Number.isFinite(scale) || scale <= 0 || scale === 1) return;
      for (let i = 2; i < this._textVertices.length; i += 8) {
        this._textVertices[i] *= scale;
        this._textVertices[i + 1] *= scale;
      }
    }
    _ensureGeomVertexBuffer(requiredBytes) {
      if (this._geomVertexBuffer && requiredBytes <= this._geomVertexBufferCapacityBytes) return;
      const newSize = Math.max(requiredBytes, Math.ceil(this._geomVertexBufferCapacityBytes * 1.5), 64 * 1024);
      try {
        this._geomVertexBuffer?.destroy();
      } catch (_) {
      }
      this._geomVertexBuffer = this.device.createBuffer({
        size: newSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this._geomVertexBufferCapacityBytes = newSize;
    }
    _ensureTextVertexBuffer(requiredBytes) {
      if (this._textVertexBuffer && requiredBytes <= this._textVertexBufferCapacityBytes) return;
      const newSize = Math.max(requiredBytes, Math.ceil(this._textVertexBufferCapacityBytes * 1.5), 64 * 1024);
      try {
        this._textVertexBuffer?.destroy();
      } catch (_) {
      }
      this._textVertexBuffer = this.device.createBuffer({
        size: newSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this._textVertexBufferCapacityBytes = newSize;
    }
    _ensureStencilTexture(sampleCount) {
      if (this._stencilUnavailable) return null;
      if (this._stencilTexture && this._stencilTextureSampleCount === sampleCount) {
        return this._stencilTexture;
      }
      try {
        this._stencilTexture?.destroy();
      } catch (_) {
      }
      this._stencilTexture = null;
      this._stencilTextureSampleCount = 0;
      try {
        const texture = this.device.createTexture({
          size: { width: this.width, height: this.height },
          sampleCount,
          format: STENCIL_TEXTURE_FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this._stencilTexture = texture;
        this._stencilTextureSampleCount = sampleCount;
        return texture;
      } catch (_) {
        this._stencilUnavailable = true;
        return null;
      }
    }
    _stencilRenderPassAttachment(view) {
      return {
        view,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
        depthClearValue: 1,
        stencilLoadOp: "clear",
        stencilStoreOp: "store",
        stencilClearValue: 0
      };
    }
    _getStrokeStencilPipeline(sampleCount) {
      const cacheKey = `${sampleCount}`;
      const existing = this._strokeStencilPipelineCache.get(cacheKey);
      if (existing) return existing;
      const pipeline = this.device.createRenderPipeline({
        layout: this._geomPipelineLayout,
        vertex: {
          module: this._geomShaderModule,
          entryPoint: "vsMain",
          buffers: [
            {
              arrayStride: GEOM_BYTES_PER_VERTEX,
              stepMode: "vertex",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
                { shaderLocation: 1, offset: 8, format: "float32x4" }
              ]
            }
          ]
        },
        fragment: {
          module: this._geomShaderModule,
          entryPoint: "fsMain",
          targets: [
            {
              format: this.format,
              writeMask: 0
            }
          ]
        },
        primitive: {
          topology: "triangle-list"
        },
        depthStencil: {
          format: STENCIL_TEXTURE_FORMAT,
          depthCompare: "always",
          depthWriteEnabled: false,
          stencilFront: { compare: "always", passOp: "replace" },
          stencilBack: { compare: "always", passOp: "replace" },
          stencilReadMask: 255,
          stencilWriteMask: 255
        },
        multisample: {
          count: sampleCount
        }
      });
      this._strokeStencilPipelineCache.set(cacheKey, pipeline);
      return pipeline;
    }
    _getStencilCoverPipeline(mode, sampleCount) {
      const cacheKey = `${mode}:${sampleCount}`;
      const existing = this._stencilCoverPipelineCache.get(cacheKey);
      if (existing) return existing;
      const pipeline = this.device.createRenderPipeline({
        layout: this._geomPipelineLayout,
        vertex: {
          module: this._geomShaderModule,
          entryPoint: "vsMain",
          buffers: [
            {
              arrayStride: GEOM_BYTES_PER_VERTEX,
              stepMode: "vertex",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
                { shaderLocation: 1, offset: 8, format: "float32x4" }
              ]
            }
          ]
        },
        fragment: {
          module: this._geomShaderModule,
          entryPoint: "fsMain",
          targets: [
            {
              format: this.format,
              blend: resolveBlendState(mode),
              writeMask: GPUColorWrite.ALL
            }
          ]
        },
        primitive: {
          topology: "triangle-list"
        },
        depthStencil: {
          format: STENCIL_TEXTURE_FORMAT,
          depthCompare: "always",
          depthWriteEnabled: false,
          stencilFront: { compare: "equal", passOp: "zero" },
          stencilBack: { compare: "equal", passOp: "zero" },
          stencilReadMask: 255,
          stencilWriteMask: 255
        },
        multisample: {
          count: sampleCount
        }
      });
      this._stencilCoverPipelineCache.set(cacheKey, pipeline);
      return pipeline;
    }
    _getFillStencilPipeline(sampleCount) {
      const cacheKey = `${sampleCount}`;
      const existing = this._fillStencilPipelineCache.get(cacheKey);
      if (existing) return existing;
      const pipeline = this.device.createRenderPipeline({
        layout: this._geomPipelineLayout,
        vertex: {
          module: this._geomShaderModule,
          entryPoint: "vsMain",
          buffers: [
            {
              arrayStride: GEOM_BYTES_PER_VERTEX,
              stepMode: "vertex",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
                { shaderLocation: 1, offset: 8, format: "float32x4" }
              ]
            }
          ]
        },
        fragment: {
          module: this._geomShaderModule,
          entryPoint: "fsMain",
          targets: [
            {
              format: this.format,
              writeMask: 0
            }
          ]
        },
        primitive: {
          topology: "triangle-list"
        },
        depthStencil: {
          format: STENCIL_TEXTURE_FORMAT,
          depthCompare: "always",
          depthWriteEnabled: false,
          stencilFront: { compare: "always", passOp: "increment-wrap" },
          stencilBack: { compare: "always", passOp: "decrement-wrap" },
          stencilReadMask: 255,
          stencilWriteMask: 255
        },
        multisample: {
          count: sampleCount
        }
      });
      this._fillStencilPipelineCache.set(cacheKey, pipeline);
      return pipeline;
    }
    _getFillCoverPipeline(mode, sampleCount) {
      const cacheKey = `${mode}:${sampleCount}`;
      const existing = this._fillCoverPipelineCache.get(cacheKey);
      if (existing) return existing;
      const pipeline = this.device.createRenderPipeline({
        layout: this._geomPipelineLayout,
        vertex: {
          module: this._geomShaderModule,
          entryPoint: "vsMain",
          buffers: [
            {
              arrayStride: GEOM_BYTES_PER_VERTEX,
              stepMode: "vertex",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
                { shaderLocation: 1, offset: 8, format: "float32x4" }
              ]
            }
          ]
        },
        fragment: {
          module: this._geomShaderModule,
          entryPoint: "fsMain",
          targets: [
            {
              format: this.format,
              blend: resolveBlendState(mode),
              writeMask: GPUColorWrite.ALL
            }
          ]
        },
        primitive: {
          topology: "triangle-list"
        },
        depthStencil: {
          format: STENCIL_TEXTURE_FORMAT,
          depthCompare: "always",
          depthWriteEnabled: false,
          stencilFront: { compare: "not-equal", passOp: "zero" },
          stencilBack: { compare: "not-equal", passOp: "zero" },
          stencilReadMask: 255,
          stencilWriteMask: 255
        },
        multisample: {
          count: sampleCount
        }
      });
      this._fillCoverPipelineCache.set(cacheKey, pipeline);
      return pipeline;
    }
    _getGeomPipeline(mode, sampleCount) {
      const cacheKey = `${mode}:${sampleCount}`;
      const existing = this._geomPipelineCache.get(cacheKey);
      if (existing) return existing;
      const pipeline = this.device.createRenderPipeline({
        layout: this._geomPipelineLayout,
        vertex: {
          module: this._geomShaderModule,
          entryPoint: "vsMain",
          buffers: [
            {
              arrayStride: GEOM_BYTES_PER_VERTEX,
              stepMode: "vertex",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
                { shaderLocation: 1, offset: 8, format: "float32x4" }
              ]
            }
          ]
        },
        fragment: {
          module: this._geomShaderModule,
          entryPoint: "fsMain",
          targets: [
            {
              format: this.format,
              blend: resolveBlendState(mode),
              writeMask: GPUColorWrite.ALL
            }
          ]
        },
        primitive: {
          topology: "triangle-list"
        },
        multisample: {
          count: sampleCount
        }
      });
      this._geomPipelineCache.set(cacheKey, pipeline);
      return pipeline;
    }
    _getTextPipeline(mode, sampleCount, image = false) {
      const cacheKey = `${mode}:${sampleCount}:${image}`;
      const existing = this._textPipelineCache.get(cacheKey);
      if (existing) return existing;
      const pipeline = this.device.createRenderPipeline({
        layout: this._textPipelineLayout,
        vertex: {
          module: image ? this._imageShaderModule : this._textShaderModule,
          entryPoint: "vsText",
          buffers: [
            {
              arrayStride: TEXT_BYTES_PER_VERTEX,
              stepMode: "vertex",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
                { shaderLocation: 1, offset: 8, format: "float32x2" },
                { shaderLocation: 2, offset: 16, format: "float32x4" }
              ]
            }
          ]
        },
        fragment: {
          module: image ? this._imageShaderModule : this._textShaderModule,
          entryPoint: "fsText",
          targets: [
            {
              format: this.format,
              blend: resolveBlendState(mode),
              writeMask: GPUColorWrite.ALL
            }
          ]
        },
        primitive: {
          topology: "triangle-list"
        },
        multisample: {
          count: sampleCount
        }
      });
      this._textPipelineCache.set(cacheKey, pipeline);
      return pipeline;
    }
  };

  // ../../apps/deno-notebooks/tools/p5gpu_text/layout.ts
  function parseBinaryLayout(buffer, byteLength) {
    const emptyResult = {
      glyphs: [],
      tightWidth: 0,
      fontWidth: 0,
      ascent: 0,
      descent: 0,
      fontAscent: 0,
      fontDescent: 0,
      fontCapHeight: 0,
      firstBaseline: 0,
      totalHeight: 0,
      lineCount: 0
    };
    if (byteLength < 44) return emptyResult;
    const dv = new DataView(buffer.buffer, buffer.byteOffset, byteLength);
    const tightWidth = dv.getFloat32(0, true);
    const fontWidth = dv.getFloat32(4, true);
    const ascent = dv.getFloat32(8, true);
    const descent = dv.getFloat32(12, true);
    const fontAscent = dv.getFloat32(16, true);
    const fontDescent = dv.getFloat32(20, true);
    const fontCapHeight = dv.getFloat32(24, true);
    const firstBaseline = dv.getFloat32(28, true);
    const totalHeight = dv.getFloat32(32, true);
    const lineCount = dv.getFloat32(36, true);
    const glyphCount = dv.getUint32(40, true);
    const expectedSize = 44 + glyphCount * 20;
    if (byteLength < expectedSize) return emptyResult;
    const glyphs = new Array(glyphCount);
    let offset = 44;
    for (let i = 0; i < glyphCount; i++) {
      const key = dv.getBigUint64(offset, true);
      const x = dv.getInt32(offset + 8, true);
      const y = dv.getInt32(offset + 12, true);
      const cluster = dv.getUint32(offset + 16, true);
      glyphs[i] = { key, x, y, cluster };
      offset += 20;
    }
    return {
      glyphs,
      tightWidth,
      fontWidth,
      ascent,
      descent,
      fontAscent,
      fontDescent,
      fontCapHeight,
      firstBaseline,
      totalHeight,
      lineCount
    };
  }

  // src/text-core.ts
  var HostTextEngine = class {
    constructor(native) {
      this.native = native;
    }
    cache = /* @__PURE__ */ new Map();
    dispose() {
      this.native?.dispose();
      this.native = null;
      this.cache.clear();
    }
    loadFontBytes(bytes) {
      const loaded = this.engine().loadFontBytes(bytes);
      if (loaded) this.cache.clear();
      return loaded;
    }
    layoutText(req) {
      const engine = this.engine();
      const request = {
        ...req,
        width: req.width ?? -1,
        height: req.height ?? -1,
        weight: Math.max(1, Math.min(1e3, Math.round(req.weight))),
        axesJson: JSON.stringify(req.axes),
        disableLigatures: req.disableLigatures ? 1 : 0
      };
      const key = JSON.stringify(request);
      const cached = this.cache.get(key);
      if (cached) return cached;
      const bytes = engine.layout(request);
      const result = parseBinaryLayout(bytes, bytes.length);
      if (result.glyphs.length || result.lineCount) {
        if (this.cache.size >= 16384) this.cache.clear();
        this.cache.set(key, result);
      }
      return result;
    }
    rasterizeGlyph(key) {
      return this.engine().rasterizeGlyph(key);
    }
    engine() {
      if (!this.native) throw new Error("Text engine is disposed");
      return this.native;
    }
  };

  // src/embedded.ts
  var EmbeddedP5GPU = class extends P5GPU {
    constructor(device2, options, fonts2) {
      super(device2, options, {
        createTextEngine: () => {
          const engine = new HostTextEngine(new nativeText.TextEngine());
          try {
            for (const font of fonts2) if (!engine.loadFontBytes(readFile(font))) throw new Error(`Could not load font ${font}`);
          } catch (error) {
            engine.dispose();
            throw error;
          }
          return engine;
        },
        readFile: async (path) => readFile(String(path))
      });
    }
  };

  // src/td-parameters.ts
  function parameterSnapshot(value = {}) {
    const result = /* @__PURE__ */ Object.create(null);
    for (const [name, item] of Object.entries(value)) result[name] = Array.isArray(item) ? Object.freeze(item) : item;
    return Object.freeze(result);
  }

  // ../core-timing/mod.ts
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

  // ../core-timing/priority_queue.ts
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

  // ../core-timing/seedrandom_shim.ts
  var import_seedrandom = __toESM(require_seedrandom2());
  var seedrandom_shim_default = import_seedrandom.default;

  // ../core-timing/offline_time_context.ts
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
    if (typeof g3.MessageChannel === "function") {
      const mc = new g3.MessageChannel();
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
    if (typeof g3.MessageChannel === "function") {
      const mc = new g3.MessageChannel();
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

  // src/td-timing.ts
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
    dispose() {
      if (!this.active) return;
      this.disposing = true;
      this.run(() => this.cancelRoots());
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

  // src/td-runtime.ts
  var g2 = globalThis;
  Object.assign(g2, nativeGPU.globals);
  var fonts = JSON.parse(__avFontsJSON);
  var device;
  var p;
  var sketch;
  var staging;
  var width = 0;
  var height = 0;
  var stride = 0;
  var blocked = false;
  var images = [];
  var channels = [];
  var incomingChannels = [];
  var params = parameterSnapshot({});
  var controlsMeta = { sampleRate: 0, startIndex: 0 };
  var message = (error) => String(error?.stack ?? error);
  g2.__avDone = false;
  g2.__avError = "";
  g2.__avBytes = null;
  g2.__avPulseNames = "[]";
  g2.__avSyphonClients = 0;
  g2.__avSyphonPublished = 0;
  g2.__avSyphonDropped = 0;
  var syphon;
  var syphonName = "";
  var lifetime;
  var sketchP;
  var latestControls = () => Object.freeze({ ...controlsMeta, channels: Object.freeze(channels.map((c) => Object.freeze({ name: c.name, samples: c.samples.slice() }))) });
  var chop = (name, index = 0) => channels.find((channel) => channel.name === name)?.samples[index] ?? 0;
  (async () => {
    const gpu = nativeGPU.create(["backend=metal", "avtools-event-driven=1"]);
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error("No Metal adapter");
    device = await adapter.requestDevice();
    device.addEventListener("uncapturederror", (event) => {
      g2.__avError = event.error.message;
      blocked = true;
    });
    device.lost.then((info) => {
      blocked = true;
      g2.__avError = `Device lost: ${info.message}; reset the operator`;
    });
  })().catch((error) => {
    g2.__avError = message(error);
  }).finally(() => {
    g2.__avDone = true;
  });
  g2.__avInputs = () => {
    incomingChannels = [];
  };
  g2.__avChannel = (name) => {
    incomingChannels.push({ name, samples: new Float32Array(__avData.buffer, __avData.byteOffset, __avData.byteLength / 4) });
  };
  g2.__avImage = (index, w, h) => {
    let image = images[index];
    if (!image || image.texture.width !== w || image.texture.height !== h) {
      image?.texture.destroy();
      image = { texture: device.createTexture({ size: [w, h], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING }) };
      images[index] = image;
    }
    device.queue.writeTexture({ texture: image.texture }, __avData, { bytesPerRow: w * 4 }, [w, h]);
  };
  g2.__avTrimImages = (count) => {
    channels = incomingChannels;
    const f = JSON.parse(__avFrameJSON);
    params = parameterSnapshot(f.params);
    controlsMeta = { sampleRate: f.sampleRate, startIndex: f.startIndex };
    for (const image of images.splice(count)) image.texture.destroy();
  };
  g2.__avRender = async () => {
    g2.__avDone = false;
    g2.__avError = "";
    g2.__avHasFrame = false;
    g2.__avRendered = false;
    g2.__avDrawMs = 0;
    g2.__avReadbackMs = 0;
    const frame = JSON.parse(__avFrameJSON);
    frame.params = params;
    try {
      if (!device) throw new Error("GPU initialization failed");
      if (!lifetime) {
        lifetime = new SketchLifetime();
        sketch = lifetime.run(() => new Function(`${__avSource}
;return {setup:typeof setup==='function'?setup:undefined,draw:typeof draw==='function'?draw:undefined,onPulse:typeof onPulse!=='undefined'?onPulse:undefined};`)());
        if (typeof sketch.draw !== "function") throw new Error("Sketch must define function draw(p, frame)");
        p = new EmbeddedP5GPU(device, { width: frame.width, height: frame.height, sampleCount: 1 }, fonts);
        sketchP = lifetime.guard(p);
        const life = lifetime;
        const host = Object.freeze({ get params() {
          return params;
        }, device: life.guard(device), readFile: (path) => life.run(() => g2.readFile(path)), timing: life.timing, onDispose: (callback) => life.onDispose(callback), chop, latestControls });
        await life.run(() => sketch.setup?.(sketchP, host));
        if (life.error) throw new Error(life.error);
        width = frame.width;
        height = frame.height;
        stride = Math.ceil(width * 4 / 256) * 256;
        staging = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        g2.__avPulseNames = JSON.stringify(sketch.onPulse && typeof sketch.onPulse === "object" ? Object.keys(sketch.onPulse).filter((name) => typeof sketch.onPulse[name] === "function") : []);
      }
      if (!p || !sketch) throw new Error("No valid sketch");
      if (lifetime?.error) throw new Error(lifetime.error);
      if (g2.__avBackgroundError) throw new Error(g2.__avBackgroundError);
      if (blocked) throw new Error("Draw stopped after an error; edit the source or reset");
      await g2.__hostFrame();
      frame.time = (frame.frame - 1) / frame.rate;
      frame.controls = Object.freeze({ sampleRate: frame.sampleRate, startIndex: frame.startIndex, channels });
      frame.chop = chop;
      frame.top = (index) => images[index];
      if (syphonName !== __avSyphonName) {
        syphon?.dispose();
        syphon = void 0;
        syphonName = __avSyphonName;
        if (syphonName) syphon = new nativeGPU.NativeSyphon(device, syphonName, false);
      }
      if (frame.syphonOnly && !syphon) throw new Error("Syphon-only output requires an enabled, named Syphon channel");
      const drawStart = g2.hostNow();
      p.beginFrame();
      try {
        for (const name of JSON.parse(__avPulsesJSON)) {
          const handler = typeof sketch.onPulse === "function" ? () => sketch.onPulse(name, sketchP, frame) : () => sketch.onPulse?.[name]?.(sketchP, frame);
          const result = lifetime.run(handler);
          if (result && typeof result.then === "function") {
            result.catch(() => {
            });
            throw new Error("Pulse handlers must be synchronous");
          }
        }
        const value = lifetime.run(() => sketch.draw(sketchP, frame));
        if (value && typeof value.then === "function") {
          value.catch(() => {
          });
          throw new Error("draw() must be synchronous; prepare async assets in setup()");
        }
      } catch (error) {
        blocked = true;
        throw error;
      }
      const texture = p.endFrame();
      syphon?.publish(texture, true, { x: 0, y: 0, width, height });
      const syphonStats = syphon?.stats();
      g2.__avSyphonClients = Number(syphonStats?.hasClients ?? false);
      g2.__avSyphonPublished = syphonStats?.published ?? 0;
      g2.__avSyphonDropped = syphonStats?.dropped ?? 0;
      g2.__avRendered = true;
      if (frame.syphonOnly) {
        g2.__avDrawMs = g2.hostNow() - drawStart;
        g2.__avError = "";
        return;
      }
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture }, { buffer: staging, bytesPerRow: stride }, [width, height]);
      device.queue.submit([encoder.finish()]);
      g2.__avSubmitted = true;
      g2.__avDrawMs = g2.hostNow() - drawStart;
      const readbackStart = g2.hostNow();
      await staging.mapAsync(GPUMapMode.READ);
      g2.__avReadbackMs = g2.hostNow() - readbackStart;
      g2.__avBytes = new Uint8Array(staging.getMappedRange());
      g2.__avHasFrame = true;
      g2.__avError = "";
    } catch (error) {
      g2.__avError = message(error);
    } finally {
      g2.__avDone = true;
    }
  };
  g2.__avUnmap = () => {
    g2.__avBytes = null;
    if (staging?.mapState === "mapped") staging.unmap();
  };
  g2.__avDispose = () => {
    g2.__avDone = false;
    lifetime?.dispose();
    g2.__avUnmap();
    syphon?.dispose();
    for (const image of images) image.texture.destroy();
    images = [];
    p?.dispose();
    staging?.destroy();
    device?.destroy();
    g2.__avDone = true;
  };
})();
