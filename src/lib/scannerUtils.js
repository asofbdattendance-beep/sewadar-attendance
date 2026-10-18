/**
 * scannerUtils.js — engine subset ported from sewadar-deployment-portal
 * (src/lib/scannerUtils.js).
 *
 * Only the symbols the scanner engine needs are carried over:
 * withTimeout, CAMERA_INIT_TIMEOUT, isSecureCameraContext, rgbaToGray,
 * computeRoi, isEdgeDetection, detectionBox, waitForVideoReady,
 * SCAN_ROTATIONS, rotateGray, sanitizeBarcode.
 * Portal business helpers (RPC timeouts, IndexedDB, IST dates, popups) are
 * intentionally NOT ported — this repo's pages own that logic.
 */

// ─── Constants ────────────────────────────────────────────────────────────────
export const CAMERA_INIT_TIMEOUT = 10000 // ms — getUserMedia + play

// ─── withTimeout ──────────────────────────────────────────────────────────────
/**
 * Wraps a promise with a timeout. Rejects with a descriptive error if the
 * promise doesn't resolve within `ms` milliseconds.
 *
 * @template T
 * @param {PromiseLike<T>|T} promise — a real Promise, OR a supabase `rpc()`
 *   builder (a `PromiseLike` with no `.catch`). Both are accepted.
 * @param {number} ms
 * @param {string} [label] — descriptive label for the error message
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms = 8000, label = 'Operation') {
  // Every caller passes a supabase `rpc()` builder, which is a bare
  // PromiseLike: it implements `then` and has NO `catch` method. Calling
  // `.catch()` on it directly threw "promise.catch is not a function" inside
  // every scan RPC, which the Scanner page surfaced verbatim in its error
  // toast — so no scan could ever be recorded. `Promise.resolve` assimilates any
  // thenable into a real Promise and leaves a genuine Promise untouched.
  const tracked = Promise.resolve(promise)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // Attach a no-op late handler so a slow wrapped promise that loses the
  // race never raises unhandled-rejection noise when it settles late.
  tracked.then(() => {}, () => {});
  return Promise.race([
    tracked.catch(e => { throw e; }),
    new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      });
    })
  ]).finally(() => clearTimeout(timer));
}

// ─── isSecureCameraContext ─────────────────────────────────────────────────────
/**
 * True only when the page can actually acquire a camera. `navigator.mediaDevices`
 * is undefined on insecure origins (plain http:// on a non-localhost host) and in
 * non-browser contexts, which is the single most common "blank scanner" cause.
 * @returns {boolean}
 */
export function isSecureCameraContext() {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext === false) return false
  return !!navigator?.mediaDevices?.getUserMedia
}

// ─── rgbaToGray ───────────────────────────────────────────────────────────────
/**
 * Collapse a canvas `ImageData` (4 bytes/px RGBA) to 1 byte/px grayscale.
 *
 * ZXing's `RGBLuminanceSource` decides how to read its buffer by
 * `BYTES_PER_ELEMENT`: a `Uint8ClampedArray` has value 1, so it is interpreted
 * as ALREADY-grayscale. Handing it raw RGBA therefore feeds the binarizer a
 * squashed, channel-interleaved frame and it never decodes anything. Converting
 * explicitly is the only way to get a real luminance buffer.
 *
 * Uses luma weights (0.299/0.587/0.114) rather than a flat channel average so
 * binarization sees the contrast that actually matters for a dark badge.
 *
 * One decode runs per frame, so one module-level scratch buffer is shared
 * across calls (allocating per frame stalls low-end phones in GC). The
 * buffer is only valid until the next call — the sole caller (the ZXing
 * decode path) consumes it synchronously inside the same detect() pass.
 *
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} imageData
 * @returns {Uint8ClampedArray} length = width * height
 */
let _grayScratch = null
export function rgbaToGray(imageData) {
  const { data, width, height } = imageData || {}
  if (!data || !width || !height) return new Uint8ClampedArray(0)
  const n = width * height
  if (!_grayScratch || _grayScratch.length !== n) _grayScratch = new Uint8ClampedArray(n)
  const out = _grayScratch
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000
  }
  return out
}

// ─── computeRoi ────────────────────────────────────────────────────────────────
/**
 * Region-of-interest crop used for every detection pass.
 *
 * Badges are wide and short, so a centred horizontal band covers far more
 * barcode pixels than a full-frame pass while costing much less to decode —
 * that is what keeps low-end phones scanning fast. `mode: 'full'` widens the
 * crop to the whole frame, which the scanner falls back to when a band keeps
 * missing (badge held close to the lens, or a portrait capture).
 *
 * @param {number} vw — video intrinsic width
 * @param {number} vh — video intrinsic height
 * @param {{mode?: 'band'|'full', maxWidth?: number}} [opts]
 * @returns {{sx:number, sy:number, sw:number, sh:number, dw:number, dh:number, scale:number}}
 */
export function computeRoi(vw, vh, opts = {}) {
  const { mode = 'band', maxWidth = 720 } = opts
  if (!vw || !vh) return { sx: 0, sy: 0, sw: 0, sh: 0, dw: 0, dh: 0, scale: 1 }

  const wFrac = mode === 'full' ? 1 : 0.92
  const hFrac = mode === 'full' ? 1 : 0.62

  const sw = Math.max(1, Math.round(vw * wFrac))
  const sh = Math.max(1, Math.round(vh * hFrac))
  const sx = Math.max(0, Math.round((vw - sw) / 2))
  const sy = Math.max(0, Math.round((vh - sh) / 2))

  // Never upscale — only ever pay for a smaller decode surface.
  const scale = sw > maxWidth ? maxWidth / sw : 1
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))

  return { sx, sy, sw, sh, dw, dh, scale }
}

// ─── isEdgeDetection ─────────────────────────────────────────────────────────
/**
 * True when a detection's centroid hugs the frame edge (< 2% margin).
 *
 * Points arrive in detect-canvas coordinates, so they are mapped back to
 * video pixels first (divide by the downscaled size, multiply by the crop,
 * add the crop offset).
 *
 * The threshold is >= 2 points: the ZXing path can never satisfy a 4-point
 * requirement (a 1D barcode yields 2 result points), so edge rejection would
 * silently differ by browser/engine. Two points centroid just as well as four
 * for a centre-within-margin test. Fewer than 2 points (or no video size)
 * never blocks: degenerate data must not suppress a read.
 *
 * @param {Array<{x:number,y:number}>} points
 * @param {{sx:number,sy:number,sw:number,sh:number,dw:number,dh:number}} roi
 * @param {number} vw — video intrinsic width
 * @param {number} vh — video intrinsic height
 * @returns {boolean}
 */
export function isEdgeDetection(points, roi, vw, vh) {
  if (!points || points.length < 2 || !roi || !vw || !vh || !roi.dw || !roi.dh) return false
  let sx = 0, sy = 0
  for (const p of points) { sx += p.x; sy += p.y }
  const cx = (sx / points.length / roi.dw) * roi.sw + roi.sx
  const cy = (sy / points.length / roi.dh) * roi.sh + roi.sy
  const mx = vw * 0.02, my = vh * 0.02
  return cx < mx || cx > vw - mx || cy < my || cy > vh - my
}

// ─── detectionBox ─────────────────────────────────────────────────────────────
/**
 * Map a detection's corner points to an aim-overlay box in CONTAINER css px.
 *
 * Pure geometry so it can be tested without a browser: two coordinate hops are
 * needed because the detector never sees the frame the operator sees.
 *
 *   1. detect-canvas px → video px — the crop `computeRoi` took is a scaled
 *      window, so divide by the downscaled size, multiply by the crop, add the
 *      crop offset (identical to `isEdgeDetection`).
 *   2. video px → css px — `<video>` renders with `object-fit: cover`, which
 *      scales by the LARGER of the two axes and centres the overflow, so
 *      anything derived from videoWidth must pass through that same transform
 *      or the box drifts off the barcode on non-matching aspect ratios.
 *
 * ZXing's 1D readers return only TWO points — the ends of the bar line — so the
 * raw bbox is a hairline. A 1px line is useless as a target, so the thin axis is
 * grown toward a barcode-ish ~3.2:1 ratio (and never below 48 css px) around the
 * original centre. The result is then clamped inside the container, because the
 * overlay is drawn as an absolutely-positioned sibling of the video.
 *
 * This box is FEEDBACK ONLY. It must never gate decoding — a null here just
 * means no rectangle this frame.
 *
 * @param {Array<{x:number,y:number}>} points — detect-canvas coordinates
 * @param {{sx:number,sy:number,sw:number,sh:number,dw:number,dh:number}} roi
 * @param {number} vw — video intrinsic width
 * @param {number} vh — video intrinsic height
 * @param {{width:number,height:number}} rect — the video's rendered CSS box
 *   (`getBoundingClientRect()`; only width/height are used, since the overlay is
 *   positioned relative to that same element)
 * @returns {{left:number,top:number,width:number,height:number}|null}
 */
export function detectionBox(points, roi, vw, vh, rect) {
  if (!Array.isArray(points) || points.length < 2) return null
  if (!roi || !roi.dw || !roi.dh || !roi.sw || !roi.sh) return null
  if (!vw || !vh) return null
  if (!rect || !rect.width || !rect.height) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const vx = (p.x / roi.dw) * roi.sw + roi.sx
    const vy = (p.y / roi.dh) * roi.sh + roi.sy
    if (vx < minX) minX = vx
    if (vy < minY) minY = vy
    if (vx > maxX) maxX = vx
    if (vy > maxY) maxY = vy
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

  // video px → css px under object-fit: cover
  const scale = Math.max(rect.width / vw, rect.height / vh)
  const offX = (rect.width - vw * scale) / 2
  const offY = (rect.height - vh * scale) / 2
  let width = Math.max(0, (maxX - minX) * scale)
  let height = Math.max(0, (maxY - minY) * scale)
  const cx = offX + ((minX + maxX) / 2) * scale
  const cy = offY + ((minY + maxY) / 2) * scale

  const MIN_CSS = 48
  let w = Math.max(width, MIN_CSS)
  let h = Math.max(height, MIN_CSS)
  if (w > h * 3.2) h = w / 3.2
  else if (h > w * 3.2) w = h / 3.2
  w = Math.min(w, rect.width)
  h = Math.min(h, rect.height)

  const left = Math.min(Math.max(0, cx - w / 2), Math.max(0, rect.width - w))
  const top = Math.min(Math.max(0, cy - h / 2), Math.max(0, rect.height - h))
  return { left, top, width: w, height: h }
}

// ─── waitForVideoReady ─────────────────────────────────────────────────────────
/**
 * Resolve once the <video> actually has frames to paint.
 *
 * Resolves rather than rejects on timeout: some devices never fire `loadeddata`
 * yet still composite the stream, and a rejected wait would strand the preview
 * on a black box — the exact failure this component is meant to eliminate.
 *
 * @param {HTMLVideoElement} video
 * @param {number} [ms]
 * @returns {Promise<{width:number, height:number, timedOut?:boolean}>}
 */
export function waitForVideoReady(video, ms = 4000) {
  return new Promise((resolve) => {
    if (!video) { resolve({ width: 0, height: 0, timedOut: true }); return }

    const detach = () => {
      clearTimeout(timer)
      video.removeEventListener?.('loadeddata', check)
      video.removeEventListener?.('loadedmetadata', check)
      video.removeEventListener?.('canplay', check)
    }

    const check = () => {
      if (video.readyState < 2 || !video.videoWidth) return false
      detach()
      resolve({ width: video.videoWidth, height: video.videoHeight })
      return true
    }

    const timer = setTimeout(() => {
      detach()
      resolve({ width: video.videoWidth || 0, height: video.videoHeight || 0, timedOut: true })
    }, ms)

    if (check()) return
    video.addEventListener?.('loadeddata', check)
    video.addEventListener?.('loadedmetadata', check)
    video.addEventListener?.('canplay', check)
  })
}

// ─── rotateGray ───────────────────────────────────────────────────────────────
/**
 * The three rotation angles worth trying on a missed frame, in order of cost.
 * 0° is the orientation the frame is already in and is never requested here.
 */
export const SCAN_ROTATIONS = [90, 180, 270]

/**
 * Rotate a 1-byte-per-pixel grayscale buffer by a multiple of 90°.
 *
 * WHY: ZXing's 1D readers sample horizontal scanlines only. A badge held
 * upright in a portrait photo — or simply turned 90° in the hand — has NO
 * horizontal scanline crossing its bars, so the decoder can never see it no
 * matter how sharp the frame is. Real cards are handed over rotated, so the
 * hard path re-tries the same pixels turned upright. A full geometric rotation
 * (rather than asking the decoder to try "upside-down scanning") is what keeps
 * `OneDReader`'s row-major assumption intact.
 *
 * Pure, allocation-light (one buffer), and a no-op for unsupported angles so a
 * caller never has to validate before using the result.
 *
 * @param {Uint8ClampedArray|Uint8Array} gray — width*height bytes
 * @param {number} width
 * @param {number} height
 * @param {number} deg — 90 | 180 | 270 (anything else returns the input shape)
 * @returns {{gray: Uint8ClampedArray, width: number, height: number}}
 */
export function rotateGray(gray, width, height, deg) {
  const empty = { gray: new Uint8ClampedArray(0), width: 0, height: 0 }
  if (!gray || !width || !height || gray.length < width * height) return empty

  const w = width, h = height
  const a = ((Math.trunc(deg) % 360) + 360) % 360

  if (a === 0) return { gray, width: w, height: h }
  if (a !== 90 && a !== 180 && a !== 270) return { gray, width: w, height: h }

  const swap = a !== 180
  const nw = swap ? h : w
  const nh = swap ? w : h
  const out = new Uint8ClampedArray(nw * nh)

  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let dx, dy
      if (a === 90) { dx = h - 1 - y; dy = x }
      else if (a === 180) { dx = w - 1 - x; dy = h - 1 - y }
      else { dx = y; dy = w - 1 - x }
      out[dy * nw + dx] = gray[row + x]
    }
  }
  return { gray: out, width: nw, height: nh }
}

// ─── sanitizeBarcode ──────────────────────────────────────────────────────────
/**
 * Normalise raw decoded text into the canonical badge form.
 *
 * WHY: decoders hand back exactly the bytes they saw, which routinely includes
 * Code 39's `*` start/stop guards, group separators from OCR-style symbologies,
 * stray spaces from print noise, and lower case. The badge contract
 * (`BADGE_REGEX` in badge.js) is uppercase alphanumerics only, so without this
 * step a perfectly good decode is thrown away and the operator sees "Invalid
 * badge format" for a badge that read fine.
 *
 * Deliberately does NOT touch leading zeros or strip digits — a badge's digit
 * sequence is identity and over-normalising here silently retypes someone as a
 * different sewadar.
 *
 * @param {string|null|undefined} raw
 * @returns {string} '' for empty/undefined
 */
export function sanitizeBarcode(raw) {
  if (raw == null) return ''
  // Uppercase, then drop everything that is not [A-Z0-9]: Code 39 guards,
  // separators, whitespace and any stray punctuation the print introduced.
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '')
}
