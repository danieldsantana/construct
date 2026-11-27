import type { Pagina } from './lerNF';

// Texto posicionado de cada página do PDF, lido no navegador (pdf.js carregado só quando usado). O PDF não sai da máquina.
export async function paginasDoPdf(arquivo: File): Promise<Pagina[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) });
  const doc = await tarefa.promise;
  const out: Pagina[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out.push(tc.items.flatMap((i) => ('str' in i ? [{ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }] : [])));
  }
  await tarefa.destroy();
  return out;
}
