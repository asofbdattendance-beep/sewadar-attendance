/**
 * scannerUtils.test.js — engine-subset helpers for the attendance repo.
 *
 * Only the functions this repo's engine path consumes are pinned here
 * (withTimeout, context guard, gray conversion, ROI, edge/box geometry,
 * video-ready wait, rotations, mechanical sanitiser). Portal-only helpers
 * (RPC timeouts, IST dates, sharpness scoring, tile ROIs) are not ported.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  CAMERA_INIT_TIMEOUT,
  withTimeout,
  isSecureCameraContext,
  rgbaToGray,
  computeRoi,
  isEdgeDetection,
  detectionBox,
  waitForVideoReady,
  SCAN_ROTATIONS,
  rotateGray,
  sanitizeBarcode,
} from './scannerUtils'

describe('withTimeout', () => {
  it('resolves with the wrapped value', async () => {
    await expect(withTimeout(Promise.resolve(42), 100, 'T')).resolves.toBe(42)
  })

  it('rejects with a labelled timeout error', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'Cam'))
      .rejects.toThrow('Cam timed out after 20ms')
  })

  it('assimilates thenables without .catch (supabase rpc builders)', async () => {
    const thenable = { then: (res) => res('ok') }
    await expect(withTimeout(thenable, 100, 'T')).resolves.toBe('ok')
  })

  it('propagates the wrapped rejection, not a timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 100, 'T'))
      .rejects.toThrow('boom')
  })

  it('CAMERA_INIT_TIMEOUT is a sane bound', () => {
    expect(CAMERA_INIT_TIMEOUT).toBeGreaterThanOrEqual(5000)
    expect(CAMERA_INIT_TIMEOUT).toBeLessThanOrEqual(30000)
  })
})

describe('isSecureCameraContext', () => {
  it('is false with no window (node / SSR)', () => {
    expect(isSecureCameraContext()).toBe(false)
  })

  it('is true when getUserMedia exists in a secure context', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => {} } })
    vi.stubGlobal('window', { isSecureContext: true })
    try {
      expect(isSecureCameraContext()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('is false in an explicitly insecure context', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => {} } })
    vi.stubGlobal('window', { isSecureContext: false })
    try {
      expect(isSecureCameraContext()).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('rgbaToGray', () => {
  const frame = (r, g, b) => ({
    data: new Uint8ClampedArray([r, g, b, 255]),
    width: 1,
    height: 1,
  })

  it('uses luma weights, not a flat channel average', () => {
    // Pure green (0.587 weight) must read brighter than pure blue (0.114).
    expect(rgbaToGray(frame(0, 255, 0))[0]).toBeGreaterThan(rgbaToGray(frame(0, 0, 255))[0])
    // Pure red luminates to ~76, not 85 (flat average).
    expect(rgbaToGray(frame(255, 0, 0))[0]).toBe(76)
  })

  it('reuses one scratch buffer across same-size frames', () => {
    const a = rgbaToGray(frame(10, 20, 30))
    const b = rgbaToGray(frame(40, 50, 60))
    expect(a.buffer).toBe(b.buffer)
    expect(b[0]).toBe(Math.round((40 * 299 + 50 * 587 + 60 * 114) / 1000))
  })

  it('returns empty for degenerate input', () => {
    expect(rgbaToGray(null).length).toBe(0)
    expect(rgbaToGray({ data: null, width: 1, height: 1 }).length).toBe(0)
  })
})

describe('computeRoi', () => {
  it('uses a centred band by default (0.92 × 0.62)', () => {
    const r = computeRoi(1000, 500)
    expect(r.sw).toBe(920)
    expect(r.sh).toBe(310)
    expect(r.sx).toBe(40)
    expect(r.sy).toBe(95)
  })

  it('uses the whole frame in full mode', () => {
    const r = computeRoi(1000, 500, { mode: 'full' })
    expect(r.sw).toBe(1000)
    expect(r.sh).toBe(500)
    expect(r.sx).toBe(0)
    expect(r.sy).toBe(0)
  })

  it('never upscales: caps the decode surface at maxWidth', () => {
    const r = computeRoi(1920, 1080)
    expect(r.dw).toBeLessThanOrEqual(720)
    expect(r.scale).toBeLessThan(1)
  })

  it('returns a zero roi for missing dimensions', () => {
    expect(computeRoi(0, 0)).toMatchObject({ sw: 0, sh: 0, scale: 1 })
  })
})

describe('isEdgeDetection', () => {
  const roi = { sx: 0, sy: 0, sw: 100, sh: 100, dw: 100, dh: 100 }

  it('flags a centroid hugging the frame edge', () => {
    expect(isEdgeDetection([{ x: 1, y: 50 }, { x: 2, y: 50 }], roi, 100, 100)).toBe(true)
  })

  it('accepts a centred detection', () => {
    expect(isEdgeDetection([{ x: 40, y: 50 }, { x: 60, y: 50 }], roi, 100, 100)).toBe(false)
  })

  it('never blocks on degenerate data (< 2 points)', () => {
    expect(isEdgeDetection([{ x: 1, y: 1 }], roi, 100, 100)).toBe(false)
    expect(isEdgeDetection([], roi, 100, 100)).toBe(false)
  })
})

describe('detectionBox', () => {
  const roi = { sx: 0, sy: 0, sw: 100, sh: 100, dw: 100, dh: 100 }

  it('maps detect-canvas points into the container box', () => {
    const box = detectionBox(
      [{ x: 20, y: 40 }, { x: 80, y: 60 }],
      roi, 100, 100, { width: 200, height: 200 },
    )
    expect(box).not.toBeNull()
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.left + box.width).toBeLessThanOrEqual(200)
    expect(box.top + box.height).toBeLessThanOrEqual(200)
  })

  it('returns null for degenerate input', () => {
    expect(detectionBox([{ x: 1, y: 1 }], roi, 100, 100, { width: 200, height: 200 })).toBeNull()
    expect(detectionBox([{ x: 1, y: 1 }, { x: 2, y: 2 }], roi, 0, 0, { width: 200, height: 200 })).toBeNull()
  })
})

describe('waitForVideoReady', () => {
  it('resolves (never rejects) on timeout, flagged timedOut', async () => {
    const video = {
      readyState: 0, videoWidth: 0, videoHeight: 0,
      addEventListener: () => {}, removeEventListener: () => {},
    }
    await expect(waitForVideoReady(video, 20)).resolves.toMatchObject({ timedOut: true })
  })

  it('resolves immediately for a missing element', async () => {
    await expect(waitForVideoReady(null, 20)).resolves.toMatchObject({ timedOut: true })
  })

  it('resolves with dimensions when frames are ready', async () => {
    const video = {
      readyState: 4, videoWidth: 1280, videoHeight: 720,
      addEventListener: () => {}, removeEventListener: () => {},
    }
    await expect(waitForVideoReady(video, 50)).resolves.toMatchObject({ width: 1280, height: 720 })
  })
})

describe('rotateGray', () => {
  it('exposes the three hard-path angles', () => {
    expect(SCAN_ROTATIONS).toEqual([90, 180, 270])
  })

  it('rotates 90° with swapped dimensions', () => {
    // 2×2 [1 2 / 3 4]: (x,y)→(h-1-y, x) gives row0 [3,1], row1 [4,2].
    const { gray, width, height } = rotateGray(new Uint8ClampedArray([1, 2, 3, 4]), 2, 2, 90)
    expect(width).toBe(2)
    expect(height).toBe(2)
    expect([...gray]).toEqual([3, 1, 4, 2])
    // Non-square: 2 wide × 1 tall becomes 1 wide × 2 tall.
    const tall = rotateGray(new Uint8ClampedArray([10, 20]), 2, 1, 90)
    expect([tall.width, tall.height]).toEqual([1, 2])
    expect([...tall.gray]).toEqual([10, 20])
  })

  it('rotates 180° in place', () => {
    const { gray, width, height } = rotateGray(new Uint8ClampedArray([1, 2, 3, 4]), 2, 2, 180)
    expect([width, height]).toEqual([2, 2])
    expect([...gray]).toEqual([4, 3, 2, 1])
  })

  it('is a no-op for unsupported angles', () => {
    const g = new Uint8ClampedArray([1, 2])
    expect(rotateGray(g, 2, 1, 45)).toMatchObject({ width: 2, height: 1 })
  })
})

describe('sanitizeBarcode', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(sanitizeBarcode('*fb 5971-ga2927*')).toBe('FB5971GA2927')
  })

  it('preserves leading zeros and digit identity', () => {
    expect(sanitizeBarcode('FB6000LA0001')).toBe('FB6000LA0001')
  })

  it('returns empty for nullish input', () => {
    expect(sanitizeBarcode(null)).toBe('')
    expect(sanitizeBarcode(undefined)).toBe('')
  })
})
