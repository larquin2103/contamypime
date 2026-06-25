// Graficos en SVG puro (sin librerias): donut de proporciones y area de
// tendencia. Pensados para modo oscuro y pantalla movil. Incluyen alternativa
// accesible (leyenda con valores) y respetan el tema de la app.

// --- Donut: proporcion parte-todo (p.ej. metodos de pago) ---
export function DonutChart({ segments, centerLabel, centerValue, size = 132 }) {
  const data = segments.filter((s) => s.value > 0)
  const total = data.reduce((a, s) => a + s.value, 0)
  // r + strokeWidth/2 debe caber dentro del radio del viewBox (60) o el anillo
  // se recorta en los bordes. Con stroke 16 (mitad 8) usamos r=50 -> borde 58.
  const r = 50
  const cx = 60
  const cy = 60
  const C = 2 * Math.PI * r
  const stroke = 16

  let offset = 0
  const arcs = data.map((s) => {
    const frac = total ? s.value / total : 0
    const len = frac * C
    const arc = (
      <circle
        key={s.label}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={s.color}
        strokeWidth={stroke}
        strokeDasharray={`${len} ${C - len}`}
        strokeDashoffset={-offset}
        strokeLinecap={frac > 0 && frac < 1 ? 'butt' : 'round'}
      />
    )
    offset += len
    return arc
  })

  return (
    <div className="donut" style={{ width: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} role="img"
           aria-label={`${centerLabel}: ${centerValue}`}>
        <g transform="rotate(-90 60 60)">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
          {total > 0 && arcs}
        </g>
        <text x="60" y="55" textAnchor="middle" className="donut__value">{centerValue}</text>
        <text x="60" y="72" textAnchor="middle" className="donut__label">{centerLabel}</text>
      </svg>
    </div>
  )
}

// --- Area de tendencia (ingresos por dia) ---
export function TrendChart({ points, color = '#1fa36b', height = 110 }) {
  const W = 320
  const H = height
  const pad = 8
  const vals = points.map((p) => p.total)
  const max = Math.max(1, ...vals)
  const n = points.length

  if (n === 0) return <p className="muted">Sin datos en el periodo.</p>

  const x = (i) => (n === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (n - 1))
  const y = (v) => H - pad - (v / max) * (H - pad * 2)

  const linePts = points.map((p, i) => `${x(i)},${y(p.total)}`)
  const linePath = `M ${linePts.join(' L ')}`
  const areaPath = `M ${x(0)},${H - pad} L ${linePts.join(' L ')} L ${x(n - 1)},${H - pad} Z`
  const last = points[n - 1]

  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
         role="img" aria-label="Tendencia de ingresos por dia">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#trendFill)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {n > 1 && <circle cx={x(n - 1)} cy={y(last.total)} r="3.5" fill={color} />}
    </svg>
  )
}
