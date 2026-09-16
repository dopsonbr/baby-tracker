import { useState } from "react"
import type { Measurement, Profile } from "@workspace/domain"
import {
  ageInDays,
  CM_PER_INCH,
  inverseNormal,
  KG_PER_LB,
  modelValue,
  normalCdf,
  zScore,
} from "../lib/growth"
import type { GrowthMetric } from "../lib/growth"

export default function GrowthModel({
  profile,
  measurements,
}: {
  profile: Profile
  measurements: Measurement[]
}) {
  const [heightTarget, setHeightTarget] = useState(50)
  const [weightTarget, setWeightTarget] = useState(50)
  const [settlesBy, setSettlesBy] = useState(6)
  const [metric, setMetric] = useState<GrowthMetric>("length")
  const sorted = [...measurements]
    .filter((item) => !item.needsReview)
    .sort((a, b) => b.date.localeCompare(a.date))
  function startingPoint(kind: GrowthMetric) {
    const item = sorted.find(
      (m) => (kind === "weight" ? m.weightKg : m.lengthCm) !== null
    )
    const days = item ? ageInDays(profile.birthDate, item.date) : null
    const value = item
      ? kind === "weight"
        ? item.weightKg
        : item.lengthCm
      : null
    const z =
      days !== null && value !== null
        ? zScore(kind, profile.sex, days, value)
        : null
    return z !== null && Math.abs(z) <= 3 && days !== null
      ? { z, years: days / 365.25 }
      : null
  }
  const lengthStart = startingPoint("length")
  const weightStart = startingPoint("weight")
  const start = metric === "length" ? lengthStart : weightStart
  const target = metric === "length" ? heightTarget : weightTarget
  const adultLength = modelValue(
    "length",
    profile.sex,
    18,
    inverseNormal(heightTarget)
  )!
  const adultWeight = modelValue(
    "weight",
    profile.sex,
    18,
    inverseNormal(weightTarget)
  )!
  const totalInches = Math.round(adultLength / CM_PER_INCH)
  const minAge = start?.years ?? 0
  const points = Array.from({ length: 109 }, (_, i) => {
    const years = minAge + ((18 - minAge) * i) / 108
    const fraction = Math.max(
      0,
      Math.min(1, (years - minAge) / Math.max(0.01, settlesBy - minAge))
    )
    const eased = fraction * fraction * (3 - 2 * fraction)
    const z =
      (start?.z ?? 0) + (inverseNormal(target) - (start?.z ?? 0)) * eased
    return { years, value: modelValue(metric, profile.sex, years, z)! }
  })
  const maxValue = Math.max(
    metric === "length" ? 210 : 110,
    ...points.map((point) => point.value * 1.1)
  )
  const y = (value: number) => 218 - (value / maxValue) * 192
  const x = (years: number) => 40 + (years / 18) * 570
  const path = points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${x(p.years).toFixed(2)},${y(p.value).toFixed(2)}`
    )
    .join(" ")
  return (
    <section className="growth-card growth-model">
      <div className="growth-section-head">
        <div>
          <p className="growth-eyebrow">A WHAT-IF, NOT A FORECAST</p>
          <h2>Imagine the curve ahead</h2>
          <p>Explore how different percentile paths look through age 18.</p>
        </div>
      </div>
      <div className="growth-notice">
        Infant measurements cannot predict adult size. These sliders illustrate
        a chosen percentile path; they are not growth goals or medical advice.
      </div>
      {!start && (
        <p className="growth-model-missing">
          Add a birth date and an unflagged{" "}
          {metric === "length" ? "length" : "weight"} measurement within the
          infant reference range to anchor the curve. For now it starts at the
          WHO median.
        </p>
      )}
      <div className="growth-model-controls">
        <label>
          Height target percentile <strong>{heightTarget}%</strong>
          <input
            aria-label="Height target percentile"
            type="range"
            min="0.1"
            max="99.9"
            step="0.1"
            value={heightTarget}
            onChange={(e) => setHeightTarget(Number(e.target.value))}
          />
        </label>
        <label>
          Weight target percentile <strong>{weightTarget}%</strong>
          <input
            aria-label="Weight target percentile"
            type="range"
            min="0.1"
            max="99.9"
            step="0.1"
            value={weightTarget}
            onChange={(e) => setWeightTarget(Number(e.target.value))}
          />
        </label>
        <label>
          Curve settles by <strong>age {settlesBy}</strong>
          <input
            aria-label="Curve settles by age"
            type="range"
            min="2"
            max="18"
            value={settlesBy}
            onChange={(e) => setSettlesBy(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="growth-model-presets">
        <button
          className="growth-secondary"
          onClick={() => {
            setHeightTarget(
              Number((normalCdf(lengthStart?.z ?? 0) * 100).toFixed(1))
            )
            setWeightTarget(
              Number((normalCdf(weightStart?.z ?? 0) * 100).toFixed(1))
            )
          }}
        >
          Hold today’s curves
        </button>
        <button
          className="growth-secondary"
          onClick={() => {
            setHeightTarget(50)
            setWeightTarget(50)
            setSettlesBy(6)
          }}
        >
          Ease toward median
        </button>
      </div>
      <div className="growth-insights">
        <div>
          <span>Illustrative height at 18</span>
          <strong>
            {Math.floor(totalInches / 12)} ft {totalInches % 12} in{" "}
            <small>({adultLength.toFixed(1)} cm)</small>
          </strong>
          <p>{heightTarget} percentile target</p>
        </div>
        <div>
          <span>Illustrative weight at 18</span>
          <strong>
            {(adultWeight / KG_PER_LB).toFixed(0)} lb{" "}
            <small>({adultWeight.toFixed(1)} kg)</small>
          </strong>
          <p>{weightTarget} percentile target</p>
        </div>
      </div>
      <div className="growth-model-chart-head">
        <h3>{metric === "length" ? "Length → height" : "Weight"} pathway</h3>
        <div className="growth-segment">
          <button
            aria-pressed={metric === "length"}
            onClick={() => setMetric("length")}
          >
            Height
          </button>
          <button
            aria-pressed={metric === "weight"}
            onClick={() => setMetric("weight")}
          >
            Weight
          </button>
        </div>
      </div>
      <svg
        className="growth-chart"
        viewBox="0 0 650 265"
        role="img"
        aria-label={`Illustrative ${metric === "length" ? "height" : "weight"} curve to age 18; the endpoint is ${metric === "length" ? adultLength.toFixed(1) + " centimeters" : adultWeight.toFixed(1) + " kilograms"}`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1="40"
              x2="610"
              y1={y((maxValue * i) / 4)}
              y2={y((maxValue * i) / 4)}
              className="growth-gridline"
            />
            <text x="32" y={y((maxValue * i) / 4) + 4} textAnchor="end">
              {Math.round((maxValue * i) / 4)}
            </text>
          </g>
        ))}
        <line
          x1={x(2)}
          x2={x(2)}
          y1="20"
          y2="220"
          className="growth-reference"
        />
        <text x={x(2) + 5} y="18">
          WHO → CDC
        </text>
        <text x="40" y="13">
          {metric === "length" ? "cm" : "kg"}
        </text>
        <path d={path} className="growth-measured-line" strokeDasharray="5 3" />
        {[0, 2, 6, 10, 14, 18].map((age) => (
          <text key={age} x={x(age)} y="243" textAnchor="middle">
            {age}y
          </text>
        ))}
      </svg>
      <p className="growth-source">
        WHO infant reference before age 2;{" "}
        <a
          href="https://www.cdc.gov/growthcharts/cdc-data-files.htm"
          target="_blank"
          rel="noreferrer"
        >
          CDC 2000 sex-specific LMS reference
        </a>{" "}
        from ages 2–18, interpolated between published ages. The model eases
        z-scores toward your selected target. The reference change at age 2
        (recumbent length to standing stature) can create a small step.
        Measurements marked for review are excluded from this illustration.
      </p>
    </section>
  )
}
