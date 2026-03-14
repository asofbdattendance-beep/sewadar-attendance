import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { CameraOff, RefreshCw } from 'lucide-react'

const BADGE_REGEX = /^FB\d{4}[GL]A\d{4,}$/

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
        try {
          await scannerRef.current.stop()
        } catch {}
      }

      const scanner = new Html5Qrcode('scanner-viewport', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_128
        ],
        verbose: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      })
      scannerRef.current = scanner

      console.log('Starting camera...')
      
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 280, height: 80 },
        },
        (decodedText) => {
          if (!mountedRef.current || cooldownRef.current) return

          const text = decodedText.trim().toUpperCase()
          console.log('Detected:', text)
          
          if (!BADGE_REGEX.test(text)) {
            console.log('Rejected - regex mismatch')
            return
          }

          const now = Date.now()
          if (text === lastScanRef.current.badge && now - lastScanRef.current.time < 3000) return

          lastScanRef.current = { badge: text, time: now }
          setLastScanned(text)
          cooldownRef.current = true
          onScan(text)

          setTimeout(() => {
            cooldownRef.current = false
            setLastScanned('')
            lastScanRef.current = { badge: null, time: 0 }
          }, 3000)
        },
        () => {}
      )

      console.log('Camera started successfully')
      setStatus('ready')
    } catch (err) {
      console.error('Scanner error:', err)
      setStatus('error')
      setErrorMsg(err?.message || 'Camera not available')
    }
  }

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop()
      } catch {}
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
    resume: () => startScanner(),
    restart: () => {
      stopScanner()
      setTimeout(startScanner, 100)
    }
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
      <div id="scanner-viewport" className="scanner-view" style={{ width: '100%', height: '320px' }} />

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
