"""Rebuild WHO head/weight-for-length and CDC age 2-18 reference data from CDC CSVs."""
import csv,io,json,subprocess,hashlib
from pathlib import Path
out={}; sources=[]
for metric, suffix in [('head','Head-Circumference-for-age'),('weightForLength','Weight-for-length')]:
 out[metric]={}
 for sex,label in [('male','Boys'),('female','Girls')]:
  url=f'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-{label}-{suffix}-Percentiles.csv'
  raw=subprocess.check_output(['curl','-fsSL',url]); rows=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
  out[metric][sex]=[[float(x) for x in r[:4]] for r in rows[1:] if r and r[0]]
  sources.append({'metric':metric,'sex':sex,'url':url,'sha256':hashlib.sha256(raw).hexdigest()})
for metric,file in [('weight','wtage'),('length','statage')]:
 url=f'https://www.cdc.gov/growthcharts/data/zscore/{file}.csv'
 raw=subprocess.check_output(['curl','-fsSL',url]); rows=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
 out[metric]={'male':[],'female':[]}
 for r in rows[1:]:
  if r and r[0] and float(r[1])<=216.5: out[metric]['male' if r[0].strip()=='1' else 'female'].append([float(x) for x in r[1:5]])
 sources.append({'metric':metric,'url':url,'sha256':hashlib.sha256(raw).hexdigest()})
Path('apps/web/src/lib/data/growth-supplement.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
Path('apps/web/src/lib/data/supplement-sources.json').write_text(json.dumps(sources,indent=2)+'\n')
