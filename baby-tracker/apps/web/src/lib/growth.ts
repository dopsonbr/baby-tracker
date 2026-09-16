import supplement from "./data/growth-supplement.json"
import reference from "./data/who-lms.json"

export type GrowthMetric = "weight" | "length"
export type GrowthSex = "male" | "female"
export const MAX_REFERENCE_DAYS = 730
export const KG_PER_LB = 0.45359237
export const CM_PER_INCH = 2.54
const DAY_MS = 86_400_000

/** Calendar dates are compared in UTC to avoid daylight-saving time errors. */
export function ageInDays(
  birthDate: string | null,
  date: string
): number | null {
  function parse(value: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const time = Date.parse(`${value}T00:00:00Z`)
    return Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 10) === value
      ? time
      : null
  }
  if (!birthDate) return null
  const birth = parse(birthDate)
  const current = parse(date)
  if (birth === null || current === null || current < birth) return null
  return Math.round((current - birth) / DAY_MS)
}

export function lmsAt(
  metric: GrowthMetric,
  sex: GrowthSex,
  days: number
): number[] | null {
  if (!Number.isInteger(days) || days < 0 || days > MAX_REFERENCE_DAYS)
    return null
  return reference[metric][sex][days] ?? null
}

export function zScore(
  metric: GrowthMetric,
  sex: GrowthSex,
  days: number,
  value: number
): number | null {
  const row = lmsAt(metric, sex, days)
  if (!row || !Number.isFinite(value) || value <= 0) return null
  const [l, m, s] = row as [number, number, number]
  return l === 0
    ? Math.log(value / m) / s
    : (Math.pow(value / m, l) - 1) / (l * s)
}

export function valueAtZ(
  metric: GrowthMetric,
  sex: GrowthSex,
  days: number,
  z: number
): number | null {
  const row = lmsAt(metric, sex, days)
  if (!row || !Number.isFinite(z)) return null
  const [l, m, s] = row as [number, number, number]
  if (l !== 0 && 1 + l * s * z <= 0) return null
  return l === 0 ? m * Math.exp(s * z) : m * Math.pow(1 + l * s * z, 1 / l)
}

/** Standard normal CDF (absolute approximation error < 8e-8). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const density = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)
  const tail =
    density *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z >= 0 ? 1 - tail : tail
}

export function percentile(
  metric: GrowthMetric,
  sex: GrowthSex,
  days: number,
  value: number
): number | null {
  const z = zScore(metric, sex, days, value)
  return z === null ? null : normalCdf(z) * 100
}

export function percentileLabel(value: number | null): string {
  if (value === null) return "—"
  if (value < 0.1) return "<0.1 percentile"
  if (value > 99.9) return ">99.9 percentile"
  return `${Number(value.toFixed(1))} percentile`
}

export function poundsToKg(pounds: number, ounces = 0): number {
  return (pounds + ounces / 16) * KG_PER_LB
}

export function kgToPounds(kg: number): { pounds: number; ounces: number } {
  const totalOunces = Math.round((kg / KG_PER_LB) * 16 * 10) / 10
  return {
    pounds: Math.floor(totalOunces / 16),
    ounces: Number((totalOunces % 16).toFixed(1)),
  }
}

export function formatWeight(kg: number): string {
  const { pounds, ounces } = kgToPounds(kg)
  return `${pounds} lb ${ounces} oz`
}

export function formatLength(cm: number): string {
  return `${(cm / CM_PER_INCH).toFixed(1)} in`
}

export function dateInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`))
}

export function formatAge(days: number): string {
  if (days < 14) return `${days} days`
  if (days < 90) return `${Math.floor(days / 7)} weeks`
  return `${Math.floor(days / 30.4375)} months`
}

/** Linear interpolation of the published LMS parameters, without extrapolation. */
export function interpolateLms(
  rows: number[][],
  coordinate: number
): number[] | null {
  if (
    !Number.isFinite(coordinate) ||
    !rows.length ||
    coordinate < rows[0]![0]! ||
    coordinate > rows.at(-1)![0]!
  )
    return null
  const hi = rows.findIndex((row) => row[0]! >= coordinate)
  if (hi < 0) return null
  const upper = rows[hi]!
  if (upper[0] === coordinate || hi === 0) return upper.slice(1)
  const lower = rows[hi - 1]!
  const fraction = (coordinate - lower[0]!) / (upper[0]! - lower[0]!)
  return lower
    .slice(1)
    .map((value, i) => value + fraction * (upper[i + 1]! - value))
}

export function percentileFromLms(
  row: number[] | null,
  value: number
): number | null {
  if (!row || !Number.isFinite(value) || value <= 0) return null
  const [l, m, s] = row as [number, number, number]
  return (
    100 *
    normalCdf(
      l === 0 ? Math.log(value / m) / s : (Math.pow(value / m, l) - 1) / (l * s)
    )
  )
}

export function inverseNormal(percent: number): number {
  let low = -6
  let high = 6
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2
    if (normalCdf(mid) * 100 < percent) low = mid
    else high = mid
  }
  return (low + high) / 2
}

export function headPercentile(
  sex: GrowthSex,
  days: number,
  headCm: number
): number | null {
  if (days < 0 || days > 730) return null
  return percentileFromLms(
    interpolateLms(supplement.head[sex], days / 30.4375),
    headCm
  )
}
export function weightForLengthPercentile(
  sex: GrowthSex,
  lengthCm: number,
  weightKg: number
): number | null {
  return percentileFromLms(
    interpolateLms(supplement.weightForLength[sex], lengthCm),
    weightKg
  )
}
/** Hypothetical percentile path. WHO to age 2; CDC standing stature after age 2. */
export function modelValue(
  metric: GrowthMetric,
  sex: GrowthSex,
  years: number,
  z: number
): number | null {
  if (years < 0 || years > 18 || !Number.isFinite(years) || !Number.isFinite(z))
    return null
  if (years < 2) return valueAtZ(metric, sex, Math.round(years * 365.25), z)
  const row = interpolateLms(supplement[metric][sex], years * 12)
  if (!row) return null
  const [l, m, s] = row as [number, number, number]
  if (l !== 0 && 1 + l * s * z <= 0) return null
  return l === 0 ? m * Math.exp(s * z) : m * (1 + l * s * z) ** (1 / l)
}
