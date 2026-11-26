import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BiomechanicalSignGuard,
  computeFingerAnatomicalBasis,
  computePalmDorsalNormal,
  projectHandToPerspectiveMeters,
  verifyDorsalSignFromBiomechanics,
} from '../src/lib/handKinematics.ts';
import type { FingerId } from '../src/types/nail.ts';

function makeSyntheticHand(
  handedness: 'Left' | 'Right',
  palmFacing: boolean,
  flexDeg = 0
) {
  // MediaPipe world coordinates: +x right, +y down, +z away from camera
  // Back of Right hand facing camera: index on -x, pinky on +x
  // Back of Left hand facing camera: index on +x, pinky on -x
  // Flipping to palm reverses left/right!
  const handSign = handedness === 'Right' ? 1 : -1;
  const sideSign = (palmFacing ? -1 : 1) * handSign;
  const bendSign = palmFacing ? -1 : 1; // flexion bends toward palm (+z when back-facing, -z when palm-facing)
  const rad = (flexDeg * Math.PI) / 180;

  const w = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  w[0] = { x: 0, y: 0.085, z: 0 };
  w[1] = { x: -0.025 * sideSign, y: 0.055, z: 0.005 * bendSign };
  w[2] = { x: -0.048 * sideSign, y: 0.030, z: 0.002 * bendSign };
  w[3] = { x: -0.064 * sideSign, y: 0.008, z: -0.003 * bendSign };
  w[4] = { x: -0.076 * sideSign, y: -0.012, z: -0.006 * bendSign };

  const xOffsets = [-0.030, -0.008, 0.014, 0.034];
  const bases = [5, 9, 13, 17];
  const lens = [0.038, 0.026, 0.020];
  bases.forEach((b, fi) => {
    const x = xOffsets[fi] * sideSign;
    w[b] = { x, y: 0, z: 0 };
    w[b + 1] = { x, y: -lens[0], z: 0 };
    const pipAngle = rad * 0.55;
    const dipAngle = rad;
    w[b + 2] = {
      x,
      y: w[b + 1].y - lens[1] * Math.cos(pipAngle),
      z: w[b + 1].z + bendSign * lens[1] * Math.sin(pipAngle),
    };
    w[b + 3] = {
      x,
      y: w[b + 2].y - lens[2] * Math.cos(dipAngle),
      z: w[b + 2].z + bendSign * lens[2] * Math.sin(dipAngle),
    };
  });

  const landmarks = w.map((p) => ({
    x: 0.5 + p.x * 2.2,
    y: 0.55 + p.y * 1.1, // isotropic with RECT (400x800) so 1m maps to identical pixels in X and Y
    z: p.z,
  }));

  return { landmarks, worldLandmarks: w, handedness };
}

const RECT = { drawX: 0, drawY: 0, drawW: 400, drawH: 800 };
const NON_THUMB: FingerId[] = ['index', 'middle', 'ring', 'pinky'];

test('V13 Hand Kinematics: det(M) === +1 and axisZ.z > +0.8 in all 4 dorsal scenarios, axisZ.z < -0.8 in all 4 palmar scenarios', () => {
  for (const handedness of ['Right', 'Left'] as const) {
    for (const mirrorX of [false, true]) {
      // Dorsal facing camera
      const dorsal = makeSyntheticHand(handedness, false, 0);
      const projDorsal = projectHandToPerspectiveMeters(
        dorsal.landmarks,
        dorsal.worldLandmarks,
        RECT,
        400,
        800,
        58,
        mirrorX
      );
      for (const f of NON_THUMB) {
        const m = computeFingerAnatomicalBasis(f, projDorsal.points3D, handedness, mirrorX);
        assert.ok(Math.abs(m.determinant() - 1) < 1e-4, `det != +1 on dorsal ${handedness} mirror=${mirrorX} ${f}`);
        const z = new THREE.Vector3().setFromMatrixColumn(m, 2);
        assert.ok(z.z > 0.8, `Expected dorsal axisZ.z > +0.8 on ${handedness} mirror=${mirrorX} ${f}, got ${z.z.toFixed(3)}`);
      }

      // Palm facing camera
      const palmar = makeSyntheticHand(handedness, true, 0);
      const projPalmar = projectHandToPerspectiveMeters(
        palmar.landmarks,
        palmar.worldLandmarks,
        RECT,
        400,
        800,
        58,
        mirrorX
      );
      for (const f of NON_THUMB) {
        const m = computeFingerAnatomicalBasis(f, projPalmar.points3D, handedness, mirrorX);
        assert.ok(Math.abs(m.determinant() - 1) < 1e-4, `det != +1 on palmar ${handedness} mirror=${mirrorX} ${f}`);
        const z = new THREE.Vector3().setFromMatrixColumn(m, 2);
        assert.ok(z.z < -0.8, `Expected palmar axisZ.z < -0.8 on ${handedness} mirror=${mirrorX} ${f}, got ${z.z.toFixed(3)}`);
      }
    }
  }
});

test('V13 Biomechanical Sign Guard: detects & flips inverted handedness after 8 frames when fingers flex > 20 deg', () => {
  // Real Right hand flexed 40 deg with back facing camera, but MediaPipe mislabels it as 'Left'!
  const flexedRight = makeSyntheticHand('Right', false, 40);
  const proj = projectHandToPerspectiveMeters(
    flexedRight.landmarks,
    flexedRight.worldLandmarks,
    RECT,
    400,
    800,
    58,
    false
  );

  // Wrong handedness 'Left' produces inverted palm dorsal normal
  const wrongNormal = computePalmDorsalNormal(proj.points3D, 'Left', false);
  const bioCheck = verifyDorsalSignFromBiomechanics(proj.points3D, wrongNormal);
  assert.equal(bioCheck.needsFlip, true, 'Biomechanical validator must detect impossible backward finger flexion');
  assert.ok(bioCheck.avgFlexDeg > 20, `Expected avgFlexDeg > 20, got ${bioCheck.avgFlexDeg}`);

  // Hysteresis guard must flip from 'Left' to 'Right' after 8 consecutive frames
  const guard = new BiomechanicalSignGuard();
  let corrected: 'Left' | 'Right' = 'Left';
  for (let frame = 0; frame < 8; frame++) {
    corrected = guard.update(proj.points3D, 'Left', false);
  }
  assert.equal(corrected, 'Right', 'BiomechanicalSignGuard must correct inverted handedness to Right after 8 frames');
});
