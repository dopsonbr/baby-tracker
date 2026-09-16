import { describe, expect, it } from "vitest"
import {
  headPercentile,
  weightForLengthPercentile,
  modelValue,
  interpolateLms,
  inverseNormal,
  ageInDays,
  kgToPounds,
  lmsAt,
  normalCdf,
  percentile,
  poundsToKg,
  valueAtZ,
  zScore,
} from "./growth"

describe("WHO growth calculations", () => {
  it("uses exact daily reference values for both sexes", () => {
    expect(lmsAt("weight", "male", 0)).toEqual([0.3487, 3.3464, 0.14602])
    expect(lmsAt("length", "female", 0)).toEqual([1, 49.1477, 0.0379])
    expect(percentile("weight", "male", 0, 3.3464)).toBeCloseTo(50, 5)
    expect(percentile("length", "female", 0, 49.1477)).toBeCloseTo(50, 5)
  })
  it("matches published WHO newborn boys +2 SD weight (4.419 kg)", () => {
    expect(valueAtZ("weight", "male", 0, 2)).toBeCloseTo(4.419, 3)
    expect(percentile("weight", "male", 0, 4.419)).toBeCloseTo(97.725, 2)
  })
  it("round trips LMS values and handles out-of-range ages without clamping", () => {
    for (const metric of ["weight", "length"] as const) {
      for (const sex of ["male", "female"] as const) {
        for (const day of [0, 1, 30, 365, 730]) {
          const value = valueAtZ(metric, sex, day, -1.5)!
          expect(zScore(metric, sex, day, value)).toBeCloseTo(-1.5, 8)
        }
      }
    }
    expect(lmsAt("weight", "male", 731)).toBeNull()
    expect(lmsAt("weight", "male", -1)).toBeNull()
    expect(percentile("weight", "male", 10, 0)).toBeNull()
    expect(percentile("weight", "male", 10, NaN)).toBeNull()
  })
  it("calculates calendar age across leap days and DST and rejects invalid dates", () => {
    expect(ageInDays("2024-02-28", "2024-03-01")).toBe(2)
    expect(ageInDays("2026-03-07", "2026-03-09")).toBe(2)
    expect(ageInDays("2026-03-01", "2026-02-28")).toBeNull()
    expect(ageInDays("2026-02-30", "2026-03-01")).toBeNull()
    expect(ageInDays(null, "2026-03-01")).toBeNull()
  })
  it("uses exact mass conversion and normal distribution reference points", () => {
    expect(poundsToKg(8, 8)).toBeCloseTo(3.855535145, 8)
    expect(kgToPounds(poundsToKg(8, 8))).toEqual({ pounds: 8, ounces: 8 })
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4)
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 4)
  })
})

describe("supplementary WHO and CDC growth models", () => {
  it("uses WHO head and weight-for-length medians and respects source bounds", () => {
    expect(headPercentile("male", 0, 34.4618)).toBeCloseTo(50, 5)
    expect(weightForLengthPercentile("male", 45, 2.441)).toBeCloseTo(50, 5)
    expect(weightForLengthPercentile("male", 44, 2.441)).toBeNull()
    expect(headPercentile("male", 731, 48)).toBeNull()
  })
  it("interpolates LMS parameters without extrapolating missing reference data", () => {
    expect(
      interpolateLms(
        [
          [24, 1, 80, 0.04],
          [25, 1, 82, 0.05],
        ],
        24.5
      )
    ).toEqual([1, 81, 0.045])
    expect(interpolateLms([[24, 1, 80, 0.04]], 23)).toBeNull()
  })
  it("uses the CDC stature median at 24 months and bounds model ages", () => {
    expect(modelValue("length", "male", 2, 0)).toBeCloseTo(86.45220101, 8)
    expect(modelValue("weight", "male", 2, 0)).toBeCloseTo(12.6707633, 8)
    expect(modelValue("length", "male", 18, 0)).toBeGreaterThan(175)
    expect(modelValue("length", "male", 18.1, 0)).toBeNull()
    expect(modelValue("length", "male", -1, 0)).toBeNull()
  })
  it("maps target percentile sliders to matching z-scores", () => {
    expect(inverseNormal(50)).toBeCloseTo(0, 5)
    expect(inverseNormal(97.5)).toBeCloseTo(1.96, 3)
  })
})
