import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVolumetricNailGeometry,
  V13_NAIL_DORSAL_OFFSET_MULT,
  V13_DISTAL_CYL_PALMAR_SHIFT,
  V13_DISTAL_CYL_RADIUS_MULT,
  V13_DIP_SPHERE_PALMAR_SHIFT,
  V13_DIP_SPHERE_RADIUS_MULT,
  V13_PULP_SPHERE_PALMAR_SHIFT,
  V13_PULP_SPHERE_RADIUS_MULT,
} from '../src/lib/nail3DGeometry.ts';
import type { FingerId, NailShape } from '../src/types/nail.ts';

const FINGERS: FingerId[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const SHAPES: NailShape[] = ['almond', 'coffin', 'stiletto', 'oval', 'square', 'natural'];

// Realistic phalanx radius and nail width in meters per finger
const FINGER_METRICS: Record<FingerId, { r: number; nailW: number }> = {
  thumb: { r: 0.0092, nailW: 0.0156 },
  index: { r: 0.0074, nailW: 0.0124 },
  middle: { r: 0.0078, nailW: 0.0130 },
  ring: { r: 0.0072, nailW: 0.0120 },
  pinky: { r: 0.0062, nailW: 0.0102 },
};

test('V13 Zero Auto-Clipping: all 3 distal occluder ceilings stay strictly below nail mesh min-Z (margin >= 0.15 * r) for all 5 fingers x 6 shapes', () => {
  const distalCylCeiling = (V13_DISTAL_CYL_PALMAR_SHIFT + V13_DISTAL_CYL_RADIUS_MULT);
  const dipSphereCeiling = (V13_DIP_SPHERE_PALMAR_SHIFT + V13_DIP_SPHERE_RADIUS_MULT);
  const pulpSphereCeiling = (V13_PULP_SPHERE_PALMAR_SHIFT + V13_PULP_SPHERE_RADIUS_MULT);

  assert.ok(distalCylCeiling <= 0.35, `Distal cylinder ceiling too high: ${distalCylCeiling}`);
  assert.ok(dipSphereCeiling <= 0.53, `DIP sphere ceiling too high: ${dipSphereCeiling}`);
  assert.ok(pulpSphereCeiling <= 0.41, `Pulp sphere ceiling too high: ${pulpSphereCeiling}`);

  for (const finger of FINGERS) {
    const { r, nailW } = FINGER_METRICS[finger];
    // V13 realistic bed width (0.94 * nailW) and dorsal offset (+0.84 * r)
    const effectiveNailW = nailW * 0.94;
    const dorsalOffset = r * V13_NAIL_DORSAL_OFFSET_MULT;

    const maxDistalCylZ = distalCylCeiling * r;
    const maxDipSphereZ = dipSphereCeiling * r;
    const maxPulpSphereZ = pulpSphereCeiling * r;

    for (const shape of SHAPES) {
      const geo = createVolumetricNailGeometry(shape, { bedFraction: 0.58 });
      const pos = geo.getAttribute('position');
      let minNailZ = Infinity;
      let minCuticleZ = Infinity;

      for (let i = 0; i < pos.count; i++) {
        const localY = pos.getY(i);
        const localZ = pos.getZ(i);
        const worldZAlongAxis = dorsalOffset + localZ * effectiveNailW;
        if (worldZAlongAxis < minNailZ) minNailZ = worldZAlongAxis;
        if (localY <= 0.15 && worldZAlongAxis < minCuticleZ) {
          minCuticleZ = worldZAlongAxis;
        }
      }

      const marginCyl = minNailZ - maxDistalCylZ;
      const marginPulp = minNailZ - maxPulpSphereZ;
      // DIP sphere sits near cuticle base (v <= 0.15)
      const marginDip = minCuticleZ - maxDipSphereZ;

      assert.ok(
        marginCyl >= 0.15 * r,
        `[${finger}/${shape}] Distal cylinder clipped nail! margin=${(marginCyl / r).toFixed(3)}r (need >= 0.15r)`
      );
      assert.ok(
        marginPulp >= 0.15 * r,
        `[${finger}/${shape}] Pulp sphere clipped nail! margin=${(marginPulp / r).toFixed(3)}r (need >= 0.15r)`
      );
      assert.ok(
        marginDip >= 0.15 * r,
        `[${finger}/${shape}] DIP sphere clipped cuticle! margin=${(marginDip / r).toFixed(3)}r (need >= 0.15r)`
      );
      geo.dispose();
    }
  }
});
