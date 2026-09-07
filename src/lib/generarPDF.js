// Descarga un PDF a partir de HTML autocontenido (estilos inline/<style>,
// sin fuentes ni assets externos), vía el endpoint /api/pdf (Puppeteer +
// @sparticuz/chromium — ver api/pdf.js).
//
// Reemplaza el mecanismo viejo (window.print() sobre una ventana con el
// mismo HTML) en ReportesAutomaticos.jsx y Reportes.jsx. Si el endpoint
// falla (función caída, cold start que excede el timeout, etc.) cae a ese
// mismo mecanismo viejo como fallback — no queremos que un problema del
// endpoint le saque al admin la posibilidad de exportar un reporte.
export async function generarPDF(html, filename = 'reporte.pdf') {
  try {
    const res = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, filename }),
    })
    if (!res.ok) throw new Error('Error generando PDF')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('generarPDF, cayendo a window.print():', e)
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 600)
  }
}
