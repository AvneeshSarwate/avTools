// One cascade level as a compute pass. A lane is one (probe, stored direction);
// a workgroup is a TX x TY tile of probes times DW consecutive stored
// directions, laid out 1D with the probe fastest, so a SIMD group holds
// neighbouring probes marching the same direction (as the fragment tiling
// does) rather than one probe's divergent directions. Levels are stored in
// storage buffers, direction-major (dir * probes + probe), each entry three
// u32 of packed f16: radiance rgb and transmittance rgb. What the fragment
// version cannot do:
//
// - USE_PATCH: the scene texels every ray of the tile can touch (tile extent
//   plus a halo) are loaded into workgroup memory once and marched there.
//   Worth it where many short rays share a small patch (cascade 0 with the
//   bilinear fix); the planner decides per level.
// - USE_FOOT: the upper-level probes and directions this tile merges with are
//   staged in workgroup memory once instead of being re-read per lane.
// - REDUCE (cascade 0): a lane is one probe and loops over all of its
//   stored directions, so a SIMD group of neighbouring probes marches one
//   direction at a time (as the fragment tiling does), the direction mean
//   stays in registers and goes straight to the irradiance texture, and
//   cascade 0 is never stored. Probes within `bandWidth` of an outline also
//   append their directional radiance to a compact band buffer (atomic slot
//   counter) for the bounce pass. Needs no workgroup memory or barrier.
// Rays are otherwise identical to cascade.wgsl (merge modes, pre-averaging,
// overlap, sky).

// #include "compute_cascade_common.wgsl"

@compute @workgroup_size(TX * TY * DW, 1, 1)
fn main(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let lanes = TX * TY * DW;
  let laneProbe = li % (TX * TY);
  let laneDir = li / (TX * TY);
  let lid = vec2u(laneProbe % TX, laneProbe / TX);
  let tileOrigin = vec2i(wg.xy * vec2u(TX, TY));
  let dir0 = wg.z * DW;
  let sceneDims = vec2i(u.sceneSize);

  stageWorkgroup(tileOrigin, dir0, li, lanes);
  let group = select(1u, u.branching, PRE_AVERAGE);

  let probe = tileOrigin + vec2i(lid);
  let live = all(probe < vec2i(u.probeCount));
  let probeIndex = u32(probe.y) * u.probeCount.x + u32(probe.x);
  let probes = u.probeCount.x * u.probeCount.y;
  if (!live) {
    return;
  }
  let center = (vec2f(probe) + 0.5) * u.probeSpacing;

  if (REDUCE) {
    // Band membership first: this lane's probe, all its directions.
    var slot = 0u;
    let d = sceneDistance(clamp(vec2i(floor(center)), vec2i(0), sceneDims - vec2i(1)));
    if (d < u.bandWidth) {
      let claimed = atomicAdd(&bandCounter.n, 1u);
      slot = select(0u, claimed + 1u, claimed < u.bandCapacity);
    }
    slotMap[probeIndex] = slot;
    var sum = vec3f(0.0);
    for (var stored = 0u; stored < u.storedDirs; stored++) {
      let m = castStored(center, stored, group);
      sum += m.L;
      let entry = stored * probes + probeIndex;
      if (u.storeDirs != 0u) {
        storeEntry(entry, m);
      }
      if (u.storeRaw != 0u) {
        rawStore[entry * 2u] = pack2x16float(m.raw.rg);
        rawStore[entry * 2u + 1u] = pack2x16float(vec2f(m.raw.b, 0.0));
      }
      if (slot != 0u) {
        let i = ((slot - 1u) * u.storedDirs + stored) * 2u;
        band[i] = pack2x16float(m.L.rg);
        band[i + 1u] = pack2x16float(vec2f(m.L.b, 0.0));
      }
    }
    textureStore(irradianceOut, probe, vec4f(sum / f32(u.storedDirs), 1.0));
    return;
  }

  let stored = dir0 + laneDir;
  if (stored >= u.storedDirs) {
    return;
  }
  let m = castStored(center, stored, group);
  let entry = stored * probes + probeIndex;
  if (u.storeDirs != 0u) {
    storeEntry(entry, m);
  }
  if (u.storeRaw != 0u) {
    rawStore[entry * 2u] = pack2x16float(m.raw.rg);
    rawStore[entry * 2u + 1u] = pack2x16float(vec2f(m.raw.b, 0.0));
  }
}
