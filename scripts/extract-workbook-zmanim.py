"""Extract the shared zmanim definitions, never the two chart templates.

Usage: python scripts/extract-workbook-zmanim.py '/path/to/workbook.xlsx'
The original file stays outside the site; the formula fixture is reproducible from it.
"""
import hashlib
import json
import pathlib
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'Lakewood Commons Zmanim tables.xlsx'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
ROOTS = ['SUNRISE', 'SUNSET', 'SUNRISE_elev', 'SUNSET_elev', 'SOLAR_NOON',
         'ALOS_16.1', 'MISHEYAKIR_10.2', 'ALOS_72', 'TZAIS_16.1', 'TZAIS_GEONIM_8.5',
         'TZAIS_50', 'TZAIS_60', 'TZAIS_72', 'MINCHA_GEDOLA', 'MINCHA_GEDOLA_LECHUMRA',
         'MINCHA_GEDOLA_16.1', 'MINCHA_GEDOLA_30_MINUTES_AFTER_CHATZOS', 'MINCHA_KETANA',
         'SAMUCH_LEMINCHA_KETANA', 'PLAG_HAMINCHA', '__PLAG_HAMINCHA',
         'SOF_ZMAN_SHMA_GRA', 'SOF_ZMAN_SHMA_MGA_72', 'SOF_ZMAN_TFILA_GRA', 'calcDST_LOCAL']

with zipfile.ZipFile(SOURCE) as book:
    workbook = ET.fromstring(book.read('xl/workbook.xml'))
    names = {x.attrib['name']: x.text for x in workbook.find('s:definedNames', NS)}
    shared = [''.join(x.itertext()) for x in ET.fromstring(book.read('xl/sharedStrings.xml'))]
    relationships = {x.attrib['Id']: x.attrib['Target'] for x in ET.fromstring(book.read('xl/_rels/workbook.xml.rels'))}
    targets = {x.attrib['name']: relationships[x.attrib[REL]] for x in workbook.find('s:sheets', NS)}
    sheets = {name: (target.lstrip('/') if target.startswith('/') else 'xl/' + target)
              for name, target in targets.items()}

    def cells(sheet):
        result = {}
        for c in ET.fromstring(book.read(sheets[sheet])).findall('.//s:c', NS):
            v = c.find('s:v', NS)
            if v is None or v.text is None:
                continue
            value = v.text
            kind = c.attrib.get('t')
            if kind == 's':
                value = shared[int(value)]
            elif kind == 'b':
                value = value == '1'
            elif kind not in ['str', 'e']:
                value = float(value)
            result[c.attrib['r']] = value
        return result

    selected = set()
    def visit(name):
        if name in selected or name.startswith('const'):
            return
        selected.add(name)
        for other in names:
            if re.search(r'(?<![\w.])' + re.escape(other) + r'(?![\w.])', names[name]):
                visit(other)
    for name in ROOTS:
        visit(name)

    settings = cells('SETTINGS')
    settings_cells = {'latitude': 'C3', 'longitude': 'C5', 'elevation': 'C7', 'timezoneId': 'C9',
                      'language': 'C11', 'inIsrael': 'G4', 'candleLightingMinutes': 'G7',
                      'useAstronomicalChatzos': 'G13', 'useElevation': 'G16', 'horizon': 'G19',
                      'ateretTorahTzaisOffset': 'G21', 'useGregorianBefore1582': 'G23'}
    zones = cells('time zones')
    timezone = []
    for row in range(3, 511):
        if f'B{row}' in zones:
            timezone.append({key: zones.get(f'{col}{row}', 0)
                             for key, col in [('ZONE', 'B'), ('UTC', 'C'), ('DST', 'D'), ('RULE', 'E')]})
    functions = cells('FUNCTIONS')
    locations = {functions[f'B{row}']: f'FUNCTIONS!C{row}' for row in range(1, 344)
                 if f'B{row}' in functions and functions[f'B{row}'] in selected}
    result = {'source': SOURCE.name, 'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
              'scope': 'FUNCTIONS, workbook defined names, SETTINGS and the time zones table. Chart templates excluded.',
              'settings': {key: {'cell': 'SETTINGS!' + cell, 'value': settings[cell]}
                           for key, cell in settings_cells.items()},
              'functionsCells': dict(sorted(locations.items())),
              'definedNames': {name: names[name] for name in sorted(selected)},
              'timezones': timezone}
    target = ROOT / 'fixtures/workbook-zmanim.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f'Extracted {len(selected)} named definitions and {len(timezone)} time zones to {target}')
