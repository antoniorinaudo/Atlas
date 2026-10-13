"""Prepare the official IGN district snapshot; no runtime calls to ANATI.

Polyline encoding preserves the coordinates returned by the service (6 decimals).
Only the display rings get additional generalization; counts use the detailed rings.
"""
import argparse
import datetime
import json
import math
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SERVICE = 'https://sigigntg.anati.gob.pa/arcgisserver/rest/services/Distrito/MapServer/0'
ATTRIBUTES = 'https://sigigntg.anati.gob.pa/arcgisserver/rest/services/Mapa_Web_Divisi%C3%B3n_Pol%C3%ADtica_Administrativa_2025a_MIL1/MapServer/7'
QUERY = '/query?where=uso%3D%27Tierra%27&outFields=cod_dist,nomb_dist,nomb_prov,uso&outSR=4326&returnGeometry=true&geometryPrecision=6&f=geojson'

def read(path, url):
    if path:
        return json.loads(pathlib.Path(path).read_text(encoding='utf-8-sig'))
    with urllib.request.urlopen(url, timeout=90) as response:
        return json.loads(response.read().decode('utf-8-sig'))

def encode(ring):
    result, previous = [], [0, 0]
    for point in ring:
        for axis in range(2):
            value = round(point[axis] * 1000000)
            delta = value - previous[axis]
            previous[axis] = value
            n = ~(delta << 1) if delta < 0 else delta << 1
            while n >= 32:
                result.append(chr((32 | (n & 31)) + 63))
                n >>= 5
            result.append(chr(n + 63))
    return ''.join(result)

def simplify(ring, tolerance=0.00035):
    keep = {0, len(ring) - 1}
    stack = [(0, len(ring) - 1)]
    while stack:
        start, end = stack.pop()
        a, b = ring[start], ring[end]
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = dx * dx + dy * dy
        far, at = tolerance * tolerance, None
        for i in range(start + 1, end):
            px, py = ring[i][0] - a[0], ring[i][1] - a[1]
            t = max(0, min(1, (px * dx + py * dy) / length)) if length else 0
            distance = (px - t * dx)**2 + (py - t * dy)**2
            if distance > far:
                far, at = distance, i
        if at is not None:
            keep.add(at)
            stack.extend([(start, at), (at, end)])
    result = [ring[i] for i in sorted(keep)]
    return result if len(result) >= 4 else ring

def inside(point, rings):
    result = False
    px, py = point
    for ring in rings:
        for a, b in zip(ring, ring[1:]):
            if (a[1] > py) != (b[1] > py) and px < (b[0]-a[0])*(py-a[1])/(b[1]-a[1])+a[0]:
                result = not result
    return result

def bounds(rings):
    points = [p for ring in rings for p in ring]
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]

def area(ring):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:])))

def label_point(polygons):
    rings = max(polygons, key=lambda p: area(p[0]))
    box = bounds(rings)
    center = [(box[0]+box[2])/2, (box[1]+box[3])/2]
    candidates = [center] + [[box[0]+(box[2]-box[0])*i/16, box[1]+(box[3]-box[1])*j/16] for i in range(1,16) for j in range(1,16)]
    edges = [(a,b) for ring in rings for a,b in zip(ring,ring[1:])]
    def clearance(p):
        best = math.inf
        for a,b in edges:
            dx,dy=b[0]-a[0],b[1]-a[1]
            t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))) if dx or dy else 0
            best=min(best,(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2)
        return best
    valid = [p for p in candidates if inside(p,rings)]
    point = max(valid,key=clearance) if valid else rings[0][0]
    return [round(v,6) for v in point]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--geometry-source')
    parser.add_argument('--attributes-source')
    args=parser.parse_args()
    source=read(args.geometry_source,SERVICE+QUERY)
    attrs=read(args.attributes_source,ATTRIBUTES+'/query?where=uso%3D%27Tierra%27&outFields=cod_dist,nomb_dist,nomb_prov,uso&returnGeometry=false&f=json')
    names={f['attributes']['cod_dist']:f['attributes'] for f in attrs['features']}
    features=[]
    for feature in source['features']:
        code=feature['properties']['cod_dist']
        name=names[code]
        geometry=feature['geometry']
        if not geometry or geometry['type'] not in ('Polygon','MultiPolygon'):
            raise ValueError('Missing district geometry: '+code)
        polygons=geometry['coordinates'] if geometry['type']=='MultiPolygon' else [geometry['coordinates']]
        display=[[simplify(r) for r in p] for p in polygons]
        if any(not math.isfinite(v) for p in polygons for r in p for pt in r for v in pt[:2]):
            raise ValueError('Invalid coordinates: '+code)
        features.append(dict(id=code,name=name['nomb_dist'],province=name['nomb_prov'],bounds=bounds([r for p in polygons for r in p]),label=label_point(display),polygons=[dict(bounds=bounds(p),rings=[encode(r) for r in p]) for p in polygons],display=[[encode(r) for r in p] for p in display]))
    if len(features)!=len(names) or len({f['id'] for f in features})!=len(features):
        raise ValueError('Incomplete district snapshot')
    result=dict(source='IGN Tommy Guardia / ANATI',edition='DPA 2025 · límites actualizados a 2024',source_url=SERVICE,geometry_query=SERVICE+QUERY,attributes_url=ATTRIBUTES,prepared_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),scale=1000000,geometry_tolerance_degrees=0,display_tolerance_degrees=0.00035,notes='Solo uso Tierra. Incluye unidades comarcales representadas a nivel distrital por el IGN; fuera de cobertura no se asigna el distrito más cercano.',districts=sorted(features,key=lambda f:f['id']))
    target=ROOT/'assets'/'distritos.json'
    target.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f'{len(features)} unidades terrestres; {target.stat().st_size:,} bytes')

if __name__=='__main__':
    main()
