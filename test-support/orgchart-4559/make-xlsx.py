# Builds people.xlsx the way Excel lays one out (shared strings, workbook relationships), with
# synthetic names only. The people sheet is FIRST in the workbook but stored as sheet2.xml, so a
# reader that assumes sheet1.xml reads the wrong sheet. Managers are by NAME here (the CSV uses ids).
import zipfile
people = [("Avery Quill","Chief Executive",""),("Bo Linden","Head of Sales","Avery Quill"),
          ("Cass Orwell","Head of Product","avery quill"),("Dev Mariner","Head of Operations","Avery Quill"),
          ("Eli Tamsin","Account Executive","Bo Linden"),("Fen Ashby","Sales Engineer & Demos","Bo Linden"),
          ("Gus Pell","Office Manager","Dev Mariner")]
strings = []
def s(v):
    if v not in strings: strings.append(v)
    return strings.index(v)
def esc(v): return v.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
rows = ['<row r="1"><c r="A1" t="s"><v>%d</v></c><c r="B1" t="s"><v>%d</v></c><c r="C1" t="s"><v>%d</v></c></row>' % (s("Name"), s("Job Title"), s("Reports To"))]
for i,(n,t,m) in enumerate(people, start=2):
    cells = '<c r="A%d" t="s"><v>%d</v></c><c r="B%d" t="s"><v>%d</v></c>' % (i, s(n), i, s(t))
    if m: cells += '<c r="C%d" t="inlineStr"><is><t>%s</t></is></c>' % (i, esc(m))
    rows.append('<row r="%d">%s</row>' % (i, cells))
sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>%s</sheetData></worksheet>' % "".join(rows)
other = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Title</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Wrong sheet</t></is></c></row></sheetData></worksheet>'
sst = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="%d" uniqueCount="%d">%s</sst>' % (len(strings), len(strings), "".join('<si><t>%s</t></si>' % esc(v) for v in strings))
wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="People" sheetId="1" r:id="rId2"/><sheet name="Notes" sheetId="2" r:id="rId1"/></sheets></workbook>'
rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'
ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'
root = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
with zipfile.ZipFile("people.xlsx", "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in [("[Content_Types].xml", ct), ("_rels/.rels", root), ("xl/workbook.xml", wb), ("xl/_rels/workbook.xml.rels", rels),
                       ("xl/worksheets/sheet1.xml", other), ("xl/worksheets/sheet2.xml", sheet), ("xl/sharedStrings.xml", sst)]:
        z.writestr(name, data)
