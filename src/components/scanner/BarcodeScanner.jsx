import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { CameraOff, RefreshCw, Zap, Sun } from 'lucide-react'

const BADGE_REGEX = /^FB(597[1-9]|59[89]\d|600\d|601[01])(GA|LA)\d{4}$/

const RESOLUTION_CHAIN = [
  { width: { max: 1280, ideal: 720 }, height: { max: 720, ideal: 480 } },
  { width: { max: 640, ideal: 480 }, height: { max: 480, ideal: 360 } },
  { width: { max: 480, ideal: 360 }, height: { max: 360, ideal: 270 } },
  { width: { max: 320, ideal: 240 }, height: { max: 240, ideal: 180 } },
]

const QUALITY = {
  MIN_BRIGHTNESS: 25,
  MAX_BRIGHTNESS: 230,
  MIN_VARIANCE: 400,
}

const DEVICE_PROFILES = {
  fast: {
    resolutionIndex: 0,
    confirmWindow: 3,
    confirmThreshold: 2,
    minInterval: 50,
    maxInterval: 150,
    frameSkip: 0,
    useQualityGate: false,
  },
  medium: {
    resolutionIndex: 1,
    confirmWindow: 4,
    confirmThreshold: 2,
    minInterval: 100,
    maxInterval: 300,
    frameSkip: 1,
    useQualityGate: true,
  },
  slow: {
    resolutionIndex: 2,
    confirmWindow: 3,
    confirmThreshold: 1,
    minInterval: 200,
    maxInterval: 500,
    frameSkip: 2,
    useQualityGate: true,
  },
}

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

function createQualityChecker() {
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 36
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  return function check(video) {
    try {
      ctx.drawImage(video, 0, 0, 48, 36)
      const d = ctx.getImageData(0, 0, 48, 36).data
      let sum = 0
      let sumSq = 0
      const len = d.length / 4
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        sum += lum
        sumSq += lum * lum
      }
      const mean = sum / len
      const variance = sumSq / len - mean * mean
      if (mean < QUALITY.MIN_BRIGHTNESS) return { ok: false, reason: 'dark' }
      if (mean > QUALITY.MAX_BRIGHTNESS) return { ok: false, reason: 'bright' }
      if (variance < QUALITY.MIN_VARIANCE) return { ok: false, reason: 'blurry' }
      return { ok: true }
    } catch {
      return { ok: true }
    }
  }
}

async function profileDevice(detector, video, samples = 5) {
  const times = []
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now()
    try {
      await detector.detect(video)
    } catch {
      /* skip failed frames */
    }
    times.push(performance.now() - t0)
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  if (avg < 30) return 'fast'
  if (avg < 120) return 'medium'
  return 'slow'
}

function getGuidanceMessage(qualityResult, barcodeFound, elapsed, hasEverDetected) {
  if (elapsed < 2000) return null
  if (!qualityResult.ok) {
    if (qualityResult.reason === 'dark') return 'Better lighting needed'
    if (qualityResult.reason === 'bright') return 'Reduce glare on the barcode'
    if (qualityResult.reason === 'blurry') return 'Hold steady or clean camera lens'
  }
  if (barcodeFound && !hasEverDetected) return null
  if (elapsed > 5000 && !barcodeFound) return 'Align barcode within the frame'
  if (elapsed > 15000 && !barcodeFound) return 'Having trouble? Try Manual Entry below'
  return null
}

const BarcodeScanner = forwardRef(function BarcodeScanner({ onScan }, ref) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const detectorRef = useRef(null)
  const mountedRef = useRef(true)
  const onScanRef = useRef(onScan)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const isDetectingRef = useRef(false)
  const fpsRef = useRef({ frames: 0, last: Date.now() })
  const frameCountRef = useRef(0)
  const slidingWindowRef = useRef([])
  const qualityCheckRef = useRef(null)
  const guidanceTimerRef = useRef(null)
  const noScanStartRef = useRef(0)
  const hasEverDetectedRef = useRef(false)
  const configRef = useRef(DEVICE_PROFILES.medium)
  const profileCompleteRef = useRef(false)

  const [status, setStatus] = useState('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [lastScanned, setLastScanned] = useState('')
  const [engineLabel, setEngineLabel] = useState('')
  const [fps, setFps] = useState(0)
  const [detectedBox, setDetectedBox] = useState(null)
  const [guidanceMsg, setGuidanceMsg] = useState(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [deviceProfile, setDeviceProfile] = useState('medium')
  onScanRef.current = onScan

  const stopScanner = () => {
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
    slidingWindowRef.current = []
    frameCountRef.current = 0
    profileCompleteRef.current = false
    hasEverDetectedRef.current = false
    noScanStartRef.current = 0
    if (guidanceTimerRef.current) { clearTimeout(guidanceTimerRef.current); guidanceTimerRef.current = null }
  }

  const updateResolution = async (index) => {
    if (!streamRef.current) return
    const track = streamRef.current.getVideoTracks()[0]
    if (!track) return
    const res = RESOLUTION_CHAIN[index]
    try {
      await track.applyConstraints({
        width: res.width,
        height: res.height,
      })
    } catch {
      /* not all browsers support dynamic constraint changes */
    }
  }

  const showGuidance = (msg) => {
    if (guidanceTimerRef.current) clearTimeout(guidanceTimerRef.current)
    setGuidanceMsg(msg)
    if (msg) {
      guidanceTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setGuidanceMsg(null)
      }, 4000)
    }
  }

  const startScanner = async () => {
    if (!mountedRef.current) return
    stopScanner()

    setStatus('loading')
    setErrorMsg('')
    setLastScanned('')
    setGuidanceMsg(null)
    setDetectedBox(null)
    fpsRef.current = { frames: 0, last: Date.now() }
    frameCountRef.current = 0
    profileCompleteRef.current = false
    hasEverDetectedRef.current = false
    noScanStartRef.current = 0
    slidingWindowRef.current = []

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

    try {
      detectorRef.current = new window.BarcodeDetector({
        formats: ['code_39', 'code_128', 'codabar'],
      })
    } catch (err) {
      if (mountedRef.current) { setStatus('error'); setErrorMsg('Failed to start barcode detector') }
      return
    }

    // Start at high res for native, medium for WASM
    const startResIndex = hasNative ? 0 : 1
    let stream = null
    for (let i = startResIndex; i < RESOLUTION_CHAIN.length; i++) {
      const res = RESOLUTION_CHAIN[i]
      if (!mountedRef.current) return
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...res, facingMode: 'environment' },
          audio: false,
        })
        break
      } catch (err) {
        if (i === RESOLUTION_CHAIN.length - 1) {
          if (!mountedRef.current) return
          setStatus('error')
          if (err.name === 'NotAllowedError') {
            setErrorMsg('Camera permission denied. Please allow camera access in your browser settings, then tap Retry.')
          } else if (err.name === 'NotFoundError') {
            setErrorMsg('No camera found on this device. Please connect a camera.')
          } else {
            try {
              stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
              break
            } catch (fallbackErr) {
              setErrorMsg('Camera not available. Please check camera connection.')
              return
            }
          }
          return
        }
      }
    }

    if (!mountedRef.current) { if (stream) stream.getTracks().forEach(t => t.stop()); return }
    streamRef.current = stream
    videoRef.current.srcObject = stream

    // Check torch support
    const videoTrack = stream.getVideoTracks()[0]
    if (videoTrack) {
      try {
        const caps = videoTrack.getCapabilities?.()
        setTorchSupported(!!caps?.torch)
      } catch { /* ignore */ }
    }

    try {
      await videoRef.current.play()
    } catch (err) {
      if (mountedRef.current) { setStatus('error'); setErrorMsg('Could not start video playback.') }
      return
    }

    // Wait for video to be ready then benchmark
    await new Promise((resolve) => {
      const check = () => {
        if (videoRef.current?.readyState >= 2) resolve()
        else requestAnimationFrame(check)
      }
      check()
    })

    if (!mountedRef.current) return
    setStatus('ready')
    noScanStartRef.current = Date.now()
    qualityCheckRef.current = createQualityChecker()

    // Profile device asynchronously — start detection with default config
    ;(async () => {
      if (!mountedRef.current) return
      const profile = await profileDevice(detectorRef.current, videoRef.current)
      if (!mountedRef.current) return

      if (profile === 'fast') {
        configRef.current = DEVICE_PROFILES.fast
        setDeviceProfile('fast')
        if (hasNative) updateResolution(0)
      } else if (profile === 'slow') {
        configRef.current = DEVICE_PROFILES.slow
        setDeviceProfile('slow')
        updateResolution(2)
      } else {
        configRef.current = DEVICE_PROFILES.medium
        setDeviceProfile('medium')
      }
      profileCompleteRef.current = true
    })()

    // Detection loop
    const config = { minInterval: 100, maxInterval: 300 }
    let guidanceCheckCounter = 0

    const detect = async () => {
      if (!mountedRef.current) return

      fpsRef.current.frames++
      const now = Date.now()
      if (now - fpsRef.current.last >= 1000) {
        setFps(fpsRef.current.frames)
        fpsRef.current = { frames: 0, last: now }
      }

      if (!isDetectingRef.current && videoRef.current?.readyState >= 3) {
        const cfg = configRef.current
        frameCountRef.current++

        // Frame skipping for slow devices
        if (cfg.frameSkip > 0 && (frameCountRef.current % (cfg.frameSkip + 1) !== 0)) {
          scheduleNext(cfg)
          return
        }

        // Quality gate for WASM
        if (cfg.useQualityGate && qualityCheckRef.current) {
          const quality = qualityCheckRef.current(videoRef.current)
          if (!quality.ok) {
            guidanceCheckCounter++
            if (guidanceCheckCounter % 15 === 0) {
              const elapsed = Date.now() - noScanStartRef.current
              showGuidance(getGuidanceMessage(quality, false, elapsed, hasEverDetectedRef.current))
            }
            scheduleNext(cfg)
            return
          }
        }

        isDetectingRef.current = true
        let foundBox = null
        let barcodeFound = false

        try {
          const t0 = performance.now()
          const barcodes = await detectorRef.current.detect(videoRef.current)
          const elapsed = performance.now() - t0

          // Dynamic interval: adjust based on how long detection took
          const nextDelay = Math.max(cfg.minInterval, Math.min(cfg.maxInterval, elapsed / 0.5))
          config.nextDelay = nextDelay

          for (const b of barcodes) {
            const text = clean(b.rawValue)
            if (!BADGE_REGEX.test(text)) continue

            barcodeFound = true
            hasEverDetectedRef.current = true

            const corners = b.cornerPoints
            const vw = videoRef.current.videoWidth
            const vh = videoRef.current.videoHeight
            if (corners && corners.length >= 4) {
              const cx = corners.reduce((s, p) => s + p.x, 0) / 4
              const cy = corners.reduce((s, p) => s + p.y, 0) / 4
              const mx = vw * 0.1, my = vh * 0.1
              if (cx < mx || cx > vw - mx || cy < my || cy > vh - my) continue
            }

            // Sliding window confirmation
            const result = updateWindow(text, cfg)
            if (result.confirmed) {
              const t = Date.now()
              if (text === lastScanRef.current.badge && t - lastScanRef.current.time < 2000) break
              lastScanRef.current = { badge: text, time: t }
              slidingWindowRef.current = []
              setLastScanned(text)
              setTimeout(() => { if (mountedRef.current) setLastScanned('') }, 1500)
              noScanStartRef.current = Date.now()
              onScanRef.current(text)
            }

            // Display box
            const scaleX = videoRef.current.clientWidth / vw
            const scaleY = videoRef.current.clientHeight / vh
            if (corners && corners.length >= 4) {
              const xs = corners.map(p => p.x * scaleX)
              const ys = corners.map(p => p.y * scaleY)
              foundBox = {
                left: Math.min(...xs), top: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
              }
            } else if (b.boundingBox) {
              foundBox = {
                left: b.boundingBox.x * scaleX, top: b.boundingBox.y * scaleY,
                width: b.boundingBox.width * scaleX, height: b.boundingBox.height * scaleY,
              }
            }
            break
          }
        } catch (err) {
          console.warn('Barcode detection error:', err)
        }

        setDetectedBox(foundBox)
        isDetectingRef.current = false

        // Guidance: periodic check
        guidanceCheckCounter++
        if (guidanceCheckCounter % 20 === 0) {
          const elapsed = Date.now() - noScanStartRef.current
          showGuidance(getGuidanceMessage({ ok: true }, barcodeFound, elapsed, hasEverDetectedRef.current))
        }
      }

      scheduleNext(config)
    }

    function updateWindow(badge, cfg) {
      const w = slidingWindowRef.current
      const now = Date.now()
      w.push({ badge, time: now })

      let trimmed = w.filter(e => e.time > now - 3000)
      if (trimmed.length > cfg.confirmWindow) trimmed = trimmed.slice(-cfg.confirmWindow)
      slidingWindowRef.current = trimmed

      const count = trimmed.filter(e => e.badge === badge).length
      return { confirmed: count >= cfg.confirmThreshold, count }
    }

    function scheduleNext(cfg) {
      const delay = cfg.nextDelay || 150
      rafRef.current = requestAnimationFrame(() => {
        setTimeout(() => detect(), delay)
      })
    }

    scheduleNext(config)
  }

  const toggleTorch = async () => {
    if (!streamRef.current) return
    const track = streamRef.current.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] })
      setTorchOn(!torchOn)
    } catch { /* torch not supported */ }
  }

  useEffect(() => {
    mountedRef.current = true
    startScanner()
    return () => { mountedRef.current = false; stopScanner() }
  }, [])

  useImperativeHandle(ref, () => ({
    stop: () => { stopScanner() },
    resume: () => { if (mountedRef.current) startScanner() },
    restart: () => { stopScanner(); setTimeout(() => { if (mountedRef.current) startScanner() }, 300) },
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
          {detectedBox && (
            <div className="scan-detected-box" style={{
              left: detectedBox.left, top: detectedBox.top,
              width: detectedBox.width, height: detectedBox.height,
            }}>
              <div className="scan-detected-corner tl" />
              <div className="scan-detected-corner tr" />
              <div className="scan-detected-corner bl" />
              <div className="scan-detected-corner br" />
            </div>
          )}

          {/* Guidance message */}
          {guidanceMsg && (
            <div className="scan-guidance">{guidanceMsg}</div>
          )}

          {/* Torch button */}
          {torchSupported && (
            <button
              className={`torch-btn ${torchOn ? 'torch-on' : ''}`}
              onClick={toggleTorch}
              title={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
            >
              <Sun size={16} />
            </button>
          )}

          <div className="scanner-info-badge">
            <Zap size={10} />
            {fps}fps · {engineLabel}
            <span className="camera-name">· {deviceProfile}</span>
          </div>

          {lastScanned && <div className="scan-result">{lastScanned}</div>}
          <div className="scan-tip">Position barcode within the frame</div>
        </>
      )}
    </div>
  )
})

export default BarcodeScanner
