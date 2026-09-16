import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import type { Measurement, Profile } from "@workspace/domain"
import { Plus, Ruler, Scale, Trash2, X, Pencil } from "lucide-react"
import {
  headPercentile,
  weightForLengthPercentile,
  ageInDays,
  CM_PER_INCH,
  dateInTimezone,
  formatAge,
  formatDate,
  formatLength,
  formatWeight,
  kgToPounds,
  MAX_REFERENCE_DAYS,
  percentile,
  percentileLabel,
  poundsToKg,
  valueAtZ,
  zScore,
} from "../lib/growth"
import type { GrowthMetric } from "../lib/growth"
import GrowthModel from "./GrowthModel"
import "./growth.css"

type Props = {
  profile: Profile
  measurements: Measurement[]
  onSave: (measurement: Omit<Measurement, "id">) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onUpdate?: (id: string, measurement: Omit<Measurement, "id">) => Promise<void>
}

export default function Growth({
  profile,
  measurements,
  onSave,
  onDelete,
  onUpdate,
}: Props) {
  const [metric, setMetric] = useState<GrowthMetric>("weight")
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Measurement | null>(null)
  const [view, setView] = useState<"overview" | "model">("overview")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const sorted = [...measurements].sort((a, b) => b.date.localeCompare(a.date))
  const verified = sorted.filter((item) => !item.needsReview)
  const latestWeight = verified.find((item) => item.weightKg !== null)
  const latestHead = verified.find((item) => item.headCm != null)
  const latestPair = verified.find(
    (item) => item.weightKg !== null && item.lengthCm !== null
  )
  const headDays = latestHead
    ? ageInDays(profile.birthDate, latestHead.date)
    : null
  const headPct =
    latestHead?.headCm != null && headDays !== null
      ? headPercentile(profile.sex, headDays, latestHead.headCm)
      : null
  const pairDays = latestPair
    ? ageInDays(profile.birthDate, latestPair.date)
    : null
  const pairPct =
    latestPair?.lengthCm != null &&
    latestPair.weightKg != null &&
    pairDays !== null &&
    pairDays <= 730
      ? weightForLengthPercentile(
          profile.sex,
          latestPair.lengthCm,
          latestPair.weightKg
        )
      : null
  const latestLength = verified.find((item) => item.lengthCm !== null)
  const latest = metric === "weight" ? latestWeight : latestLength
  const selectedValue = latest
    ? metric === "weight"
      ? latest.weightKg
      : latest.lengthCm
    : null
  const days = latest ? ageInDays(profile.birthDate, latest.date) : null
  const z =
    days !== null && selectedValue !== null && selectedValue !== undefined
      ? zScore(metric, profile.sex, days, selectedValue)
      : null
  const projectionDay = days !== null ? days + 30 : null
  const projection =
    projectionDay !== null && z !== null && Math.abs(z) <= 3
      ? valueAtZ(metric, profile.sex, projectionDay, z)
      : null
  const previous = verified.find(
    (item) =>
      latest &&
      item.date < latest.date &&
      (metric === "weight" ? item.weightKg !== null : item.lengthCm !== null)
  )
  const previousValue = previous
    ? metric === "weight"
      ? previous.weightKg
      : previous.lengthCm
    : null
  const delta =
    selectedValue !== null &&
    selectedValue !== undefined &&
    previousValue !== null
      ? selectedValue - previousValue
      : null
  const elapsed =
    previous && latest ? ageInDays(previous.date, latest.date) : null

  function measurementPercentile(
    item: Measurement | undefined,
    kind: GrowthMetric
  ) {
    if (!item) return "No measurements yet"
    const age = ageInDays(profile.birthDate, item.date)
    const value = kind === "weight" ? item.weightKg : item.lengthCm
    if (age === null) return "Add birth date for percentile"
    if (age > MAX_REFERENCE_DAYS) return "Outside reference age range"
    return value !== null
      ? percentileLabel(percentile(kind, profile.sex, age, value))
      : "—"
  }

  async function remove(id: string) {
    setBusy(true)
    setError("")
    try {
      await onDelete(id)
      setDeleteId(null)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not delete measurement. Please try again."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="growth-page">
      <header className="growth-heading">
        <div>
          <p className="growth-eyebrow">LITTLE BY LITTLE</p>
          <h1>Growing every day</h1>
          <p>A little record of every big change.</p>
        </div>
        <button className="growth-primary" onClick={() => setShowForm(true)}>
          <Plus size={18} /> Add measurement
        </button>
      </header>
      {sorted.some((item) => item.needsReview) && (
        <div className="growth-notice">
          Flagged measurements remain in history and are excluded from
          summaries, curves, and illustrations until reviewed.
        </div>
      )}
      {!profile.birthDate && (
        <div className="growth-notice">
          Add {profile.name || "your baby"}’s birth date in their profile to see
          age-based percentiles and reference curves. You can save measurements
          now.
        </div>
      )}
      <nav className="growth-view-tabs" aria-label="Growth views">
        <button
          aria-pressed={view === "overview"}
          onClick={() => setView("overview")}
        >
          Overview
        </button>
        <button
          aria-pressed={view === "model"}
          onClick={() => setView("model")}
        >
          Model to 18
        </button>
        <a href="#measurement-history" onClick={() => setView("overview")}>
          Measurements
        </a>
      </nav>
      {view === "model" ? (
        <GrowthModel profile={profile} measurements={sorted} />
      ) : (
        <>
          <div className="growth-stats">
            <button
              className={`growth-stat ${metric === "weight" ? "selected" : ""}`}
              onClick={() => setMetric("weight")}
              aria-pressed={metric === "weight"}
            >
              <span className="growth-stat-label">
                <Scale size={19} /> Latest weight
              </span>
              <PercentileRing
                value={
                  latestWeight?.weightKg != null && profile.birthDate
                    ? percentile(
                        "weight",
                        profile.sex,
                        ageInDays(profile.birthDate, latestWeight.date) ?? -1,
                        latestWeight.weightKg
                      )
                    : null
                }
              />
              <strong>
                {latestWeight?.weightKg != null
                  ? formatWeight(latestWeight.weightKg)
                  : "—"}
              </strong>
              <span className="growth-stat-sub">
                {latestWeight?.weightKg != null
                  ? `${latestWeight.weightKg.toFixed(2)} kg · ${formatDate(latestWeight.date)}`
                  : "Start with a weight measurement"}
              </span>
              <span className="growth-percentile">
                {measurementPercentile(latestWeight, "weight")}
              </span>
            </button>
            <button
              className={`growth-stat ${metric === "length" ? "selected" : ""}`}
              onClick={() => setMetric("length")}
              aria-pressed={metric === "length"}
            >
              <span className="growth-stat-label">
                <Ruler size={19} /> Latest length
              </span>
              <PercentileRing
                value={
                  latestLength?.lengthCm != null && profile.birthDate
                    ? percentile(
                        "length",
                        profile.sex,
                        ageInDays(profile.birthDate, latestLength.date) ?? -1,
                        latestLength.lengthCm
                      )
                    : null
                }
              />
              <strong>
                {latestLength?.lengthCm != null
                  ? formatLength(latestLength.lengthCm)
                  : "—"}
              </strong>
              <span className="growth-stat-sub">
                {latestLength?.lengthCm != null
                  ? `${latestLength.lengthCm.toFixed(1)} cm · ${formatDate(latestLength.date)}`
                  : "Start with a length measurement"}
              </span>
              <span className="growth-percentile">
                {measurementPercentile(latestLength, "length")}
              </span>
            </button>
            <div className="growth-stat">
              <span className="growth-stat-label">Head circumference</span>
              <PercentileRing value={headPct} />
              <strong>
                {latestHead?.headCm != null
                  ? `${latestHead.headCm.toFixed(1)} cm`
                  : "—"}
              </strong>
              <span className="growth-stat-sub">
                {latestHead
                  ? formatDate(latestHead.date)
                  : "No measurements yet"}
              </span>
              <span className="growth-percentile">
                {percentileLabel(headPct)}
              </span>
            </div>
            <div className="growth-stat">
              <span className="growth-stat-label">Weight for length</span>
              <PercentileRing value={pairPct} />
              <strong>
                {pairPct !== null ? `${Math.round(pairPct)}%` : "—"}
              </strong>
              <span className="growth-stat-sub">
                {latestPair
                  ? formatDate(latestPair.date)
                  : "Weight & length on the same visit"}
              </span>
              <span className="growth-percentile">
                {percentileLabel(pairPct)}
              </span>
            </div>
          </div>
          <section className="growth-card">
            <div className="growth-section-head">
              <div>
                <h2>{metric === "weight" ? "Weight" : "Length"} over time</h2>
                <p>
                  Every dot is a moment in {profile.name || "your baby"}’s
                  story.
                </p>
              </div>
              <div className="growth-segment" aria-label="Growth chart metric">
                <button
                  aria-pressed={metric === "weight"}
                  onClick={() => setMetric("weight")}
                >
                  Weight
                </button>
                <button
                  aria-pressed={metric === "length"}
                  onClick={() => setMetric("length")}
                >
                  Length
                </button>
              </div>
            </div>
            <GrowthChart
              measurements={verified}
              profile={profile}
              metric={metric}
            />
            <div className="growth-chart-legend">
              <span>
                <i className="growth-dot" /> {profile.name || "Your baby"}
              </span>
              <span>
                <i className="growth-line" /> WHO 3rd, 50th & 97th percentiles
              </span>
            </div>
            <div className="growth-insights">
              <div>
                <span>Since the last measurement</span>
                <strong>
                  {delta !== null && elapsed !== null
                    ? `${delta >= 0 ? "+" : ""}${metric === "weight" ? (delta * 1000).toFixed(0) + " g" : delta.toFixed(1) + " cm"} in ${elapsed} days`
                    : "A story in the making"}
                </strong>
                <p>
                  {delta === null
                    ? "Add two measurements on different days to see the change."
                    : previous
                      ? `Compared with ${formatDate(previous.date)}.${elapsed && delta !== null ? ` Average ${metric === "weight" ? (delta / 0.028349523125 / elapsed).toFixed(2) + " oz/day" : ((delta / 2.54 / elapsed) * 7).toFixed(2) + " in/week"}.` : ""}`
                      : ""}
                </p>
              </div>
              <div>
                <span>30-day illustration</span>
                <strong>
                  {projection !== null
                    ? metric === "weight"
                      ? formatWeight(projection)
                      : formatLength(projection)
                    : "More context, with time"}
                </strong>
                <p>
                  {projection !== null
                    ? "30 days after the last record, if the same percentile continued. An illustration, not a prediction."
                    : "Available within the reference range after a measurement and birth date are added."}
                </p>
              </div>
            </div>
            <p className="growth-source">
              Reference: WHO Child Growth Standards,{" "}
              {profile.sex === "male" ? "boys" : "girls"}, birth–730 days.{" "}
              <a
                href={
                  metric === "weight"
                    ? "https://www.who.int/tools/child-growth-standards/standards/weight-for-age"
                    : "https://www.who.int/tools/child-growth-standards/standards/length-height-for-age"
                }
                target="_blank"
                rel="noreferrer"
              >
                About the curves
              </a>
              . Based on calendar age; no prematurity correction. Head and
              weight-for-length percentiles interpolate WHO LMS tables. Length
              is measured lying down. Growth patterns are best discussed with
              your pediatrician.
            </p>
          </section>
        </>
      )}
      <section className="growth-card" id="measurement-history">
        <div className="growth-section-head">
          <div>
            <h2>Measurement history</h2>
            <p>
              {sorted.length}{" "}
              {sorted.length === 1 ? "little milestone" : "little milestones"}{" "}
              recorded
            </p>
          </div>
        </div>
        {error && (
          <p role="alert" className="growth-error">
            {error}
          </p>
        )}
        {sorted.length === 0 ? (
          <div className="growth-empty">
            <Ruler size={30} />
            <h3>Big things start small</h3>
            <p>Add a weight or length to begin your baby’s growth story.</p>
            <button
              className="growth-primary"
              onClick={() => setShowForm(true)}
            >
              <Plus size={17} /> Add first measurement
            </button>
          </div>
        ) : (
          <div className="growth-history">
            {sorted.map((item) => (
              <div className="growth-history-row" key={item.id}>
                <div>
                  <strong>{formatDate(item.date)}</strong>
                  <span>
                    {item.needsReview ? "⚑ Needs review · " : ""}
                    {item.source ? `${item.source} · ` : ""}
                    {ageInDays(profile.birthDate, item.date) !== null
                      ? `${formatAge(ageInDays(profile.birthDate, item.date)!)} old`
                      : "Measurement"}
                  </span>
                </div>
                <div>
                  <strong>
                    {item.weightKg !== null ? formatWeight(item.weightKg) : "—"}
                  </strong>
                  <span>
                    {item.weightKg !== null
                      ? measurementPercentile(item, "weight")
                      : "No weight"}
                  </span>
                </div>
                <div>
                  <strong>
                    {item.lengthCm !== null ? formatLength(item.lengthCm) : "—"}
                  </strong>
                  <span>
                    {item.lengthCm !== null
                      ? measurementPercentile(item, "length")
                      : "No length"}
                  </span>
                  {item.headCm != null && (
                    <span>Head {item.headCm.toFixed(1)} cm</span>
                  )}
                </div>
                {deleteId === item.id ? (
                  <div className="growth-delete-confirm">
                    <button
                      disabled={busy}
                      onClick={() => void remove(item.id)}
                    >
                      Delete
                    </button>
                    <button disabled={busy} onClick={() => setDeleteId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="growth-row-actions">
                    {onUpdate && (
                      <button
                        className="growth-icon-button"
                        aria-label={`Edit measurement from ${formatDate(item.date)}`}
                        onClick={() => {
                          setEditing(item)
                          setShowForm(true)
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                    <button
                      className="growth-icon-button"
                      title="Delete measurement"
                      aria-label={`Delete measurement from ${formatDate(item.date)}`}
                      onClick={() => setDeleteId(item.id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                )}
                {item.note && (
                  <p className="growth-history-note">{item.note}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      {showForm && (
        <MeasurementForm
          profile={profile}
          initial={editing}
          onClose={() => {
            setShowForm(false)
            setEditing(null)
          }}
          onSave={async (value) => {
            if (editing && onUpdate) await onUpdate(editing.id, value)
            else await onSave(value)
            setShowForm(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function PercentileRing({ value }: { value: number | null }) {
  return (
    <svg
      className="growth-percentile-ring"
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle
        cx="32"
        cy="32"
        r="27"
        fill="none"
        stroke="#e8f1f6"
        strokeWidth="4"
      />
      <circle
        cx="32"
        cy="32"
        r="27"
        fill="none"
        stroke="#82adc5"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${((value ?? 0) / 100) * 169.65} 169.65`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" fill="#5f879e" fontSize="15">
        {value === null ? "—" : Math.round(value)}
      </text>
    </svg>
  )
}

function GrowthChart({
  measurements,
  profile,
  metric,
}: Pick<Props, "measurements" | "profile"> & { metric: GrowthMetric }) {
  const points = measurements
    .flatMap((item) => {
      const days = ageInDays(profile.birthDate, item.date)
      const value = metric === "weight" ? item.weightKg : item.lengthCm
      return days !== null && days <= MAX_REFERENCE_DAYS && value !== null
        ? [{ days, value, date: item.date, id: item.id }]
        : []
    })
    .sort((a, b) => a.days - b.days)
  if (!profile.birthDate || points.length === 0)
    return (
      <div className="growth-chart-empty">
        <div className="growth-empty-orbit">
          <Scale size={26} />
        </div>
        <h3>
          {!profile.birthDate
            ? "A birthday brings the picture together"
            : `Your first ${metric} starts the curve`}
        </h3>
        <p>
          {!profile.birthDate
            ? "Set a birth date in the profile to chart growth by age."
            : "Add a measurement from the first two years to see it alongside WHO reference curves."}
        </p>
      </div>
    )
  const minDay = Math.max(0, (points[0]?.days ?? 0) - 15)
  const maxDay = Math.min(
    MAX_REFERENCE_DAYS,
    Math.max(minDay + 60, (points.at(-1)?.days ?? 0) + 30)
  )
  const days = Array.from({ length: 65 }, (_, i) =>
    Math.round(minDay + ((maxDay - minDay) * i) / 64)
  )
  const curves = [-1.8807936, 0, 1.8807936].map((z) =>
    days.map((day) => ({
      days: day,
      value: valueAtZ(metric, profile.sex, day, z)!,
    }))
  )
  const band = [-0.67448975, 0.67448975].map((z) =>
    days.map((day) => ({
      days: day,
      value: valueAtZ(metric, profile.sex, day, z)!,
    }))
  )
  const allValues = [...points, ...curves.flat()].map((p) => p.value)
  const minValue = Math.max(
    0,
    Math.min(...allValues) - (metric === "weight" ? 0.4 : 2)
  )
  const maxValue = Math.max(...allValues) + (metric === "weight" ? 0.4 : 2)
  const x = (d: number) => 42 + ((d - minDay) / (maxDay - minDay)) * 568
  const y = (v: number) => 224 - ((v - minValue) / (maxValue - minValue)) * 196
  const path = (pts: { days: number; value: number }[]) =>
    pts
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${x(p.days).toFixed(2)},${y(p.value).toFixed(2)}`
      )
      .join(" ")
  return (
    <svg
      className="growth-chart"
      viewBox="0 0 670 268"
      role="img"
      aria-label={`${metric === "weight" ? "Weight in kilograms" : "Length in centimeters"} by age in days, with WHO percentile curves. Exact measurements are listed in the history below.`}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const v = minValue + ((maxValue - minValue) * i) / 4
        return (
          <g key={i}>
            <line
              x1="42"
              x2="610"
              y1={y(v)}
              y2={y(v)}
              className="growth-gridline"
            />
            <text x="32" y={y(v) + 4} textAnchor="end">
              {v.toFixed(metric === "weight" ? 1 : 0)}
            </text>
          </g>
        )
      })}
      <text x="42" y="14">
        {metric === "weight" ? "kg" : "cm"}
      </text>
      <path
        d={`${path(band[0]!)} ${path([...band[1]!].reverse()).replace(/^M/, "L")} Z`}
        fill="#eaf3f8"
        opacity="0.8"
      />
      {curves.map((curve, i) => (
        <g key={i}>
          <path d={path(curve)} className={`growth-reference curve-${i}`} />
          <text x="619" y={y(curve.at(-1)!.value) + 4}>
            {["3rd", "50th", "97th"][i]}
          </text>
        </g>
      ))}
      <path d={path(points)} className="growth-measured-line" />
      {points.map((point) => (
        <circle
          key={point.id}
          cx={x(point.days)}
          cy={y(point.value)}
          r="5"
          className="growth-measured-dot"
        >
          <title>
            {formatDate(point.date)}: {point.value.toFixed(2)}{" "}
            {metric === "weight" ? "kg" : "cm"}
          </title>
        </circle>
      ))}
      {[0, 1, 2, 3, 4].map((i) => {
        const d = Math.round(minDay + ((maxDay - minDay) * i) / 4)
        return (
          <text key={i} x={x(d)} y="247" textAnchor="middle">
            {d}d
          </text>
        )
      })}
      <text x="326" y="266" textAnchor="middle">
        Age in days
      </text>
    </svg>
  )
}

function MeasurementForm({
  profile,
  initial,
  onSave,
  onClose,
}: {
  profile: Profile
  initial: Measurement | null
  onSave: Props["onSave"]
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  const [date, setDate] = useState(
    () => initial?.date ?? dateInTimezone(profile.timezone)
  )
  const [weightUnit, setWeightUnit] = useState<"lb" | "kg">("lb")
  const [lengthUnit, setLengthUnit] = useState<"in" | "cm">("in")
  const [weight, setWeight] = useState(() =>
    initial?.weightKg != null ? String(kgToPounds(initial.weightKg).pounds) : ""
  )
  const [ounces, setOunces] = useState(() =>
    initial?.weightKg != null ? String(kgToPounds(initial.weightKg).ounces) : ""
  )
  const [length, setLength] = useState(() =>
    initial?.lengthCm != null ? (initial.lengthCm / CM_PER_INCH).toFixed(2) : ""
  )
  const [head, setHead] = useState(() =>
    initial?.headCm != null ? String(initial.headCm) : ""
  )
  const [source, setSource] = useState(initial?.source ?? "")
  const [note, setNote] = useState(initial?.note ?? "")
  const [needsReview, setNeedsReview] = useState(initial?.needsReview ?? false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const today = dateInTimezone(profile.timezone)
  function changeWeightUnit(next: "lb" | "kg") {
    if (weight !== "" || ounces !== "") {
      if (next === "kg") {
        setWeight(poundsToKg(Number(weight), Number(ounces)).toFixed(3))
        setOunces("")
      } else {
        const converted = kgToPounds(Number(weight))
        setWeight(String(converted.pounds))
        setOunces(String(converted.ounces))
      }
    }
    setWeightUnit(next)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    const hasWeight = weight !== "" || (weightUnit === "lb" && ounces !== "")
    let weightKg = hasWeight
      ? weightUnit === "kg"
        ? Number(weight)
        : poundsToKg(Number(weight), Number(ounces))
      : null
    let lengthCm =
      length !== ""
        ? Number(length) * (lengthUnit === "in" ? CM_PER_INCH : 1)
        : null
    if (
      initial?.weightKg != null &&
      weightUnit === "lb" &&
      weight === String(kgToPounds(initial.weightKg).pounds) &&
      ounces === String(kgToPounds(initial.weightKg).ounces)
    )
      weightKg = initial.weightKg
    if (
      initial?.lengthCm != null &&
      lengthUnit === "in" &&
      length === (initial.lengthCm / CM_PER_INCH).toFixed(2)
    )
      lengthCm = initial.lengthCm
    if (!hasWeight && lengthCm === null && head === "") {
      setError("Add a weight, length, or head circumference.")
      return
    }
    if (
      ageInDays("1900-01-01", date) === null ||
      date > today ||
      (profile.birthDate && date < profile.birthDate)
    ) {
      setError(
        "Choose a valid measurement date on or after birth and no later than today."
      )
      return
    }
    if (
      (weightKg !== null &&
        (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 50)) ||
      (lengthCm !== null &&
        (!Number.isFinite(lengthCm) || lengthCm < 20 || lengthCm > 150))
    ) {
      setError(
        "Check the measurement and units: weight must be above 0 and at most 50 kg; length must be 20–150 cm."
      )
      return
    }
    if (
      head !== "" &&
      (!Number.isFinite(Number(head)) ||
        Number(head) <= 0 ||
        Number(head) > 100)
    ) {
      setError("Check the head circumference in centimeters.")
      return
    }
    setBusy(true)
    try {
      await onSave({
        date,
        weightKg,
        lengthCm,
        headCm: head !== "" ? Number(head) : null,
        source,
        note,
        needsReview,
      })
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save measurement. Please try again."
      )
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialogRef}
      className="growth-modal"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      aria-labelledby="measurement-title"
    >
      <div className="growth-section-head">
        <div>
          <p className="growth-eyebrow">ANOTHER LITTLE MILESTONE</p>
          <h2 id="measurement-title">
            {initial ? "Edit measurement" : "Add a measurement"}
          </h2>
        </div>
        <button
          disabled={busy}
          className="growth-icon-button"
          aria-label="Close measurement form"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label className="growth-field">
          Measured on
          <input
            autoFocus
            type="date"
            required
            value={date}
            min={profile.birthDate ?? undefined}
            max={today}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <div className="growth-field">
          <div className="growth-field-heading">
            <label htmlFor="growth-weight">
              Weight <span>(optional)</span>
            </label>
            <select
              aria-label="Weight unit"
              value={weightUnit}
              onChange={(event) =>
                changeWeightUnit(event.target.value as "lb" | "kg")
              }
            >
              <option value="lb">lb & oz</option>
              <option value="kg">kg</option>
            </select>
          </div>
          <div className="growth-input-row">
            <label>
              <input
                id="growth-weight"
                type="number"
                min="0"
                step={weightUnit === "kg" ? "0.001" : "1"}
                placeholder="0"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
              />
              <span>{weightUnit}</span>
            </label>
            {weightUnit === "lb" && (
              <label>
                <input
                  aria-label="Weight ounces"
                  type="number"
                  min="0"
                  max="15.9"
                  step="0.1"
                  placeholder="0"
                  value={ounces}
                  onChange={(event) => setOunces(event.target.value)}
                />
                <span>oz</span>
              </label>
            )}
          </div>
        </div>
        <div className="growth-field">
          <div className="growth-field-heading">
            <label htmlFor="growth-length">
              Length <span>(optional)</span>
            </label>
            <select
              aria-label="Length unit"
              value={lengthUnit}
              onChange={(event) => {
                const next = event.target.value as "in" | "cm"
                if (length !== "")
                  setLength(
                    (
                      Number(length) *
                      (next === "cm" ? CM_PER_INCH : 1 / CM_PER_INCH)
                    ).toFixed(2)
                  )
                setLengthUnit(next)
              }}
            >
              <option value="in">inches</option>
              <option value="cm">cm</option>
            </select>
          </div>
          <div className="growth-input-row">
            <label>
              <input
                id="growth-length"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={length}
                onChange={(event) => setLength(event.target.value)}
              />
              <span>{lengthUnit}</span>
            </label>
          </div>
          <small>Measure length while your baby is lying down.</small>
        </div>
        <label className="growth-field">
          Head circumference in cm (optional)
          <input
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={head}
            onChange={(event) => setHead(event.target.value)}
            placeholder="e.g. 39.5"
          />
        </label>
        <label className="growth-field">
          Source (optional)
          <input
            maxLength={200}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="e.g. Pediatrician visit"
          />
        </label>
        <label className="growth-field">
          Note (optional)
          <textarea
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything to remember about this measurement"
          />
        </label>
        <label className="growth-review-check">
          <input
            type="checkbox"
            checked={needsReview}
            onChange={(event) => setNeedsReview(event.target.checked)}
          />{" "}
          Flag this measurement for review
        </label>
        {error && (
          <p role="alert" className="growth-error">
            {error}
          </p>
        )}
        <div className="growth-form-actions">
          <button
            type="button"
            className="growth-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="growth-primary" disabled={busy} type="submit">
            {busy ? "Saving…" : "Save measurement"}
          </button>
        </div>
      </form>
    </dialog>
  )
}
