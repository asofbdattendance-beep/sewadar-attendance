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
import { CameraOff, RefreshCw, Zap } from 'lucide-react'

const BADGE_REGEX = /^(BH|FB)[0-9]{4}[A-Z]{1,2}[0-9]{4,}$/

function clean(raw) {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

// Check if native BarcodeDetector supports linear barcodes (Code39/128)
// iOS Safari has BarcodeDetector but only QR/2D — we need linear support
async function hasLinearBarcodeSupport() {
  if (!('BarcodeDetector' in window)) return false
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats()
    return formats.includes('code_39') || formats.includes('code_128')
  } catch {
    return false
  }
}

// Load polyfill from CDN — only called on iOS/unsupported browsers
// Uses ZBar WASM which supports Code39, Code128, and all linear formats
async function loadPolyfill() {
  const { BarcodeDetectorPolyfill } =
    await import('https://cdn.jsdelivr.net/npm/@undecaf/barcode-detector-polyfill@0.9.21/dist/es/index.js')
  // Install as global so existing code works unchanged
  window.BarcodeDetector = BarcodeDetectorPolyfill
}

const BarcodeScanner = forwardRef(function BarcodeScanner({ onScan }, ref) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const detectorRef = useRef(null)
  const mountedRef = useRef(true)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const isDetectingRef = useRef(false)

  const [status, setStatus] = useState('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [lastScanned, setLastScanned] = useState('')
  const [engineLabel, setEngineLabel] = useState('')
  const fpsRef = useRef({ frames: 0, last: Date.now() })
  const [fps, setFps] = useState(0)

  const stopScanner = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (videoRef.current) videoRef.current.srcObject = null
    isDetectingRef.current = false
  }

  const startScanner = async () => {
    if (!mountedRef.current) return
    stopScanner()
    setStatus('loading')
    setErrorMsg('')
    setLastScanned('')
    lastScanRef.current = { badge: null, time: 0 }
    fpsRef.current = { frames: 0, last: Date.now() }

    // ── Step 1: Ensure BarcodeDetector supports linear barcodes ──
    const hasNative = await hasLinearBarcodeSupport()
    if (!hasNative) {
      // Load polyfill — replaces window.BarcodeDetector with ZBar WASM
      try {
        setStatus('loading') // still loading while WASM downloads
        await loadPolyfill()
        setEngineLabel('WASM')
      } catch (err) {
        if (mountedRef.current) {
          setStatus('error')
          setErrorMsg('Could not load barcode engine. Check internet connection and retry.')
        }
        return
      }
    } else {
      setEngineLabel('Native')
    }

    // ── Step 2: Create detector ──
    try {
      detectorRef.current = new window.BarcodeDetector({
        formats: ['code_39', 'code_128', 'codabar']
      })
    } catch (err) {
      if (mountedRef.current) { setStatus('error'); setErrorMsg('Failed to start barcode detector') }
      return
    }

    // ── Step 3: Get camera stream ──
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
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

    // ── Step 4: Detection loop ──
    const detect = async () => {
      if (!mountedRef.current) return

      fpsRef.current.frames++
      const now = Date.now()
      if (now - fpsRef.current.last >= 1000) {
        setFps(fpsRef.current.frames)
        fpsRef.current = { frames: 0, last: now }
      }

      if (!isDetectingRef.current && videoRef.current?.readyState === 4) {
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
            setTimeout(() => { if (mountedRef.current) setLastScanned('') }, 1500)
            onScan(text)
            break
          }
        } catch {}
        isDetectingRef.current = false
      }

      rafRef.current = requestAnimationFrame(detect)
    }

    rafRef.current = requestAnimationFrame(detect)
  }

  useEffect(() => {
    mountedRef.current = true
    startScanner()
    return () => { mountedRef.current = false; stopScanner() }
  }, [])

  useImperativeHandle(ref, () => ({
    stop: stopScanner,
    resume: () => { if (mountedRef.current) startScanner() },
    restart: () => { stopScanner(); setTimeout(() => { if (mountedRef.current) startScanner() }, 100) }
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