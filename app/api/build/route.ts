import { NextResponse } from 'next/server';
import { store } from '@/app/api/_store';

export const runtime = 'nodejs';

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export async function POST(req: Request) {
  const body = await req.json();
  const jobId = newId();
  store.set(jobId, { stage: 'Queued', percent: 0 });

  // kick off processing (no await)
  process(jobId, body).catch((e) => {
    const s = store.get(jobId);
    if (s) {
      s.stage = 'Error';
      (s as any).error = String(e);
      store.set(jobId, s);
    }
  });

  return NextResponse.json({ jobId });
}

async function process(jobId: string, opts: any) {
  const set = (stage: string, percent: number) => {
    store.set(jobId, { ...(store.get(jobId) || { stage: '' , percent: 0 }), stage, percent });
  };

  const { ids, stitch, rawOnly, splitHeight, outType, widthEnforce, customWidth, lowRam, unitImages } = opts || {};
  const idsArr = String(ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!idsArr.length) throw new Error('No IDs provided');
  set('Fetching chapters…', 5);

  const chapters: { id: string; urls: string[] }[] = [];

  // Fetch & parse
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

  // Download + (optional) stitch using sharp
  const doStitch = !!(stitch && !rawOnly);
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const fs = await import('node:fs/promises');
  const sharp = (await import('sharp')).default;
  const archiver = (await import('archiver')).default;

  const jobDir = join(tmpdir(), `bato-${jobId}`);
  await fs.mkdir(jobDir, { recursive: true });

  let totalImages = 0;
  chapters.forEach(c => totalImages += c.urls.length);
  let doneImages = 0;

  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci];
    const chDir = join(jobDir, ch.id);
    await fs.mkdir(chDir, { recursive: true });

    // Download each image
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

    // Stitch (optional)
    if (doStitch) {
      set(`Stitching ${ch.id}…`, Math.min(80, 35 + Math.floor((doneImages / Math.max(1,totalImages)) * 40)));
      const files = (await fs.readdir(chDir)).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
      const buffers = await Promise.all(files.map(async f => await fs.readFile(join(chDir, f))));
      const images = await Promise.all(buffers.map(async buf => sharp(buf).ensureAlpha().toBuffer()));

      // Normalize width if needed
      let targetWidth: number | null = null;
      if (widthEnforce === 1) {
        // min width across images
        const widths = await Promise.all(images.map(async buf => (await sharp(buf).metadata()).width || 0));
        targetWidth = Math.min(...widths.filter(Boolean));
      } else if (widthEnforce === 2) {
        targetWidth = Math.max(1, Number(customWidth) || 720);
      }

      const resized = await Promise.all(images.map(async (buf) => {
        if (!targetWidth) return buf;
        return await sharp(buf).resize({ width: targetWidth }).toBuffer();
      }));

      // Stack vertically
      const metas = await Promise.all(resized.map(async (buf) => await sharp(buf).metadata()));
      const totalHeight = metas.reduce((acc, m) => acc + (m.height || 0), 0);
      const width = targetWidth || (metas[0].width || 0);

      // Build a tall image in chunks to avoid OOM
      const composite: any[] = [];
      let y = 0;
      for (let idx = 0; idx < resized.length; idx++) {
        const m = metas[idx];
        composite.push({ input: resized[idx], left: 0, top: y });
        y += m.height || 0;
      }
      const big = await sharp({
        create: { width: width, height: totalHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
      }).composite(composite).toFormat(outType.slice(1) as any).toBuffer();

      // Split by splitHeight
      const parts: Buffer[] = [];
      const chunk = Math.max(500, Number(splitHeight) || 5000);
      let cur = 0;
      while (cur < totalHeight) {
        const h = Math.min(chunk, totalHeight - cur);
        const part = await sharp(big).extract({ left: 0, top: cur, width, height: h }).toFormat(outType.slice(1) as any).toBuffer();
        parts.push(part);
        cur += h;
      }

      // Save parts
      const outDir = join(chDir, 'stitched');
      await fs.mkdir(outDir, { recursive: true });
      for (let pi = 0; pi < parts.length; pi++) {
        const fname = String(pi+1).padStart(2, '0') + outType;
        await fs.writeFile(join(outDir, fname), parts[pi]);
      }
    }
  }

  // Zip results
  set('Zipping…', 90);
  const path = await zipDir(jobDir);
  const expiresAt = Date.now() + 10*60*1000; // 10 minutes
  store.set(jobId, { stage: 'Done', percent: 100, downloadPath: path as any, expiresAt });
}

async function zipDir(dir: string): Promise<string> {
  const { join, basename } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const fs = await import('node:fs');
  const fsp = await import('node:fs/promises');
  const archiver = (await import('archiver')).default;

  const outPath = join(tmpdir(), basename(dir) + '.zip');
  await fsp.rm(outPath, { force: true });
  const output = fs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.directory(dir, false);
  const p = new Promise<string>((resolve, reject) => {
    output.on('close', () => resolve(outPath));
    archive.on('error', reject);
  });
  archive.pipe(output);
  archive.finalize();
  return p;
}