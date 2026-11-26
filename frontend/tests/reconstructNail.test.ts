import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {
  executeReconstructNail,
  sanitizeManufacturingSpec,
  type VercelReq,
  type VercelRes,
} from '../api/reconstruct-nail.ts';
import {
  checkServerAiStatus,
  runDeepPerFingerReconstruction,
  sanitizeManufacturingSpecClient,
} from '../src/lib/deepNailReconstructor.ts';

test('V13 Dual-Path API & Sanitizer: preserves renderStrategy, rejects spurious strokes3D on mirror_chrome, preserves real 3D accessories', () => {
  const rawChromeWithStuds = {
    fingerId: 'ring',
    handSide: 'Right',
    renderStrategy: 'procedural_pbr_3d',
    nailBoundingBox: [0.12, 0.08, 0.88, 0.94],
    shape: 'almond',
    freeEdgeRatio: 0.56,
    tipRoundness: 0.62,
    cCurveDepth: 0.28, // out of V13 thin bounds -> clamped to <= 0.18
    apexHeight: 0.11, // out of V13 thin bounds -> clamped to <= 0.075
    finishType: 'mirror_chrome',
    trueBaseColorHex: '#D4B483',
    metalness: 0.70, // clamped to >= 0.92 for mirror_chrome
    roughness: 0.25, // clamped to <= 0.09 for mirror_chrome
    strokes3D: [
      // Spurious dark room reflection stripe — MUST be stripped!
      {
        p0: [0.2, 0.2],
        c1: [0.4, 0.4],
        c2: [0.6, 0.6],
        p1: [0.8, 0.8],
        widthNorm: 0.05,
        colorHex: '#181617',
        isMetallic: false,
        metalness: 0.0,
        reliefHeight: 0.2,
      },
    ],
    accessories3D: [
      {
        kind: 'metal_stud_sphere',
        u: 0.5,
        v: 0.28,
        radiusNorm: 0.11,
        heightRatio: 0.72,
        colorHex: '#E6E9EF',
        hasBezelRing: true,
      },
      {
        kind: 'metal_stud_sphere',
        u: 0.5,
        v: 0.54,
        radiusNorm: 0.11,
        heightRatio: 0.72,
        colorHex: '#E6E9EF',
        hasBezelRing: true,
      },
    ],
    designNotesPt: 'Amendoada ouro champagne espelhado com 2 studs prateados.',
  };

  for (const [label, spec] of [
    ['server', sanitizeManufacturingSpec(rawChromeWithStuds, 'ring', 'Right')],
    ['client', sanitizeManufacturingSpecClient(rawChromeWithStuds, 'ring', 'Right')],
  ] as const) {
    assert.equal(spec.renderStrategy, 'procedural_pbr_3d', `${label}: renderStrategy preserved`);
    assert.ok(spec.cCurveDepth >= 0.11 && spec.cCurveDepth <= 0.18, `${label}: cCurveDepth within V13 thin bounds`);
    assert.ok(spec.apexHeight >= 0.042 && spec.apexHeight <= 0.075, `${label}: apexHeight within V13 thin bounds`);
    assert.ok(spec.metalness >= 0.92, `${label}: mirror_chrome metalness >= 0.92`);
    assert.ok(spec.roughness <= 0.09, `${label}: mirror_chrome roughness <= 0.09`);
    assert.equal(spec.strokes3D.length, 0, `${label}: spurious dark reflection stroke must be rejected`);
    assert.equal(spec.accessories3D.length, 2, `${label}: all real 3D metal studs preserved`);
    assert.equal(spec.accessories3D[0].kind, 'metal_stud_sphere');
  }

  // Pictorial art nail routes cleanly to canonical_uv_delighted
  const pictorial = sanitizeManufacturingSpec(
    {
      fingerId: 'middle',
      renderStrategy: 'canonical_uv_delighted',
      shape: 'almond',
      finishType: 'solid_gloss_gel',
      trueBaseColorHex: '#EDE6DF',
      accessories3D: [
        { kind: 'pearl_dome', u: 0.5, v: 0.5, radiusNorm: 0.08, heightRatio: 0.65, colorHex: '#FAF6F0', hasBezelRing: true },
      ],
    },
    'middle'
  );
  assert.equal(pictorial.renderStrategy, 'canonical_uv_delighted');
  assert.equal(pictorial.accessories3D.length, 1);
});

test('V13.1 Health Check: GET /api/reconstruct-nail and POST action=status return server_env configured status without leaking key', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'secret-test-server-key-never-expose';

  try {
    let statusCode = 0;
    let payload: unknown = null;
    const responseHeaders: Record<string, string> = {};

    const req: VercelReq = {
      method: 'GET',
      headers: {},
    };
    const res: VercelRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: unknown) {
        payload = data;
        return this;
      },
      setHeader(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
      },
      end() {
        // noop
      },
    };

    await handler(req, res);

    assert.equal(statusCode, 200);
    assert.match(responseHeaders['access-control-allow-methods'] ?? '', /\bGET\b/);
    assert.deepEqual(payload, {
      ok: true,
      configured: true,
      source: 'server_env',
      model: 'gemini-2.5-flash',
    });
    assert.ok(!JSON.stringify(payload).includes('secret-test-server-key-never-expose'));

    const postStatus = await executeReconstructNail({ action: 'status' }, {});
    assert.deepEqual(postStatus, {
      ok: true,
      configured: true,
      source: 'server_env',
      model: 'gemini-2.5-flash',
    });

    const clientStatus = await checkServerAiStatus(
      (async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
      { apiKey: '' }
    );
    assert.deepEqual(clientStatus, {
      reachable: true,
      configured: true,
      source: 'server_env',
      status: 200,
      model: 'gemini-2.5-flash',
    });
  } finally {
    if (prevKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = prevKey;
    }
  }
});

test('V13.1 Error Transparency: HTTP 500 from /api/reconstruct-nail yields local_fallback with missingApiKey=false and real fallbackReason', async () => {
  const mockFetch500 = (async () =>
    new Response(JSON.stringify({ error: 'Erro interno simulado na Vercel' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  const result = await runDeepPerFingerReconstruction('data:image/jpeg;base64,AAAA', {
    apiKey: '',
    fetchImpl: mockFetch500,
    pacingDelayMs: 0,
  });

  assert.equal(result.mode, 'local_fallback');
  assert.equal(result.missingApiKey, false);
  assert.equal(result.httpStatus, 500);
  assert.ok(
    typeof result.fallbackReason === 'string' &&
      result.fallbackReason.includes('HTTP 500') &&
      result.fallbackReason.includes('/api/reconstruct-nail'),
    `Expected descriptive HTTP 500 fallbackReason, got: ${String(result.fallbackReason)}`
  );
});

