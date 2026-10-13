/**
 * cameraManager.exactDevice.test.js — pinned rear-camera re-open.
 *
 * openCamera({ exactDeviceId }) must pass the id through as an exact device
 * constraint (post-grant rear recovery in BarcodeScanner). A device that
 * will not honour it falls back to facingMode rather than failing the
 * session — same contract as the rear-label path.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openCamera, openPinnedCamera, stopStream, getActiveStream } from './cameraManager'

function liveTrack(deviceId = 'front-1') {
  return {
    kind: 'video',
    readyState: 'live',
    stop: vi.fn(function () { this.readyState = 'ended' }),
    getSettings: () => ({ deviceId, facingMode: 'user', width: 640, height: 480 }),
    getCapabilities: () => ({}),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  }
}

function streamWith(track) {
  return { getTracks: () => [track], getVideoTracks: () => [track] }
}

beforeEach(() => {
  const track = liveTrack()
  const stream = streamWith(track)
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  })
})

afterEach(() => {
  const active = getActiveStream()
  if (active) stopStream(active)
})

describe('openCamera exactDeviceId', () => {
  it('passes the pinned id as an exact device constraint', async () => {
    const opened = await openCamera({ exactDeviceId: 'rear-9' })
    const gum = window.navigator.mediaDevices.getUserMedia
    expect(gum).toHaveBeenCalledTimes(1)
    expect(gum.mock.calls[0][0].video.deviceId).toEqual({ exact: 'rear-9' })
    expect(opened.deviceId).toBe('rear-9')
  })

  it('falls back to facingMode when the pinned id is overconstrained', async () => {
    const over = new Error('overconstrained')
    over.name = 'OverconstrainedError'
    const track = liveTrack('rear-9')
    window.navigator.mediaDevices.getUserMedia
      .mockRejectedValueOnce(over)
      .mockResolvedValueOnce(streamWith(track))
    const opened = await openCamera({ exactDeviceId: 'rear-9' })
    expect(opened.stream).toBeTruthy()
  })
})

/**
 * openPinnedCamera — the rear-recovery opener.
 *
 * Regression: the recovery path calls an opener while it already holds a live
 * stream. The public openCamera() adopts live `_active` and hands it straight
 * back — recovery then "swapped" onto the stream it already had and stopped
 * it, blacking a working preview exactly when a rear camera existed. The
 * pinned opener must bypass adoption: a fresh getUserMedia call, the old
 * stream untouched, `_active` moved to the new stream.
 */
describe('openPinnedCamera bypasses _active adoption', () => {
  it('opens a fresh stream while one is live — old tracks never stopped', async () => {
    const firstTrack = liveTrack('front-1')
    const firstStream = streamWith(firstTrack)
    const gum = window.navigator.mediaDevices.getUserMedia
    gum.mockResolvedValueOnce(firstStream)
    const first = await openCamera()
    expect(getActiveStream()).toBe(first.stream)

    const rearTrack = liveTrack('rear-9')
    const rearStream = streamWith(rearTrack)
    gum.mockResolvedValueOnce(rearStream)
    const repinned = await openPinnedCamera('rear-9')

    expect(gum).toHaveBeenCalledTimes(2)
    expect(repinned.stream).toBe(rearStream)
    expect(repinned.adopted).toBe(false)
    // The working stream survives: no stop on its tracks, _active moves over.
    expect(firstTrack.stop).not.toHaveBeenCalled()
    expect(getActiveStream()).toBe(rearStream)
  })
})
