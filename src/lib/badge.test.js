/**
 * badge.test.js — attendance badge domain (FB…GA/LA + BH…, no VS…).
 *
 * Guards the reconciliation decision: a verbatim portal port would accept
 * VS-prefixed reads and reject BH badges. Here BH must scan and VS must not.
 * Also pins the anti-retype guarantee — a repair may never turn one sewadar's
 * badge into a different sewadar's badge.
 */
import { describe, it, expect } from 'vitest'
import {
  BADGE_REGEX,
  isVssBadge,
  isValidBadgeFormat,
  isFaridabadBadge,
  sanitizeScannedBadge,
} from './badge'

describe('BADGE_REGEX', () => {
  it.each([
    'FB5971GA2927',
    'FB5979GA0001',
    'FB5989LA1234',
    'FB6000GA0001',
    'FB6011LA9999',
  ])('accepts Faridabad badge %s', (b) => {
    expect(BADGE_REGEX.test(b)).toBe(true)
  })

  it.each(['BH1234XY5678', 'BH1234X5678'])('accepts BH badge %s', (b) => {
    expect(BADGE_REGEX.test(b)).toBe(true)
  })

  it.each([
    'VSFB5971GA2927', // VSS-shaped: no VSS sewadars in this repo
    'RANDOM',
    'FB5971GA292', // short
    'FB5971GA29277', // long
    'FB5970GA0001', // 5970 below range
    'FB6012GA0001', // 6012 above range
    'FB5971XX0001', // bad middle
  ])('rejects %s', (b) => {
    expect(BADGE_REGEX.test(b)).toBe(false)
  })
})

describe('isVssBadge / isValidBadgeFormat / isFaridabadBadge', () => {
  it('flags VS-prefixed reads', () => {
    expect(isVssBadge('VSFB5971GA2927')).toBe(true)
    expect(isVssBadge('vs123')).toBe(true)
    expect(isVssBadge('FB5971GA2927')).toBe(false)
    expect(isVssBadge(null)).toBe(false)
  })

  it('trims before validating', () => {
    expect(isValidBadgeFormat('  FB5971GA2927  ')).toBe(true)
    expect(isValidBadgeFormat('nope')).toBe(false)
    expect(isValidBadgeFormat(null)).toBe(false)
  })

  it('isFaridabadBadge mirrors the format check', () => {
    expect(isFaridabadBadge('FB5971GA2927')).toBe(true)
    expect(isFaridabadBadge('BH1234XY5678')).toBe(true)
    expect(isFaridabadBadge('VSFB5971GA2927')).toBe(false)
  })
})

describe('sanitizeScannedBadge', () => {
  it('passes a clean badge through untouched', () => {
    expect(sanitizeScannedBadge('FB5971GA2927')).toBe('FB5971GA2927')
    expect(sanitizeScannedBadge('BH1234XY5678')).toBe('BH1234XY5678')
  })

  it('fixes mechanical noise: guards, spaces, lower case', () => {
    expect(sanitizeScannedBadge('*FB5971GA2927*')).toBe('FB5971GA2927')
    expect(sanitizeScannedBadge(' fb 5971 ga2927 ')).toBe('FB5971GA2927')
  })

  it('repairs O→0 confusion in a digit position', () => {
    expect(sanitizeScannedBadge('FB5971GA292O')).toBe('FB5971GA2920')
  })

  it('never strips VS: a VS-prefixed read stays rejected', () => {
    const out = sanitizeScannedBadge('VSFB5971GA2927')
    expect(BADGE_REGEX.test(out)).toBe(false)
  })

  it('never retypes: an unrepairable read comes back unchanged, still invalid', () => {
    expect(sanitizeScannedBadge('RANDOM')).toBe('RANDOM')
    expect(BADGE_REGEX.test(sanitizeScannedBadge('RANDOM'))).toBe(false)
  })

  it('returns empty for empty / non-string input', () => {
    expect(sanitizeScannedBadge('')).toBe('')
    expect(sanitizeScannedBadge(null)).toBe('')
    expect(sanitizeScannedBadge(undefined)).toBe('')
    expect(sanitizeScannedBadge(123)).toBe('')
  })

  it('is idempotent', () => {
    const once = sanitizeScannedBadge('*fb5971ga292o*')
    expect(sanitizeScannedBadge(once)).toBe(once)
  })

  it('fuzz: 500 hostile inputs never throw, never retype, valid outputs are fixed points', () => {
    // Deterministic PRNG (mulberry32) — same 500 inputs on every run.
    let seed = 0xC0FFEE
    const rand = () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const alphabet = 'FBGLA59710OIlS5B8Z2* xyz\t\n-_.#'
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rand() * 24)
      let raw = ''
      for (let j = 0; j < len; j++) raw += alphabet[Math.floor(rand() * alphabet.length)]
      let out
      expect(() => { out = sanitizeScannedBadge(raw) }).not.toThrow()
      expect(typeof out).toBe('string')
      // Fixed point: feeding the output back changes nothing (a repair that
      // keeps "repairing" could walk one badge into another's — retyping).
      expect(sanitizeScannedBadge(out)).toBe(out)
      // No hallucinations: output is either regex-valid or honestly invalid.
      if (out !== '' && !BADGE_REGEX.test(out)) {
        expect(isValidBadgeFormat(out)).toBe(false)
      }
    }
  })
})
