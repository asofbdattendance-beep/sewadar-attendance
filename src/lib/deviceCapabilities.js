/**
 * deviceCapabilities.js — scanner format lists ported from
 * sewadar-deployment-portal (src/lib/deviceCapabilities.js).
 *
 * Only the three format lists the detector-engine pool consumes are carried
 * over. Tier-budget/probe helpers live in the portal; this repo's scanner
 * keeps its own device profiles inside BarcodeScanner.jsx.
 *
 * Format lists are intentionally tiered: the hard path on a low tier reads
 * only the formats our badges actually use (Code 39/128/93/Codabar/EAN), while
 * mid/high tiers add ITF + UPC and, only on the hard path, the 2D symbologies —
 * because every extra symbology the decoder attempts costs frame time.
 */

/** The formats every tier always enables. These are the real badge symbologies. */
export const BASE_1D_FORMATS = ['code_39', 'code_128', 'code_93', 'codabar', 'ean_13', 'ean_8']

/** Added from `mid` up: wider 1D coverage, still cheap to attempt. */
export const EXTENDED_1D_FORMATS = ['itf', 'upc_a', 'upc_e']

/** Only ever attempted on the HARD path of a `high` tier device. */
export const HARD_PATH_2D_FORMATS = ['data_matrix', 'pdf417', 'qr_code']
