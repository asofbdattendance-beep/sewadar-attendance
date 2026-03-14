import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { CameraOff, RefreshCw } from 'lucide-react'

const BADGE_REGEX = /^(BH|FB)[0-9]{4}[A-Z]{2}[0-9]{4}$/

const BarcodeScanner = forwardRef(function BarcodeScanner({ onScan }, ref) {
  const scannerRef = useRef(null)
  const mountedRef = useRef(true)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const cooldownRef = useRef(false)

  const [status, setStatus] = useState('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [lastScanned, setLastScanned] = useState('')

  const startScanner = async () => {
    if (!mountedRef.current) return

    setStatus('loading')
    setErrorMsg('')
    setLastScanned('')
    cooldownRef.current = false
    lastScanRef.current = { badge: null, time: 0 }

    try {
      if (scannerRef.current) {
        try { await scannerRef.current.stop() } catch {}
        scannerRef.current = null
      }

      const scanner = new Html5Qrcode('scanner-viewport', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_128
        ],
        verbose: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      })
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          // qrbox matches our visual scan-frame: wide, short strip for barcodes
          qrbox: { width: 260, height: 70 },
          // Disable the library's own shading/overlay so ours shows cleanly
          disableFlip: false,
          aspectRatio: 1.7778, // 16:9
        },
        (decodedText) => {
          if (!mountedRef.current || cooldownRef.current) return

          const text = decodedText.trim().toUpperCase()
          if (!BADGE_REGEX.test(text)) return

          const now = Date.now()
          if (text === lastScanRef.current.badge && now - lastScanRef.current.time < 3000) return

          lastScanRef.current = { badge: text, time: now }
          setLastScanned(text)
          cooldownRef.current = true
          onScan(text)

          setTimeout(() => {
            if (!mountedRef.current) return
            cooldownRef.current = false
            setLastScanned('')
            lastScanRef.current = { badge: null, time: 0 }
          }, 3000)
        },
        () => {} // per-frame error — ignore
      )

      if (mountedRef.current) setStatus('ready')
    } catch (err) {
      console.error('Scanner error:', err)
      if (mountedRef.current) {
        setStatus('error')
        setErrorMsg(err?.message || 'Camera not available')
      }
    }
  }

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch {}
      scannerRef.current = null
    }
  }

  useEffect(() => {
    mountedRef.current = true
    startScanner()
    return () => {
      mountedRef.current = false
      stopScanner()
    }
  }, [])

  useImperativeHandle(ref, () => ({
    stop: () => stopScanner(),
    resume: () => { if (mountedRef.current) startScanner() },
    restart: () => { stopScanner(); setTimeout(() => { if (mountedRef.current) startScanner() }, 150) }
  }), [])

  if (status === 'error') {
    return (
      <div className="scanner-wrapper">
        <div className="scanner-error-simple">
          <CameraOff size={32} />
          <p>{errorMsg || 'Camera not available'}</p>
          <button onClick={startScanner}><RefreshCw size={14} /> Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="scanner-wrapper">
      {/* html5-qrcode mounts the video stream here */}
      <div id="scanner-viewport" className="scanner-view" />

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

          {lastScanned && (
            <div className="scan-result">{lastScanned}</div>
          )}

          <div className="scan-tip">Position barcode within the frame</div>
        </>
      )}
    </div>
  )
})

export default BarcodeScanner