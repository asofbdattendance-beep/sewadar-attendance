/**
 * enginePool.offline.test.js — engine-selection doctrine (cross-device).
 *
 * These tests use the REAL @zxing/library (statically imported by the pool —
 * no network, no lazy chunk) and prove the two gates that keep the scanner
 * alive on the long tail of phones:
 *
 *  1. PROBE GATE: `'BarcodeDetector' in window` is not enough. A hanging
 *     getSupportedFormats() (or an empty usable set) must not wedge init —
 *     the pool lands on ZXing instead.
 *  2. CANVAS REUSE: the hard path's inverted-native canvas is one reused
 *     scratch canvas, not an allocation per call (GC stalls on low-end
 *     phones).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEnginePool, _resetInvertScratchForTests } from './enginePool'

const SURFACE = {
  canvas: {},
  read: () => ({ data: new Uint8ClampedArray(64), width: 8, height: 2 }),
}

beforeEach(() => {
  _resetInvertScratchForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('probe-gated native selection', () => {
  it('falls back to ZXing when the native probe hangs', async () => {
    vi.stubGlobal('window', {
      BarcodeDetector: class {
        static getSupportedFormats = () => new Promise(() => {})
        detect = () => Promise.resolve([])
      },
    })
    const pool = createEnginePool(false)
    await pool.init()
    expect(pool.isReady()).toBe(true)
    expect(pool.getActiveId()).toBe('ZXing')
  })

  it('falls back to ZXing when native supports none of our formats', async () => {
    vi.stubGlobal('window', {
      BarcodeDetector: class {
        static getSupportedFormats = () => Promise.resolve(['qr_code'])
        detect = () => Promise.resolve([])
      },
    })
    // Tier list narrowed to 1D only: qr_code-only native is useless to us.
    const pool = createEnginePool(false, { formats: ['code_39', 'code_128'] })
    await pool.init()
    expect(pool.isReady()).toBe(true)
    expect(pool.getActiveId()).toBe('ZXing')
  })

  it('picks native when the probe answers with usable formats', async () => {
    vi.stubGlobal('window', {
      BarcodeDetector: class {
        static getSupportedFormats = () => Promise.resolve(['code_39', 'code_128'])
        detect = () => Promise.resolve([])
      },
    })
    const pool = createEnginePool(false)
    await pool.init()
    expect(pool.getActiveId()).toBe('Native')
  })

  it('falls back to ZXing when the probe throws synchronously', async () => {
    vi.stubGlobal('window', {
      BarcodeDetector: class {
        // A platform getter that raises instead of returning a promise —
        // seen on WebView builds where the detector object exists but the
        // backing service is gone. Must be "no native", never a wedged init.
        static getSupportedFormats = () => { throw new Error('service gone') }
        detect = () => Promise.resolve([])
      },
    })
    const pool = createEnginePool(false)
    await pool.init()
    expect(pool.isReady()).toBe(true)
    expect(pool.getActiveId()).toBe('ZXing')
  })

  it('falls back to ZXing when the probe answers with garbage', async () => {
    vi.stubGlobal('window', {
      BarcodeDetector: class {
        static getSupportedFormats = () => Promise.resolve(undefined)
        detect = () => Promise.resolve([])
      },
    })
    const pool = createEnginePool(false)
    await pool.init()
    expect(pool.isReady()).toBe(true)
    expect(pool.getActiveId()).toBe('ZXing')
  })
})

describe('inverted-native scratch canvas reuse', () => {
  function stubDocument() {
    const canvases = []
    vi.stubGlobal('document', {
      createElement: (tag) => {
        if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`)
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ putImageData: vi.fn() }),
        }
        canvases.push(canvas)
        return canvas
      },
    })
    return canvases
  }

  it('allocates ONE canvas across repeated hardPass runs', async () => {
    vi.stubGlobal('window', {
      BarcodeDetector: class {
        static getSupportedFormats = () => Promise.resolve(['code_39'])
        detect = () => Promise.resolve([])
      },
    })
    const canvases = stubDocument()
    const pool = createEnginePool(false)
    await pool.init()
    expect(pool.getActiveId()).toBe('Native')

    await pool.hardPass(SURFACE)
    await pool.hardPass(SURFACE)
    expect(canvases.length).toBe(1)
  })
})
