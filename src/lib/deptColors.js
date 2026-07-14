const DEPT_COLORS = [
  '#217346', '#C0392B', '#2980B9', '#F39C12', '#8E44AD',
  '#16A085', '#D35400', '#2C3E50', '#27AE60', '#E74C3C',
  '#3498DB', '#F1C40F', '#9B59B6', '#1ABC9C', '#E67E22',
  '#34495E', '#2ECC71', '#F39C12', '#7F8C8D', '#2980B9'
]

const DEPT_ABBR = {
  'LANGAR': 'LNG',
  'KITCHEN': 'KTC',
  'SECURITY': 'SEC',
  'PARKING': 'PRK',
  'CATERING': 'CTR',
  'ADMINISTRATION': 'ADM',
  'PATHI': 'PTH',
  'SATSANG KARTA': 'SK',
  'BAAL SATSANG KARTA': 'BSK',
  'OFFICE': 'OFC',
  'AREA SECRETARY OFFICE': 'ASO',
  'MAINTENANCE': 'MTN',
  'TRANSPORT': 'TRN',
  'MEDICAL': 'MED',
  'ACCOMMODATION': 'ACC',
  'HALL MANAGEMENT': 'HMG',
  'STAGE': 'STG',
  'SOUND': 'SND',
  'LIGHT': 'LGT',
  'DECORATION': 'DEC',
  'GENERAL': 'GEN',
}

export function getDeptColor(dept) {
  if (!dept) return '#888'
  let h = 0
  for (let i = 0; i < dept.length; i++) h = ((h << 5) - h) + dept.charCodeAt(i)
  return DEPT_COLORS[Math.abs(h) % DEPT_COLORS.length]
}

export function getDeptAbbr(dept) {
  if (!dept) return 'GEN'
  const upper = dept.toUpperCase()
  if (DEPT_ABBR[upper]) return DEPT_ABBR[upper]
  return upper.slice(0, 3)
}

const JATHA_LABELS = {
  beas: 'BEAS',
  major_centre: 'Major Centre',
  jatha_home: 'Jatha Home',
  delhi: 'Delhi',
  amritsar: 'Amritsar',
  chandigarh: 'Chandigarh',
}

export function getCentreAbbr(name) {
  if (!name) return '—'
  const cleaned = name.replace(/[-\s].*$/, '').trim()
  return cleaned.slice(0, 4).toUpperCase()
}

export function getJathaLabel(type) {
  if (!type) return '—'
  const lower = type.toLowerCase().replace(/_/g, ' ')
  return JATHA_LABELS[type] || JATHA_LABELS[type.toLowerCase()] || lower.replace(/\b\w/g, c => c.toUpperCase())
}
