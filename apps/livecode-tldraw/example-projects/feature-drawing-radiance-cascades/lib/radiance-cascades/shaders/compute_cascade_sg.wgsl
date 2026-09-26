// Browser-only copy of the compute cascade for devices with WebGPU
// subgroups. The renderer prepends `enable subgroups;` at module creation
// (naga does not parse the directive yet but validates the builtins without
// it, so gen_shaders still checks this file; Deno's device cannot run it).
// Cascade 0 maps a lane to one (probe, direction), direction fastest, so a
// probe's DW lanes sit in one subgroup: the direction mean is a subgroup
// reduction and the bounce-band slot a subgroup shuffle, with no workgroup
// memory or barrier, and the marching parallelism comes from lanes rather
// than one lane's serial loop over directions. Levels above cascade 0 use
// compute_cascade.wgsl unchanged. A subgroup size that DW does not divide
// falls back to a workgroup-memory reduction.

// #include "compute_cascade_common.wgsl"

var<workgroup> fallbackSum: array<vec3f, TX * TY * DW>;
var<workgroup> fallbackSlot: array<u32, TX * TY>;

@compute @workgroup_size(TX * TY * DW, 1, 1)
fn main(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(local_invocation_index) li: u32,
  @builtin(subgroup_invocation_id) sid: u32,
  @builtin(subgroup_size) subgroupSize: u32,
) {
  let lanes = TX * TY * DW;
  let laneDir = li % DW;
  let laneProbe = li / DW;
  let lid = vec2u(laneProbe % TX, laneProbe / TX);
  let tileOrigin = vec2i(wg.xy * vec2u(TX, TY));
  let sceneDims = vec2i(u.sceneSize);

  stageWorkgroup(tileOrigin, 0u, li, lanes);
  let group = select(1u, u.branching, PRE_AVERAGE);

  let probe = tileOrigin + vec2i(lid);
  let live = all(probe < vec2i(u.probeCount)) && laneDir < u.storedDirs;
  let probeIndex = u32(probe.y) * u.probeCount.x + u32(probe.x);
  let probes = u.probeCount.x * u.probeCount.y;
  let center = (vec2f(probe) + 0.5) * u.probeSpacing;

  var m = Merged(vec3f(0.0), vec3f(0.0), vec3f(0.0));
  if (live) {
    m = castStored(center, laneDir, group);
    let entry = laneDir * probes + probeIndex;
    if (u.storeDirs != 0u) {
      storeEntry(entry, m);
    }
    if (u.storeRaw != 0u) {
      rawStore[entry * 2u] = pack2x16float(m.raw.rg);
      rawStore[entry * 2u + 1u] = pack2x16float(vec2f(m.raw.b, 0.0));
    }
  }

  // The probe's first direction lane claims its bounce-band slot.
  var slot = 0u;
  if (live && laneDir == 0u) {
    let d = sceneDistance(clamp(vec2i(floor(center)), vec2i(0), sceneDims - vec2i(1)));
    if (d < u.bandWidth) {
      let claimed = atomicAdd(&bandCounter.n, 1u);
      slot = select(0u, claimed + 1u, claimed < u.bandCapacity);
    }
    slotMap[probeIndex] = slot;
  }

  var sum = vec3f(0.0);
  if (subgroupSize % DW == 0u) {
    // A probe's lanes are one aligned run inside a subgroup.
    let groupInSubgroup = sid / DW;
    slot = subgroupShuffle(slot, groupInSubgroup * DW);
    let groups = subgroupSize / DW;
    for (var p = 0u; p < groups; p++) {
      let s = subgroupAdd(select(vec3f(0.0), m.L, groupInSubgroup == p));
      if (groupInSubgroup == p) {
        sum = s;
      }
    }
  } else {
    fallbackSum[li] = m.L;
    if (laneDir == 0u) {
      fallbackSlot[laneProbe] = slot;
    }
    workgroupBarrier();
    slot = fallbackSlot[laneProbe];
    for (var k = 0u; k < DW; k++) {
      sum += fallbackSum[laneProbe * DW + k];
    }
  }

  if (live && slot != 0u) {
    let i = ((slot - 1u) * DW + laneDir) * 2u;
    band[i] = pack2x16float(m.L.rg);
    band[i + 1u] = pack2x16float(vec2f(m.L.b, 0.0));
  }
  if (live && laneDir == 0u) {
    textureStore(irradianceOut, probe, vec4f(sum / f32(u.storedDirs), 1.0));
  }
}
