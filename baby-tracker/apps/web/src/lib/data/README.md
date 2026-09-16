# Growth references

Reference data retrieved 2026-09-16. These are reference distributions, not an individual growth forecast.

- `who-lms.json`: WHO Child Growth Standards expanded daily LMS tables for male/female weight-for-age (kg) and recumbent length-for-age (cm). Arrays contain `[L, M, S]` for exact calendar ages 0–730 days. Download URLs and original XLSX SHA-256 values are in `who-sources.json`.
- `growth-supplement.json`: WHO head circumference-for-age and weight-for-length tables distributed by CDC; and CDC 2000 weight-for-age/stature-for-age tables. Rows contain `[coordinate, L, M, S]`; the coordinate is months for head and CDC age tables, and cm for weight-for-length. URLs and source CSV SHA-256 values are in `supplement-sources.json`.

Regenerate from repository root with Python 3 and curl:

```sh
python3 scripts/update-growth-reference.py
python3 scripts/update-growth-supplement.py
```

The runtime uses exact daily WHO values for weight and length. It linearly interpolates LMS parameters for monthly head (age in days / 30.4375), weight-for-length, and CDC model ages. It never extrapolates outside reference bounds. Calendar age uses UTC date arithmetic, with no prematurity correction. WHO weight and length percentiles are presented only through day 730. Weight-for-length requires both measurements from the same record, and its WHO table covers 45–110 cm. Values flagged for review remain in history but are excluded from all summary and modeled calculations.

Percentiles use the LMS transform and standard normal CDF. Extreme percentiles are bounded in display as <0.1 or >99.9 rather than representing precision in distribution tails. The 30-day illustration holds the latest z-score constant, only for z-scores within ±3 and within reference bounds. The age-18 illustration smoothly interpolates z-scores from the latest unflagged infant measure toward user-selected target percentiles by the selected settling age. It uses WHO before age 2 and CDC thereafter; the standard change and length-to-standing-stature change can produce a small discontinuity. It is explicitly not an adult-size forecast or treatment goal. If there is no supported infant baseline, the model clearly states it starts at the WHO median.

Official explanations: [WHO weight](https://www.who.int/tools/child-growth-standards/standards/weight-for-age), [WHO length](https://www.who.int/tools/child-growth-standards/standards/length-height-for-age), [WHO data distributed by CDC](https://www.cdc.gov/growthcharts/who-data-files.htm), [CDC LMS data and formulas](https://www.cdc.gov/growthcharts/cdc-data-files.htm).
