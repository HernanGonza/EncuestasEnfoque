// Vercel Serverless Function — HTML → PDF con Puppeteer.
//
// Reemplaza el window.print() que usaban ReportesAutomaticos.jsx y
// Reportes.jsx: el cliente arma el mismo HTML autocontenido que antes
// (estilos inline/<style>, sin fuentes ni assets externos — imágenes van
// como data: URL), lo manda acá por POST y recibe el PDF ya renderizado.
//
// @sparticuz/chromium da el binario de Chromium para el entorno serverless
// (no entra en un Edge Function — por eso NO hay `export const runtime =
// 'edge'` acá) y puppeteer-core lo controla sin traer un Chromium propio
// (eso es lo que sería `puppeteer` a secas, mucho más pesado).
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { html, filename = 'reporte.pdf' } = req.body || {}
  if (!html) return res.status(400).json({ error: 'Falta "html" en el body' })

  let browser
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })

    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })

    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-size:9px;color:#999;width:100%;text-align:center;padding:0 15mm">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(pdf)
  } catch (e) {
    console.error('api/pdf:', e)
    res.status(500).json({ error: 'Error generando el PDF' })
  } finally {
    if (browser) await browser.close()
  }
}
