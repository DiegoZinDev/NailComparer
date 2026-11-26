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
      model: 'gemini-3.5-flash-lite',
    });
    assert.ok(!JSON.stringify(payload).includes('secret-test-server-key-never-expose'));

    const postStatus = await executeReconstructNail({ action: 'status' }, {});
    assert.deepEqual(postStatus, {
      ok: true,
      configured: true,
      source: 'server_env',
      model: 'gemini-3.5-flash-lite',
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
      model: 'gemini-3.5-flash-lite',
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

test('V13.2 Gemini 3.x Cascade: HTTP 404 on 1st model automatically falls back to 2nd model and omits temperature for Gemini 3.x', async () => {
  const requestedUrls: string[] = [];
  const sentGenerationConfigs: Array<Record<string, unknown>> = [];

  const mockFetchCascade = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestedUrls.push(url);
    if (typeof init?.body === 'string') {
      const parsedBody = JSON.parse(init.body) as {
        generationConfig?: Record<string, unknown>;
      };
      sentGenerationConfigs.push(parsedBody.generationConfig ?? {});
    }

    if (requestedUrls.length === 1) {
      return new Response(
        JSON.stringify({
          error: {
            code: 404,
            message: 'models/gemini-3.5-flash-lite is no longer available to new users.',
            status: 'NOT_FOUND',
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const validGlobalJson = {
      lightingEnvironment: {
        roomTemperature: 'neutral',
        specularReflectionsPresent: true,
        discountedReflectionNotesPt: 'Reflexo suave de estúdio.',
      },
      visibleHandsCount: 1,
      visibleFingersCount: 5,
      handCountScope: 5,
      hasAccentFingers: false,
      hasLeftRightDifferences: false,
      identicalFingerGroups: [['thumb', 'index', 'middle', 'ring', 'pinky']],
      accentFingers: [],
      fingerSummaries: [],
      predominantShape: 'almond',
      averageFreeEdgeRatio: 0.48,
      predominantFinish: 'mirror_chrome',
      predominantRenderStrategy: 'procedural_pbr_3d',
      realHexPalette: ['#D4B483'],
      physicalAccessoriesPresent: [],
      overallNotesPt: 'Unhas amendoadas champagne cromadas.',
    };

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(validGlobalJson) }],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const prevModel = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL;

  try {
    const res = await executeReconstructNail(
      {
        action: 'analyze_global',
        fullImageBase64: 'A'.repeat(64),
        mimeType: 'image/jpeg',
      },
      {},
      {
        envApiKey: 'test-key-v13-2',
        fetchImpl: mockFetchCascade,
        sleepImpl: async () => {},
      }
    );

    assert.equal(res.configured, true);
    assert.ok('action' in res && res.action === 'analyze_global');
    assert.equal(res.modelUsed, 'gemini-3.1-flash-lite');
    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls[0].includes('/gemini-3.5-flash-lite:generateContent'));
    assert.ok(requestedUrls[1].includes('/gemini-3.1-flash-lite:generateContent'));
    assert.deepEqual(sentGenerationConfigs[0], { responseMimeType: 'application/json' });
    assert.deepEqual(sentGenerationConfigs[1], { responseMimeType: 'application/json' });
  } finally {
    if (prevModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = prevModel;
    }
  }
});


