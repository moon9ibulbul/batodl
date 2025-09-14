import { NextResponse } from 'next/server';
import { store } from '@/app/api/_store';

export const runtime = 'nodejs';

function newId() { return Math.random().toString(36).slice(2, 10); }

export async function POST(req: Request) {
  const body = await req.json();
  const jobId = newId();
  store.set(jobId, { stage: 'Queued', percent: 0 });
  process(jobId, body).catch((e) => {
    const s = store.get(jobId);
    if (s) { s.stage = 'Error'; (s as any).error = String(e); store.set(jobId, s); }
  });
  return NextResponse.json({ jobId });
}

async function findSeamY(buf: Buffer, targetCut: number, windowPx: number): Promise<number> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buf).metadata();
  const W = meta.width || 0, H = meta.height || 0;
  if (W === 0 || H === 0) return Math.min(Math.max(10, targetCut), Math.max(10, H-10));
  const scaleW = 360;
  const scale = scaleW / W;
  const rH = Math.max(20, Math.round(H * scale));
  const s = sharp(buf).rotate().ensureAlpha().grayscale().resize({ width: scaleW, height: rH });
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const t = clamp(Math.round(targetCut * scale), 5, h - 6);
  const win = Math.max(10, Math.round(windowPx * scale));
  const a = clamp(t - win, 5, h - 6);
  const b = clamp(t + win, 5, h - 6);
  let bestRow = t, bestScore = Number.POSITIVE_INFINITY;
  for (let y = a; y <= b; y++) {
    let edge = 0;
    const y0 = y * w, y1 = (y + 1) * w;
    for (let x = 0; x < w; x++) edge += Math.abs(data[y0 + x] - data[y1 + x]);
    if (edge < bestScore) { bestScore = edge; bestRow = y; }
  }
  const seam = Math.round(bestRow / scale);
  return Math.min(Math.max(10, seam), Math.max(10, H - 10));
}

async function process(jobId: string, opts: any) {
  const set = (stage: string, percent: number) => {
    store.set(jobId, { ...(store.get(jobId) || { stage: '' , percent: 0 }), stage, percent });
  };

  const { ids, stitch, rawOnly, smartSeam, splitHeight, outType, widthEnforce, customWidth, lowRam, unitImages } = opts || {};
  const idsArr = String(ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!idsArr.length) throw new Error('No IDs provided');
  set('Fetching chapters…', 5);

  const chapters: { id: string; urls: string[] }[] = [];
  for (let i = 0; i < idsArr.length; i++) {
    const id = idsArr[i];
    const url = `https://bato.to/chapter/${id}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': url } });
    if (!res.ok) throw new Error(`Failed to fetch ${url}`);
    const html = await res.text();
    const m = html.match(/const\s+imgHttps\s*=\s*(\[[\s\S]*?\])\s*;/i);
    const arr = m ? JSON.parse(m[1]) : [];
    const imgs = Array.isArray(arr) ? arr.filter((x: any) => typeof x === 'string' && x.trim()).map((s: string) => s.trim()) : [];
    chapters.push({ id, urls: imgs });
    set(`Fetched ${i+1}/${idsArr.length} chapter(s)…`, Math.min(15 + Math.floor(((i+1)/idsArr.length)*20), 35));
  }

  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const fs = await import('node:fs/promises');
  const sharp = (await import('sharp')).default;

  const jobDir = join(tmpdir(), `bato-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });

  let totalImages = chapters.reduce((acc, c) => acc + c.urls.length, 0);
  let doneImages = 0;

  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci];
    const chDir = join(jobDir, ch.id);
    await fs.mkdir(chDir, { recursive: true });

    // Download images
    for (let i = 0; i < ch.urls.length; i++) {
      const u = ch.urls[i];
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': `https://bato.to/chapter/${ch.id}` } });
      if (!res.ok) throw new Error(`Failed to download image: ${u}`);
      const ab = await res.arrayBuffer();
      const b = Buffer.from(ab);
      const ext = /\.jpe?g$/i.test(u) ? '.jpg' : (/\.png$/i.test(u) ? '.png' : (/\.webp$/i.test(u) ? '.webp' : '.webp'));
      const name = String(i+1).padStart(String(ch.urls.length).length, '0') + ext;
      await fs.writeFile(join(chDir, name), b);
      doneImages++;
      const pct = 35 + Math.floor((doneImages / Math.max(1,totalImages)) * 40);
      set(`Downloading images… (${doneImages}/${totalImages})`, pct);
    }

    const doStitch = !!(stitch && !rawOnly);
    if (doStitch) {
      const MAX_PANEL = 24000;
      const chunkTarget = Math.max(500, Math.min(Number(splitHeight) || 5000, MAX_PANEL));

      const files = (await fs.readdir(chDir)).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
      const rawBufs = await Promise.all(files.map(async f => await fs.readFile(join(chDir, f))));

      const oriented = await Promise.all(rawBufs.map(async buf => (await sharp(buf).rotate().ensureAlpha()).toBuffer()));

      let targetWidth: number | null = null;
      if (widthEnforce === 1) {
        const widths = await Promise.all(oriented.map(async buf => (await sharp(buf).metadata()).width || 0));
        targetWidth = Math.min(...widths.filter(Boolean));
      } else if (widthEnforce === 2) {
        targetWidth = Math.max(1, Number(customWidth) || 720);
      }

      const resized = await Promise.all(oriented.map(async buf => {
        if (!targetWidth) return buf;
        return await sharp(buf).resize({ width: targetWidth }).toBuffer();
      }));

      let metas = await Promise.all(resized.map(async buf => await sharp(buf).metadata()));
      const baseWidth = (targetWidth ?? Math.max(...metas.map(m => m.width || 0))) || ((await sharp(resized[0]).metadata()).width ?? 720);

      const guarded = await Promise.all(resized.map(async (buf, i) => {
        const w = metas[i].width || 0;
        if (w > baseWidth) return await sharp(buf).resize({ width: baseWidth }).toBuffer();
        return buf;
      }));
      metas = await Promise.all(guarded.map(async buf => await sharp(buf).metadata()));

      const outDir = join(chDir, 'stitched');
      await fs.mkdir(outDir, { recursive: true });

      let panelIndex = 0;
      let i = 0;

      const totalH = metas.reduce((a, m) => a + (m.height || 0), 0);
      const estPanels = Math.max(1, Math.ceil(totalH / chunkTarget));

      while (i < guarded.length) {
        const overlays: any[] = [];
        let usedHeight = 0;

        while (i < guarded.length) {
          const h = metas[i].height || 0;
          const remain = chunkTarget - usedHeight;
          if (h <= remain) {
            overlays.push({ input: guarded[i], left: 0, top: usedHeight });
            usedHeight += h;
            i++;
          } else {
            let cut = remain;
            if (smartSeam) {
              try { cut = await findSeamY(guarded[i], remain, Math.min(400, Math.floor(chunkTarget * 0.08))); } catch {}
              cut = Math.max(20, Math.min(h - 20, cut));
            }
            const topBuf = await sharp(guarded[i]).extract({ left: 0, top: 0, width: baseWidth, height: cut }).toBuffer();
            overlays.push({ input: topBuf, left: 0, top: usedHeight });
            usedHeight += cut;
            const bottomH = h - cut;
            if (bottomH > 0) {
              guarded[i] = await sharp(guarded[i]).extract({ left: 0, top: cut, width: baseWidth, height: bottomH }).toBuffer();
              metas[i] = await sharp(guarded[i]).metadata();
            } else {
              i++;
            }
            break;
          }
        }

        const fmt = (outType || '.png').slice(1) as any;
        const big = await sharp({ create: { width: baseWidth, height: usedHeight, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
          .composite(overlays).toFormat(fmt).toBuffer();

        panelIndex++;
        const fname = String(panelIndex).padStart(2, '0') + (outType || '.png');
        await fs.writeFile(join(outDir, fname), big);

        const pct = 80 + Math.min(10, Math.floor((panelIndex / estPanels) * 10));
        set(`Stitching ${ch.id}…`, pct);
      }
    }
  }

  // Zip
const fs2 = await import('node:fs');
const fsp = await import('node:fs/promises');
const archiver = (await import('archiver')).default;

set('Zipping…', 90);
const outPath = join(tmpdir(), `bato-${jobId}.zip`);
await fsp.rm(outPath, { force: true });
const output = fs2.createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });
archive.directory(jobDir, false);
const p = new Promise<string>((resolve, reject) => {
  output.on('close', () => resolve(outPath));
  archive.on('error', reject);
});
archive.pipe(output);
archive.finalize();
const path = await p;

// tulis marker di /tmp supaya instance lain bisa baca
const markerPath = join(tmpdir(), `bato-${jobId}.json`);
const expiresAt = Date.now() + 10 * 60 * 1000;
await fsp.writeFile(markerPath, JSON.stringify({ jobId, downloadPath: path, expiresAt }), 'utf8');

store.set(jobId, { stage: 'Done', percent: 100, downloadPath: path as any, expiresAt });
