/**
 * BarcodeScanner — Single-engine, cross-platform
 *
 * Uses BarcodeDetector API everywhere.
 * On Android/Chrome: native hardware-accelerated (built-in, ~2-8ms/frame)
 * On iOS/Safari + others: @undecaf/barcode-detector-polyfill (ZBar WASM, ~15-30ms/frame)
 *
 * Same code path for all devices — polyfill just fills the gap where native isn't available.
 * iOS Safari does have BarcodeDetector but only supports QR/2D formats, NOT Code39/128.
 * The polyfill replaces it entirely and supports all linear barcode formats.
 */

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { CameraOff, RefreshCw, Zap, Flashlight } from 'lucide-react'

// Matches: FB or BH + 4 digits + 1-2 uppercase letters + 4+ digits
// e.g. FB5991GA0070, FB5991LA0028, BH1234GA0001
const BADGE_REGEX = /^(BH|FB)[0-9]{4}[A-Z]{1,2}[0-9]{4}$/

function clean(raw) {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

async function hasLinearBarcodeSupport() {
  if (!('BarcodeDetector' in window)) return false
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats()
    return formats.includes('code_39') || formats.includes('code_128')
  } catch {
    return false
  }
}

async function loadPolyfill() {
  const { BarcodeDetectorPolyfill } = await import(/* @vite-ignore */ '@undecaf/barcode-detector-polyfill')
  window.BarcodeDetector = BarcodeDetectorPolyfill
}

const BarcodeScanner = forwardRef(function BarcodeScanner({ onScan }, ref) {
  const videoRef        = useRef(null)
  const streamRef      = useRef(null)
  const rafRef         = useRef(null)
  const detectorRef    = useRef(null)
  const mountedRef      = useRef(true)
  const lastScanRef    = useRef({ badge: null, time: 0 })
  const isDetectingRef = useRef(false)
  const scanTimerRef   = useRef(null)
  const fpsRef         = useRef({ frames: 0, last: Date.now() })
  const onScanRef      = useRef(onScan)
  const lastDetectRef  = useRef(0)
  const torchRef      = useRef(false)

  const [status, setStatus]       = useState('starting')
  const [errorMsg, setErrorMsg]   = useState('')
  const [lastScanned, setLastScanned] = useState('')
  const [engineLabel, setEngineLabel] = useState('')
  const [fps, setFps]             = useState(0)
  const [torchOn, setTorchOn]     = useState(false)

  const stopScanner = () => {
    if (rafRef.current)         { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (scanTimerRef.current)   { clearTimeout(scanTimerRef.current); scanTimerRef.current = null }
    if (streamRef.current)      { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (videoRef.current)        videoRef.current.srcObject = null
    isDetectingRef.current = false
  }

  const applyTorch = (on) => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      const capabilities = track.getCapabilities()
      if (!capabilities.torch) return
      track.applyConstraints({ advanced: [{ torch: on }] })
      torchRef.current = on
      setTorchOn(on)
    } catch (_) { /* device doesn't support torch */ }
  }

  const toggleTorch = () => applyTorch(!torchRef.current)

  const startScanner = async () => {
    if (!mountedRef.current) return
    stopScanner()
    setStatus('loading')
    setErrorMsg('')
    setLastScanned('')
    lastScanRef.current  = { badge: null, time: 0 }
    fpsRef.current       = { frames: 0, last: Date.now() }
    lastDetectRef.current = 0
    torchRef.current = false
    setTorchOn(false)

    const hasNative = await hasLinearBarcodeSupport()
    if (!hasNative) {
      try {
        await loadPolyfill()
        setEngineLabel('WASM')
      } catch {
        if (mountedRef.current) {
          setStatus('error')
          setErrorMsg('Could not load barcode engine. Check internet connection and retry.')
        }
        return
      }
    } else {
      setEngineLabel('Native')
    }

    try {
      detectorRef.current = new window.BarcodeDetector({
        formats: ['code_39', 'code_128', 'codabar']
      })
    } catch {
      if (mountedRef.current) { setStatus('error'); setErrorMsg('Failed to start barcode detector') }
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
        audio: false
      })
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
    } catch (err) {
      if (!mountedRef.current) return
      setStatus('error')
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access and retry.'
          : 'Camera not available on this device.'
      )
      return
    }

    if (!mountedRef.current) return
    setStatus('ready')

    const detect = async () => {
      if (!mountedRef.current) return

      fpsRef.current.frames++
      const now = Date.now()
      if (now - fpsRef.current.last >= 1000) {
        setFps(fpsRef.current.frames)
        fpsRef.current = { frames: 0, last: now }
      }

      if (isDetectingRef.current || videoRef.current?.readyState !== 4) {
        rafRef.current = requestAnimationFrame(detect)
        return
      }

      if (now - lastDetectRef.current < 80) {
        rafRef.current = requestAnimationFrame(detect)
        return
      }
      lastDetectRef.current = now

      isDetectingRef.current = true
      try {
        const barcodes = await detectorRef.current.detect(videoRef.current)
        for (const b of barcodes) {
          const text = clean(b.rawValue)
          if (!BADGE_REGEX.test(text)) continue

          const t = Date.now()
          if (text === lastScanRef.current.badge && t - lastScanRef.current.time < 2000) continue

          lastScanRef.current = { badge: text, time: t }
          setLastScanned(text)

          if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
          scanTimerRef.current = setTimeout(() => {
            if (mountedRef.current) setLastScanned('')
            scanTimerRef.current = null
          }, 1500)

          onScanRef.current(text)
          break
        }
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[Scanner] detect error:', e)
      } finally {
        isDetectingRef.current = false
      }

      rafRef.current = requestAnimationFrame(detect)
    }

    rafRef.current = requestAnimationFrame(detect)
  }

  useEffect(() => {
    mountedRef.current = true
    hasLinearBarcodeSupport().then(supported => {
      if (!supported) loadPolyfill()
    }).catch(() => {})
    startScanner()
    return () => {
      mountedRef.current = false
      stopScanner()
    }
  }, [])

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stopScanner()
      else if (mountedRef.current) startScanner()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useImperativeHandle(ref, () => ({
    stop:    stopScanner,
    resume:  () => { if (mountedRef.current) startScanner() },
    restart: () => { stopScanner(); setTimeout(() => { if (mountedRef.current) startScanner() }, 100) },
    toggleTorch,
  }), [])

  if (status === 'error') {
    return (
      <div className="scanner-wrapper">
        <div className="scanner-error-simple">
          <CameraOff size={32} />
          <p style={{ textAlign: 'center', padding: '0 1rem', fontSize: '0.85rem' }}>{errorMsg}</p>
          <button onClick={startScanner}><RefreshCw size={14} /> Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="scanner-wrapper">
      <video ref={videoRef} className="scanner-video" playsInline muted autoPlay />

      {status === 'loading' && (
        <div className="scanner-overlay">
          <div className="scanner-spinner" />
          <span>{engineLabel === 'WASM' ? 'Loading iOS engine…' : 'Starting camera...'}</span>
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className="scan-frame">
            <div className="scan-corner tl" />
            <div className="scan-corner tr" />
            <div className="scan-corner bl" />
            <div className="scan-corner br" />
            <div className="scan-line" />
          </div>

          <button
            className="scanner-torch-btn"
            onClick={toggleTorch}
            style={{ background: torchOn ? 'rgba(255,220,0,0.9)' : 'rgba(0,0,0,0.5)' }}
            title={torchOn ? 'Flash off' : 'Flash on'}
          >
            <Flashlight size={18} color={torchOn ? '#000' : '#fff'} />
          </button>

          <div className="scanner-fps-badge">
            <Zap size={10} />
            {fps}fps · {engineLabel}
          </div>

          {lastScanned && <div className="scan-result">{lastScanned}</div>}
          <div className="scan-tip">Position barcode within the frame</div>
        </>
      )}
    </div>
  )
})

export default BarcodeScanner
