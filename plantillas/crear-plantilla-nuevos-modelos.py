"""Crea plantilla-nuevos-modelos.xlsx (la que baja "Descargar plantilla" en Nuevos modelos).
Arriba de cada columna: si es obligatoria u opcional y para qué sirve, como la plantilla de Bsale.
Solo usa la biblioteca estándar de Python:  python3 plantillas/crear-plantilla-nuevos-modelos.py
"""
import zipfile, os
from xml.sax.saxutils import escape

SALIDA = os.path.join(os.path.dirname(__file__), "..", "plantilla-nuevos-modelos.xlsx")

# (encabezado, ancho, obligatorio, descripción)
COLUMNAS = [
    ("Tipo", 14, "Obligatorio",
     "Qué calzado es. Usa los mismos de la tienda: Zapatillas, Zapatos, Sandalias, Botines o Botas."),
    ("Nombre", 24, "Obligatorio",
     "Así se llamará el modelo en Shopify y en las etiquetas; escríbelo tal cual. Todas las filas del mismo modelo llevan exactamente el mismo nombre."),
    ("Marca", 13, "Opcional, pero recomendable",
     "La marca o el proveedor, en mayúsculas. Ej.: SHA, YOU, I-RUN."),
    ("Color", 15, "Obligatorio",
     "El color de esta fila. Si el modelo viene en varios colores, cada color va en sus propias filas."),
    ("Talla", 8, "Obligatorio",
     "Una sola talla por fila (ej. 37). Pon también las tallas que llegan sin stock."),
    ("Código de barras", 19, "Opcional",
     "Déjalo vacío y el sistema crea uno nuevo. Llénalo solo si la caja ya trae su propio código (puedes escanearlo aquí)."),
    ("SKU", 17, "Opcional",
     "Déjalo vacío y será igual al código de barras. Llénalo solo si el proveedor usa su propio código."),
    ("Stock", 9, "Opcional, pero recomendable",
     "Cuántos pares de esta talla y color llegaron. Vacío = 0. Se cargan en la tienda."),
    ("Costo (sin IGV)", 15, "Opcional, pero recomendable",
     "Lo que costó un par, sin IGV. Ej.: si costó S/ 70.00 con IGV, escribe 59.32."),
    ("Precio", 11, "Obligatorio",
     "Precio de venta de un par, con IGV, como se cobra al cliente. Ej.: 69.90."),
]
EJEMPLOS = [
    ["Zapatillas", "Ejemplo Modelo", "SHA", "Negro", 35, "", "", 2, 38, 69.9],
    ["Zapatillas", "Ejemplo Modelo", "SHA", "Negro", 36, "", "", 3, 38, 69.9],
    ["Zapatillas", "Ejemplo Modelo", "SHA", "Blanco", 35, "", "", "", 38, 69.9],
]
TITULO = "Nuevos modelos para Shopify (ZAZI)"
INSTRUCCIONES = ("Instrucciones: una fila por cada color y talla de un modelo. Llena desde la fila 7, debajo de los nombres "
                 "de las columnas. Los modelos que ya existen en Shopify no se crean (su stock se agrega por otro lado).")
AVISO = "Las filas cuyo nombre empieza con \"Ejemplo\" no se cargan. Puedes borrarlas o escribir encima."
N = len(COLUMNAS)
L = [chr(65 + i) for i in range(N)]             # A..J

# Estilos: 0 normal, 1 título, 2 instrucciones, 3 aviso, 4 obligatorio, 5 opcional, 6 descripción, 7 encabezado, 8 ejemplo, 9 ejemplo con 2 decimales
ESTILOS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="15"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FFB3261E"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><i/><sz val="11"/><color rgb="FF8A8A8A"/><name val="Calibri"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF9D6D3"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF7F7F7"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF000000"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFCFCFCF"/></left><right style="thin"><color rgb="FFCFCFCF"/></right><top style="thin"><color rgb="FFCFCFCF"/></top><bottom style="thin"><color rgb="FFCFCFCF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>"""

def celda(ref, valor, estilo):
    if valor == "" or valor is None:
        return f'<c r="{ref}" s="{estilo}"/>'
    if isinstance(valor, (int, float)):
        return f'<c r="{ref}" s="{estilo}"><v>{valor}</v></c>'
    return f'<c r="{ref}" s="{estilo}" t="inlineStr"><is><t xml:space="preserve">{escape(valor)}</t></is></c>'

filas = []
def fila(n, celdas, alto=None):
    a = f' ht="{alto}" customHeight="1"' if alto else ""
    filas.append(f'<row r="{n}"{a}>' + "".join(celdas) + "</row>")

fila(1, [celda("A1", TITULO, 1)], 24)
fila(2, [celda("A2", INSTRUCCIONES, 2)], 32)
fila(3, [celda("A3", AVISO, 3)])
fila(4, [celda(f"{L[i]}4", c[2], 4 if c[2] == "Obligatorio" else 5) for i, c in enumerate(COLUMNAS)], 30)
fila(5, [celda(f"{L[i]}5", c[3], 6) for i, c in enumerate(COLUMNAS)], 112)
fila(6, [celda(f"{L[i]}6", c[0], 7) for i, c in enumerate(COLUMNAS)], 20)
for j, e in enumerate(EJEMPLOS):
    n = 7 + j
    fila(n, [celda(f"{L[i]}{n}", v, 9 if i in (8, 9) and v != "" else 8) for i, v in enumerate(e)])

hoja = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A10" sqref="A10"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>{"".join(f'<col min="{i+1}" max="{i+1}" width="{c[1]}" customWidth="1"/>' for i, c in enumerate(COLUMNAS))}</cols>
<sheetData>{"".join(filas)}</sheetData>
<mergeCells count="3"><mergeCell ref="A1:{L[-1]}1"/><mergeCell ref="A2:{L[-1]}2"/><mergeCell ref="A3:{L[-1]}3"/></mergeCells>
<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
</worksheet>"""

ARCHIVOS = {
    "[Content_Types].xml": """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>""",
    "_rels/.rels": """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>""",
    "xl/workbook.xml": """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Nuevos modelos" sheetId="1" r:id="rId1"/></sheets>
</workbook>""",
    "xl/_rels/workbook.xml.rels": """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>""",
    "xl/styles.xml": ESTILOS,
    "xl/worksheets/sheet1.xml": hoja,
}
with zipfile.ZipFile(SALIDA, "w", zipfile.ZIP_DEFLATED) as z:
    for nombre, contenido in ARCHIVOS.items():
        z.writestr(nombre, contenido)
print("Creado:", os.path.normpath(SALIDA))
