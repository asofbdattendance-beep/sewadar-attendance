import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import Quagga from '@ericblade/quagga2'
import { CameraOff, RefreshCw } from 'lucide-react'

const BADGE_REGEX = /^FB\d{4}[GL]A\d{4,}$/

const BarcodeScanner = forwardRef(function BarcodeScanner({ onScan }, ref) {
  const containerRef = useRef(null)
  const mountedRef = useRef(true)
  const startedRef = useRef(false)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const cooldownRef = useRef(false)

  const [status, setStatus] = useState('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [lastScanned, setLastScanned] = useState('')
  const [detectionBox, setDetectionBox] = useState(null)

  async function stopQuagga() {
    if (startedRef.current) {
      try { Quagga.stop() } catch {}
      startedRef.current = false
    }
  }

  async function startScanner() {
    await stopQuagga()
    if (!mountedRef.current || !containerRef.current) return

    setStatus('loading')
    setErrorMsg('')
    setLastScanned('')
    setDetectionBox(null)
    cooldownRef.current = false
    lastScanRef.current = { badge: null, time: 0 }

    return new Promise((resolve) => {
      Quagga.init(
        {
          inputStream: {
            type: 'LiveStream',
            target: containerRef.current,
            constraints: {
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          locator: {
            patchSize: 'medium',
            halfSample: true,
          },
          numOfWorkers: 2,
          frequency: 10,
          decoder: {
            readers: [
              'code_39_reader',
              'code_128_reader',
            ],
          },
          locate: true,
        },
        async (err) => {
          if (!mountedRef.current) return

          if (err) {
            console.error('Quagga error:', err)
            setStatus('error')
            setErrorMsg('Camera not available')
            resolve(false)
            return
          }

          startedRef.current = true
          Quagga.start()
          setStatus('ready')
          resolve(true)
        }
      )
    })
  }

  useEffect(() => {
    mountedRef.current = true

    function handleDetected(result) {
      if (!mountedRef.current) return
      
      if (result?.box) {
        setDetectionBox(result.box)
        setTimeout(() => setDetectionBox(null), 500)
      }

      if (cooldownRef.current) return

      const code = result?.codeResult?.code
      if (!code) return

      const text = code.trim().toUpperCase()
      if (!BADGE_REGEX.test(text)) return

      const now = Date.now()
      if (text === lastScanRef.current.badge && now - lastScanRef.current.time < 3000) return

      lastScanRef.current = { badge: text, time: now }
      setLastScanned(text)

      cooldownRef.current = true
      setTimeout(() => {
        cooldownRef.current = false
        setLastScanned('')
        lastScanRef.current = { badge: null, time: 0 }
      }, 3000)

      onScan(text)
    }

    function handleProcessed(result) {
      if (!mountedRef.current || !result?.box) return
      setDetectionBox(result.box)
    }

    Quagga.onDetected(handleDetected)
    Quagga.onProcessed(handleProcessed)

    const timer = setTimeout(() => {
      if (mountedRef.current) startScanner()
    }, 300)

    return () => {
      mountedRef.current = false
      clearTimeout(timer)
      Quagga.offDetected(handleDetected)
      Quagga.offProcessed(handleProcessed)
      stopQuagga()
    }
  }, [onScan])

  useImperativeHandle(ref, () => ({
    stop: () => stopQuagga(),
    resume: () => {
      lastScanRef.current = { badge: null, time: 0 }
      if (status !== 'ready') startScanner()
    },
    restart: () => {
      stopQuagga()
      setTimeout(startScanner, 100)
    }
  }), [status])

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
      <div ref={containerRef} className="scanner-view" />

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
