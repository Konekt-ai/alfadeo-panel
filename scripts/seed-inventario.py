#!/usr/bin/env python3
"""
Seed de inventario desde PDF mensual de ALFA-DEO.
Uso: python3 scripts/seed-inventario.py <ruta-al-pdf>

Requiere variables de entorno SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY,
o un archivo .env.local en la raíz del proyecto.
"""
import sys
import os
import re
from pathlib import Path

# Cargar .env.local si existe
env_path = Path(__file__).parent.parent / '.env.local'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

try:
    import pdfplumber
except ImportError:
    print("ERROR: instala pdfplumber → pip install pdfplumber")
    sys.exit(1)

try:
    from supabase import create_client
except ImportError:
    print("ERROR: instala supabase → pip install supabase")
    sys.exit(1)

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else None
if not PDF_PATH:
    print("Uso: python3 scripts/seed-inventario.py <ruta-al-pdf>")
    sys.exit(1)

MESES = {
    'ene': '01', 'feb': '02', 'mar': '03', 'abr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'ago': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dic': '12',
}

UBI_PAT = r'(RACK N[1-6]|LOCKER N[1-4]|REFRIGERADO|TARIMA|ÁREA? NO CONFORME)'
CAD_PAT = r'(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)-(\d{2})'

# Palabras que inician nombre genérico (no son marca comercial)
NO_MARCA = {
    'ACIDO', 'AGUA', 'ALBUMINA', 'AMOXICILINA', 'ANASTROZOL', 'BENZONATATO',
    'CALCITRIOL', 'CAPECITABINA', 'CARBAMAZEPINA', 'CIPROFLOXACINO', 'CLONAZEPAM',
    'DEXAMETASONA', 'DOCETAXEL', 'ERITROPOYETINA', 'FILGRASTIM', 'GEMCITABINA',
    'HEPARINA', 'INSULINA', 'IRINOTECAN', 'LACOSAMIDA', 'METOTREXATO',
    'OMEPRAZOL', 'ONDANSETRON', 'OXALIPLATINO', 'PACLITAXEL', 'PANTOPRAZOL',
    'RITUXIMAB', 'SULFATO', 'TAMOXIFENO', 'TRASTUZUMAB', 'VALSARTAN', 'VINCRISTINA',
    'VINBLASTINA', 'VORICONAZOL', 'VENETOCLAX',
}


def parse_pdf(path: str) -> list[dict]:
    with pdfplumber.open(path) as pdf:
        lines = [
            l.strip()
            for page in pdf.pages
            for l in page.extract_text().splitlines()
            if l.strip()
        ]

    skip = {'EXISTENCIAS EN ALMACEN', 'POR ORDEN ALFABETICO'}
    products = []

    for line in lines:
        if not line or line in skip or line.startswith('Fecha:') or line.startswith('MARCA'):
            continue

        ubi_m = re.search(UBI_PAT, line, re.IGNORECASE)
        if not ubi_m:
            continue
        ubicacion = ubi_m.group(1).upper().strip()
        before_ubi = line[:ubi_m.start()].strip()

        parts = before_ubi.rsplit(None, 1)
        if len(parts) < 2 or not parts[-1].isdigit():
            continue
        piezas = int(parts[-1])
        before_piezas = parts[0].strip()

        cad_m = re.search(CAD_PAT, before_piezas, re.IGNORECASE)
        if not cad_m:
            continue
        mes = MESES[cad_m.group(1).lower()]
        caducidad = f'20{cad_m.group(2)}-{mes}-01'
        before_cad = before_piezas[:cad_m.start()].strip()

        parts2 = before_cad.rsplit(None, 1)
        if len(parts2) < 2:
            continue
        lote = parts2[-1]

        parts3 = parts2[0].strip().rsplit(None, 1)
        if len(parts3) < 2:
            continue
        laboratorio = parts3[-1]
        resto = parts3[0].strip()

        first_word = resto.split()[0] if resto.split() else ''
        if first_word.isupper() and first_word not in NO_MARCA and len(first_word) > 2:
            marca = first_word
            nombre = ' '.join(resto.split()[1:])
        else:
            marca = None
            nombre = resto

        products.append({
            'nombre': nombre,
            'laboratorio': laboratorio,
            'lote': lote,
            'caducidad': caducidad,
            'activo': True,
            # campos que van a inventario
            '_existencia': piezas,
            '_ubicacion': ubicacion,
            '_marca': marca,
        })

    return products


def main():
    print(f"Parseando {PDF_PATH}...")
    products = parse_pdf(PDF_PATH)
    print(f"  {len(products)} productos encontrados.")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    insertados = 0
    errores = 0

    for p in products:
        existencia = p.pop('_existencia')
        ubicacion_nombre = p.pop('_ubicacion')
        marca = p.pop('_marca')

        # Insertar producto
        prod_data = {k: v for k, v in p.items()}
        if marca:
            prod_data['nombre'] = f"{marca} - {prod_data['nombre']}"

        res = sb.table('productos').insert(prod_data).execute()
        if not res.data:
            print(f"  ERROR insertando producto: {p['nombre']}")
            errores += 1
            continue

        producto_id = res.data[0]['id']

        sb.table('inventario').insert({
            'producto_id': producto_id,
            'existencia': existencia,
            'ubicacion': ubicacion_nombre,
        }).execute()

        insertados += 1

    print(f"\nListo: {insertados} insertados, {errores} errores.")


if __name__ == '__main__':
    main()
