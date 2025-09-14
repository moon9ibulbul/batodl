import { store } from '@/app/api/_store';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId') || '';

  // 1) coba dari in-memory
  let s = store.get(jobId);

  // 2) kalau nggak ada (instance beda), baca marker di /tmp
  if (!s) {
    try {
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const { readFile } = await import('node:fs/promises');
      const markerPath = join(tmpdir(), `bato-${jobId}.json`);
      const raw = await readFile(markerPath, 'utf8');
      const m = JSON.parse(raw);
      if (m && m.downloadPath) {
        s = { stage: 'Done', percent: 100, downloadPath: m.downloadPath, expiresAt: m.expiresAt };
        store.set(jobId, s);
      }
    } catch {
      // marker tidak ada → belum siap
    }
  }

  if (!s || !s.downloadPath) {
    return new Response('Not ready', { status: 404 });
  }

  // 3) cek expiry
  if (s.expiresAt && Date.now() > s.expiresAt) {
    try {
      const { unlink, rm } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await unlink(s.downloadPath).catch(() => {});
      const dir = dirname(s.downloadPath).replace(/\.zip$/i, '');
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      // hapus marker juga
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      await unlink(join(tmpdir(), `bato-${jobId}.json`)).catch(() => {});
    } catch {}
    store.delete(jobId);
    return new Response('Expired', { status: 410 });
  }

  const st = await stat(s.downloadPath);
  return new Response(createReadStream(s.downloadPath) as any, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(st.size),
      'Content-Disposition': `attachment; filename="batoto_${jobId}.zip"`,
    }
  });
}
