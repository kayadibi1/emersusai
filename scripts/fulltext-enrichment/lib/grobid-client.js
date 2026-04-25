// scripts/fulltext-enrichment/lib/grobid-client.js
//
// Minimal Grobid HTTP client. Grobid runs as a Docker container on Hetzner:
//   docker run -d --name grobid --rm -p 8070:8070 --memory=4g --cpus=4 lfoppiano/grobid:0.8.1
//
// Endpoints used:
//   GET  /api/version                        — health check
//   POST /api/processFulltextDocument        — multipart/form-data, returns TEI XML

const GROBID_BASE = process.env.GROBID_URL || "http://localhost:8070";

export async function grobidHealth() {
  try {
    const resp = await fetch(`${GROBID_BASE}/api/version`, { signal: AbortSignal.timeout(5_000) });
    return resp.ok;
  } catch { return false; }
}

export async function processPdf(pdfPath, { fs }) {
  // Use multipart/form-data. Node's fetch supports FormData + Blob.
  const buf = fs.readFileSync(pdfPath);
  const form = new FormData();
  form.append("input", new Blob([buf], { type: "application/pdf" }), pdfPath.split(/[\\/]/).pop());
  const resp = await fetch(`${GROBID_BASE}/api/processFulltextDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`grobid HTTP ${resp.status}`);
  return await resp.text();
}
