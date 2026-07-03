const DEPT_COLORS = [
  '#217346', '#C0392B', '#2980B9', '#F39C12', '#8E44AD',
  '#16A085', '#D35400', '#2C3E50', '#27AE60', '#E74C3C',
  '#3498DB', '#F1C40F', '#9B59B6', '#1ABC9C', '#E67E22',
  '#34495E', '#2ECC71', '#F39C12', '#7F8C8D', '#2980B9'
]

export function getDeptColor(dept) {
  let h = 0
  for (let i = 0; i < (dept || '').length; i++) h = ((h << 5) - h) + dept.charCodeAt(i)
  return DEPT_COLORS[Math.abs(h) % DEPT_COLORS.length]
}
