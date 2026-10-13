/**
 * deviceCapabilities.test.js — the three format lists the engine pool consumes.
 *
 * Pins the tiering contract: every tier reads the real badge symbologies,
 * the widened 1D set stays disjoint from base, and 2D lives ONLY on the hard
 * path (a 2D symbol in the base list would tax every normal frame).
 */
import { describe, it, expect } from 'vitest'
import {
  BASE_1D_FORMATS,
  EXTENDED_1D_FORMATS,
  HARD_PATH_2D_FORMATS,
} from './deviceCapabilities'

describe('format lists', () => {
  it('base covers the real badge symbologies', () => {
    expect(BASE_1D_FORMATS).toContain('code_39')
    expect(BASE_1D_FORMATS).toContain('code_128')
  })

  it('extended widens 1D without repeating base', () => {
    expect(EXTENDED_1D_FORMATS).toContain('itf')
    const overlap = EXTENDED_1D_FORMATS.filter((f) => BASE_1D_FORMATS.includes(f))
    expect(overlap).toEqual([])
  })

  it('2D symbologies live ONLY on the hard path', () => {
    expect(HARD_PATH_2D_FORMATS).toEqual(
      expect.arrayContaining(['data_matrix', 'pdf417', 'qr_code']),
    )
    const inBase = HARD_PATH_2D_FORMATS.filter((f) => BASE_1D_FORMATS.includes(f))
    const inExt = HARD_PATH_2D_FORMATS.filter((f) => EXTENDED_1D_FORMATS.includes(f))
    expect(inBase).toEqual([])
    expect(inExt).toEqual([])
  })
})
