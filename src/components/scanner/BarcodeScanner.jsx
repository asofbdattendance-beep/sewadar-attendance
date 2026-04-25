/**
 * BarcodeScanner — Single-engine, cross-platform
 * Works on mobile (back camera) and desktop (webcam)
 *
 * Uses BarcodeDetector API everywhere.
 * On Android/Chrome: native hardware-accelerated
 * On iOS/Safari + others: @undecaf/barcode-detector-polyfill (ZBar WASM)
 */

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { CameraOff, RefreshCw, Zap } from 'lucide-react'

const BADGE_REGEX = /^(BH|FB)[0-9]{4}[A-Z]{1,2}[0-9]{4,}$/

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
  const [fps, setFps] = useState(0)
  const fpsRef = useRef({ frames: 0, last: Date.now() })

  const stopScanner = () => {
    console.log('stopScanner called')
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (streamRef.current) { 
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null 
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.load()
    }
    isDetectingRef.current = false
  }

  const startScanner = async () => {
    console.log('startScanner called, mounted:', mountedRef.current)
    if (!mountedRef.current) return
    
    // Stop existing first
    stopScanner()
    
    setStatus('loading')
    setErrorMsg('')
    setLastScanned('')
    fpsRef.current = { frames: 0, last: Date.now() }

    // ── Step 1: Load barcode engine ──
    const hasNative = await hasLinearBarcodeSupport()
    if (!hasNative) {
      try {
        setStatus('loading')
        await loadPolyfill()
        setEngineLabel('WASM')
      } catch (err) {
        if (mountedRef.current) {
          setStatus('error')
          setErrorMsg('Could not load barcode engine. Check internet connection.')
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
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'environment'
        },
        audio: false
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
      
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
    } catch (err) {
      if (!mountedRef.current) return
      setStatus('error')
      if (err.name === 'NotAllowedError') {
        setErrorMsg('Camera permission denied. Please allow camera access in your browser settings, then tap Retry.')
      } else if (err.name === 'NotFoundError') {
        setErrorMsg('No camera found on this device. Please connect a camera.')
      } else {
        setErrorMsg('Camera not available. Please check camera connection.')
      }
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
        } catch (err) {
          console.warn('Barcode detection error:', err)
        }
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
    stop: () => {
      console.log('Scanner: stop')
      stopScanner()
    },
    resume: () => { 
      console.log('Scanner: resume')
      if (mountedRef.current) startScanner() 
    },
    restart: () => { 
      console.log('Scanner: restart')
      stopScanner()
      setTimeout(() => { 
        console.log('Scanner: starting after delay')
        if (mountedRef.current) startScanner() 
      }, 300) 
    }
  }), [])

  if (status === 'error') {
    return (
      <div className="scanner-wrapper">
        <div className="scanner-error-simple">
          <CameraOff size={32} />
          <p style={{ textAlign: 'center', padding: '0 1rem', fontSize: '0.85rem' }}>{errorMsg}</p>
          <button onClick={() => startScanner()}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="scanner-wrapper">
      <div className="scanner-view">
        <video ref={videoRef} playsInline muted autoPlay />
      </div>

      {status === 'loading' && (
        <div className="scanner-overlay">
          <div className="scanner-spinner" />
          <span>{engineLabel === 'WASM' ? 'Loading engine…' : 'Starting camera...'}</span>
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

          <div className="scanner-info-badge">
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
