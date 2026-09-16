"""Download authoritative WHO daily LMS tables. Run from the repository root.
No third-party Python dependencies. Output retains birth through 730 days;
length data after this boundary switches from recumbent length to height.
"""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
import zipfile

BASE = 'https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/'
SOURCES = {
    'weight': ('weight-for-age/expanded-tables/wfa', {'male': ('boys','65cce121_10'), 'female': ('girls','f01bc813_10')}),
    'length': ('length-height-for-age/expandable-tables/lhfa', {'male': ('boys','7b4a3428_12'), 'female': ('girls','27f1e2cb_10')}),
}
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
data = {}
provenance = []
for metric, (path, sexes) in SOURCES.items():
    data[metric] = {}
    for sex, (label, revision) in sexes.items():
        url = f'{BASE}{path}-{label}-zscore-expanded-tables.xlsx?sfvrsn={revision}'
        raw = subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '-L', '-A', 'Mozilla/5.0', url])
        archive = zipfile.ZipFile(io.BytesIO(raw))
        rows = ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('s:sheetData/s:row', ns)
        values = []
        for row in rows[1:]:
            cells = {c.attrib['r'].rstrip('0123456789'): c.find('s:v',ns) for c in row}
            day = int(float(cells['A'].text))
            if day > 730:
                break
            assert day == len(values), (metric, sex, day)
            values.append([round(float(cells[key].text), 8) for key in ('B','C','D')])
        assert len(values) == 731
        data[metric][sex] = values
        provenance.append({'metric':metric,'sex':sex,'url':url,'sha256':hashlib.sha256(raw).hexdigest()})
Path('apps/web/src/lib/data/who-lms.json').write_text(json.dumps(data, separators=(',',':'))+'\n')
Path('apps/web/src/lib/data/who-sources.json').write_text(json.dumps(provenance, indent=2)+'\n')
print('Saved 2,924 daily WHO LMS reference rows (birth through 730 days).')
