import test from 'node:test';
import assert from 'node:assert/strict';
import { generateNailTechnicalSheet } from '../src/lib/nailTechnicalSheet.ts';
import { sanitizeManufacturingSpec } from '../api/reconstruct-nail.ts';
import {
  runDeepPerFingerReconstruction,
  sanitizeManufacturingSpecClient,
} from '../src/lib/deepNailReconstructor.ts';
import type {
  FingerId,
  Nail3DManufacturingSpec,
  NailFingerDesignSpec,
} from '../src/types/nail.ts';

function buildFingerSpec(
  fingerId: FingerId,
  mSpec: Nail3DManufacturingSpec
): NailFingerDesignSpec {
  return {
    fingerId,
    shape: mSpec.shape,
    baseColor: mSpec.trueBaseColorHex,
    secondaryColor: mSpec.secondaryColorHex,
    pattern: mSpec.borderType === 'classic_french' ? 'french_tip' : 'solid',
    hasMetallicOutline: mSpec.borderIsMetallic,
    relativeLength: Number((1 + mSpec.freeEdgeRatio).toFixed(2)),
    relativeWidth: 1,
    freeEdgeRatio: mSpec.freeEdgeRatio,
    detectedFromPhoto: true,
    manufacturingSpec: mSpec,
  };
}

test('V14 Technical Sheet: stiletto com polegar branco #F6F2EC, francesinha, anelar filha única #4A2C22 com traço dourado 3D e acessórios 3D', () => {
  const whiteFrenchBase = (fingerId: FingerId): Nail3DManufacturingSpec =>
    sanitizeManufacturingSpecClient(
      {
        fingerId,
        handSide: 'Right',
        renderStrategy: 'procedural_pbr_3d',
        shape: 'stiletto',
        freeEdgeRatio: 0.72,
        finishType: 'solid_gloss_gel',
        trueBaseColorHex: '#F6F2EC',
        secondaryColorHex: '#FFFFFF',
        borderType: 'classic_french',
        borderColorHex: '#FFFFFF',
        borderIsMetallic: false,
        borderIs3DRaised: false,
        strokes3D: [],
        motifs: [],
        accessories3D: [],
      },
      fingerId,
      'Right'
    );

  const ringAccentSpec = sanitizeManufacturingSpecClient(
    {
      fingerId: 'ring',
      handSide: 'Right',
      renderStrategy: 'procedural_pbr_3d',
      shape: 'stiletto',
      freeEdgeRatio: 0.72,
      finishType: 'solid_gloss_gel',
      trueBaseColorHex: '#4A2C22',
      secondaryColorHex: '#D9B668',
      borderType: 'none',
      strokes3D: [
        {
          p0: [0.2, 0.25],
          c1: [0.42, 0.42],
          c2: [0.58, 0.58],
          p1: [0.8, 0.76],
          widthNorm: 0.045,
          colorHex: '#D9B668',
          isMetallic: true,
          metalness: 0.95,
          reliefHeight: 0.7,
        },
      ],
      motifs: [],
      accessories3D: [
        {
          kind: 'metal_stud_sphere',
          u: 0.5,
          v: 0.3,
          radiusNorm: 0.09,
          heightRatio: 0.7,
          colorHex: '#D9B668',
          hasBezelRing: true,
        },
        {
          kind: 'metal_stud_sphere',
          u: 0.5,
          v: 0.48,
          radiusNorm: 0.09,
          heightRatio: 0.7,
          colorHex: '#D9B668',
          hasBezelRing: true,
        },
        {
          kind: 'pearl_dome',
          u: 0.5,
          v: 0.66,
          radiusNorm: 0.1,
          heightRatio: 0.68,
          colorHex: '#FAF6F0',
          hasBezelRing: true,
        },
      ],
    },
    'ring',
    'Right'
  );

  const fingerSpecs: Record<FingerId, NailFingerDesignSpec> = {
    thumb: buildFingerSpec('thumb', whiteFrenchBase('thumb')),
    index: buildFingerSpec('index', whiteFrenchBase('index')),
    middle: buildFingerSpec('middle', whiteFrenchBase('middle')),
    ring: buildFingerSpec('ring', ringAccentSpec),
    pinky: buildFingerSpec('pinky', whiteFrenchBase('pinky')),
  };

  const sheet = generateNailTechnicalSheet({
    designName: 'Espresso Gold Stiletto',
    studioName: 'Atelier Lumière Nails',
    fingerSpecs,
    predominantShape: 'stiletto',
    extensionLevel: 'Alongada',
  });

  // 1. All 5 fingers in canonical order
  assert.equal(sheet.fingers.length, 5);
  assert.deepEqual(
    sheet.fingers.map((f) => f.fingerId),
    ['thumb', 'index', 'middle', 'ring', 'pinky']
  );

  // 2. Predominant shape & extension
  assert.equal(sheet.predominantShapePt, 'Stiletto');
  assert.equal(sheet.predominantExtensionPt, 'Alongada');
  assert.equal(sheet.hasAccentFingers, true);

  // 3. Thumb white #F6F2EC + francesinha (not accent)
  const thumb = sheet.fingers[0];
  assert.equal(thumb.labelPt, 'Polegar');
  assert.equal(thumb.primaryColorHex, '#F6F2EC');
  assert.equal(thumb.shape, 'stiletto');
  assert.equal(thumb.isAccentFinger, false);
  assert.ok(
    thumb.artDetailsPt.some((d) => d.toLowerCase().includes('francesinha')),
    `Expected francesinha in thumb artDetailsPt, got: ${JSON.stringify(thumb.artDetailsPt)}`
  );

  // 4. Ring coffee brown #4A2C22 auto-detected as accent finger (filha única) with 3D gold stroke + 3D accessories
  const ring = sheet.fingers[3];
  assert.equal(ring.labelPt, 'Anelar');
  assert.equal(ring.primaryColorHex, '#4A2C22');
  assert.equal(ring.isAccentFinger, true);
  assert.ok(
    ring.artDetailsPt.some((d) => d.toLowerCase().includes('dourados') && d.includes('3D')),
    `Expected traços dourados em relevo 3D in ring artDetailsPt, got: ${JSON.stringify(ring.artDetailsPt)}`
  );
  assert.ok(
    ring.accessoriesPt.some((a) => a.includes('2x') && a.includes('Esfera Metálica Dourada')),
    `Expected 2x Esfera Metálica Dourada in ring accessoriesPt, got: ${JSON.stringify(ring.accessoriesPt)}`
  );
  assert.ok(
    ring.accessoriesPt.some((a) => a.includes('1x') && a.includes('Pérola 3D')),
    `Expected 1x Pérola 3D in ring accessoriesPt, got: ${JSON.stringify(ring.accessoriesPt)}`
  );

  // 5. Only ring is marked accent
  const accentIds = sheet.fingers.filter((f) => f.isAccentFinger).map((f) => f.fingerId);
  assert.deepEqual(accentIds, ['ring']);

  // 6. Formatted WhatsApp text includes header, shape, all 5 fingers, accent badge, 3D details & studio signature
  assert.ok(sheet.whatsappText.includes('*FICHA TÉCNICA DE UNHAS — Espresso Gold Stiletto*'));
  assert.ok(sheet.whatsappText.includes('Formato: *Stiletto*'));
  assert.ok(sheet.whatsappText.includes('*Polegar*'));
  assert.ok(sheet.whatsappText.includes('#F6F2EC'));
  assert.ok(sheet.whatsappText.includes('*Anelar* ★ *Filha Única / Destaque*'));
  assert.ok(sheet.whatsappText.includes('#4A2C22'));
  assert.ok(sheet.whatsappText.includes('2x Esfera Metálica Dourada'));
  assert.ok(sheet.whatsappText.includes('Atelier Lumière Nails'));
});

test('V14 Technical Sheet: formato coffin (Bailarina) preserva nomes por dedo e destaca múltiplas cores distintas', () => {
  const makeCoffin = (fingerId: FingerId, hex: string): NailFingerDesignSpec =>
    buildFingerSpec(
      fingerId,
      sanitizeManufacturingSpecClient(
        {
          fingerId,
          shape: 'coffin',
          freeEdgeRatio: 0.88,
          finishType: 'glazed_pearl',
          trueBaseColorHex: hex,
        },
        fingerId
      )
    );

  const sheet = generateNailTechnicalSheet({
    fingerSpecs: {
      thumb: makeCoffin('thumb', '#F6F2EC'),
      index: makeCoffin('index', '#E9D8CE'),
      middle: makeCoffin('middle', '#E9D8CE'),
      ring: makeCoffin('ring', '#4A2C22'),
      pinky: makeCoffin('pinky', '#E9D8CE'),
    },
    predominantShape: 'coffin',
  });

  assert.equal(sheet.fingers.length, 5);
  assert.equal(sheet.predominantShapePt, 'Bailarina');
  assert.equal(sheet.predominantExtensionPt, 'Muito Alongada');
  assert.equal(sheet.hasAccentFingers, true);
  assert.equal(sheet.fingers[3].isAccentFinger, true); // ring #4A2C22
  assert.equal(sheet.fingers[1].isAccentFinger, false); // index #E9D8CE
  assert.ok(sheet.whatsappText.includes('Formato: *Bailarina*'));
});

test('V14 Semantic Reconstruction: sanitizeManufacturingSpec defaults renderStrategy to procedural_pbr_3d (server & client)', () => {
  const rawMinimal = {
    fingerId: 'index',
    shape: 'coffin',
    freeEdgeRatio: 0.65,
    finishType: 'solid_gloss_gel',
    trueBaseColorHex: '#F6F2EC',
  };

  const serverSpec = sanitizeManufacturingSpec(rawMinimal, 'index', 'Right');
  const clientSpec = sanitizeManufacturingSpecClient(rawMinimal, 'index', 'Right');

  assert.equal(serverSpec.renderStrategy, 'procedural_pbr_3d');
  assert.equal(clientSpec.renderStrategy, 'procedural_pbr_3d');

  // Invalid renderStrategy also falls back strictly to procedural_pbr_3d
  const serverInvalid = sanitizeManufacturingSpec(
    { ...rawMinimal, renderStrategy: 'raw_pixel_crop_legacy' },
    'index'
  );
  const clientInvalid = sanitizeManufacturingSpecClient(
    { ...rawMinimal, renderStrategy: 'raw_pixel_crop_legacy' },
    'index'
  );

  assert.equal(serverInvalid.renderStrategy, 'procedural_pbr_3d');
  assert.equal(clientInvalid.renderStrategy, 'procedural_pbr_3d');
});

test('V14 Local Fallback: runDeepPerFingerReconstruction returns valid 5-finger technicalSheet and trueUvDataUrl === undefined', async () => {
  const mockFetchMissingKey = (async () =>
    new Response(JSON.stringify({ configured: false, mode: 'missing_key' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  const result = await runDeepPerFingerReconstruction('data:image/jpeg;base64,AAAA', {
    apiKey: '',
    fetchImpl: mockFetchMissingKey,
    pacingDelayMs: 0,
  });

  assert.equal(result.mode, 'local_fallback');
  assert.equal(result.missingApiKey, true);

  // Valid technicalSheet with 5 fingers
  assert.ok(result.technicalSheet, 'technicalSheet must be returned on local_fallback');
  assert.equal(result.technicalSheet.fingers.length, 5);
  assert.deepEqual(
    result.technicalSheet.fingers.map((f) => f.fingerId),
    ['thumb', 'index', 'middle', 'ring', 'pinky']
  );
  assert.ok(result.technicalSheet.whatsappText.includes('*FICHA TÉCNICA DE UNHAS*'));
  assert.ok(result.technicalSheet.summaryPt.length > 0);

  // Zero raw pixel crops (trueUvDataUrl === undefined) across all 5 fingers
  for (const fid of ['thumb', 'index', 'middle', 'ring', 'pinky'] as const) {
    const spec = result.fingerSpecs[fid];
    assert.ok(spec, `fingerSpec for ${fid} must exist`);
    assert.equal(
      spec.trueUvDataUrl,
      undefined,
      `${fid}: local parametric fallback must NOT stretch raw pixel crops (trueUvDataUrl must be undefined)`
    );
    assert.equal(spec.manufacturingSpec?.renderStrategy, 'procedural_pbr_3d');
  }
});
