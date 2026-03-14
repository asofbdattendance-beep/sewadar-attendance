/**
 * BarcodeScanner — Dual-engine scanner
 *
 * Engine 1 — BarcodeDetector API (Android Chrome, Samsung Internet)
 *   - Hardware-accelerated, runs on GPU/ISP
 *   - ~2-8ms per frame at 60fps via requestAnimationFrame
 *
 * Engine 2 — ZXing (iOS Safari + any browser without BarcodeDetector)
 *   - Best JS fallback, used by many production apps
 *   - Runs at ~15fps, still fast enough for badge scanning
 *
 * Auto-detects which engine to use on mount.
 */

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { CameraOff, RefreshCw, Zap } from 'lucide-react'

const BADGE_REGEX = /^(BH|FB)[0-9]{4}[A-Z]{1,2}[0-9]{4,}$/

// Clean raw barcode text — strip spaces, trim, uppercase
function clean(raw) {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

// ── Engine detection ──
function hasNativeBarcodeDetector() {
  return 'BarcodeDetector' in window
}

const BarcodeScanner = forwardRef(function BarcodeScanner({ onScan }, ref) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const detectorRef = useRef(null)      // native BarcodeDetector instance
  const zxingReaderRef = useRef(null)   // ZXing reader instance
  const mountedRef = useRef(true)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const isDetectingRef = useRef(false)
  const engineRef = useRef(null)        // 'native' | 'zxing'

  const [status, setStatus] = useState('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [lastScanned, setLastScanned] = useState('')
  const [engine, setEngine] = useState(null)
  const fpsRef = useRef({ frames: 0, last: Date.now() })
  const [fps, setFps] = useState(0)

  const stopScanner = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (zxingReaderRef.current) {
      try { zxingReaderRef.current.reset() } catch {}
      zxingReaderRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    isDetectingRef.current = false
  }

  // Called on every successful decode from either engine
  function handleDecoded(raw) {
    const text = clean(raw)
    if (!BADGE_REGEX.test(text)) return
    const now = Date.now()
    if (text === lastScanRef.current.badge && now - lastScanRef.current.time < 2000) return
    lastScanRef.current = { badge: text, time: now }
    setLastScanned(text)
    setTimeout(() => { if (mountedRef.current) setLastScanned('') }, 1500)
    onScan(text)
  }

  // ── Get camera stream ──
  async function getStream() {
    return navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false
    })
  }

  // ── ENGINE 1: Native BarcodeDetector (Android / Chrome) ──
  async function startNative() {
    detectorRef.current = new window.BarcodeDetector({
      formats: ['code_39', 'code_128', 'codabar']
    })
    engineRef.current = 'native'
    setEngine('native')

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
          for (const b of barcodes) handleDecoded(b.rawValue)
        } catch {}
        isDetectingRef.current = false
      }
      rafRef.current = requestAnimationFrame(detect)
    }
    rafRef.current = requestAnimationFrame(detect)
  }

  // ── ENGINE 2: ZXing (iOS Safari + fallback) ──
  async function startZXing() {
    engineRef.current = 'zxing'
    setEngine('zxing')

    // Load ZXing from CDN — only downloaded on iOS/non-native devices
    // Android/Chrome users never hit this path so no bundle cost for them
    const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } =
      await import('https://esm.sh/@zxing/browser@0.1.5')

    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_128,
    ])
    hints.set(DecodeHintType.TRY_HARDER, true)

    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 50,  // ms between attempts — keep low for speed
      delayBetweenScanSuccess: 1500, // ms cooldown after a successful scan
    })
    zxingReaderRef.current = reader

    // ZXing decodes directly from the video stream
    // We pass the already-running video element
    reader.decodeFromVideoElement(videoRef.current, (result, err) => {
      if (!mountedRef.current) return
      if (result) {
        fpsRef.current.frames++
        const now = Date.now()
        if (now - fpsRef.current.last >= 1000) {
          setFps(fpsRef.current.frames)
          fpsRef.current = { frames: 0, last: now }
        }
        handleDecoded(result.getText())
      }
      // err is a not-found error on most frames — expected, ignore
    })
  }

  const startScanner = async () => {
    if (!mountedRef.current) return
    stopScanner()

    setStatus('loading')
    setErrorMsg('')
    setLastScanned('')
    lastScanRef.current = { badge: null, time: 0 }
    fpsRef.current = { frames: 0, last: Date.now() }

    // ── Get camera ──
    try {
      const stream = await getStream()
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
    } catch (err) {
      if (!mountedRef.current) return
      setStatus('error')
      setErrorMsg(err.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access and retry.'
        : 'Camera not available on this device.')
      return
    }

    if (!mountedRef.current) return
    setStatus('ready')

    // ── Pick engine ──
    try {
      if (hasNativeBarcodeDetector()) {
        await startNative()
      } else {
        await startZXing()
      }
    } catch (err) {
      console.error('Scanner engine error:', err)
      // If native failed, try ZXing
      if (engineRef.current === 'native') {
        try { await startZXing() } catch {}
      } else {
        if (mountedRef.current) {
          setStatus('error')
          setErrorMsg('Barcode scanner could not start. Try Chrome browser.')
        }
      }
    }
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
      <video
        ref={videoRef}
        className="scanner-video"
        playsInline
        muted
        autoPlay
      />

      {status === 'loading' && (
        <div className="scanner-overlay">
          <div className="scanner-spinner" />
          <span>Starting camera...</span>
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
            {fps}fps · {engine === 'native' ? 'Native' : 'ZXing'}
          </div>

          {lastScanned && <div className="scan-result">{lastScanned}</div>}
          <div className="scan-tip">Position barcode within the frame</div>
        </>
      )}
    </div>
  )
})

export default BarcodeScanner