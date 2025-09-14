import { store } from '@/app/api/_store';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId') || '';
  const s = store.get(jobId);
  if (!s || !s.downloadPath) {
    return new Response('Not ready', { status: 404 });
  }
  if (s.expiresAt && Date.now() > s.expiresAt) {
    try {
      const { unlink, rm } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await unlink(s.downloadPath).catch(() => {});
      const dir = dirname(s.downloadPath).replace(/\.zip$/i, '');
      await rm(dir, { recursive: true, force: true }).catch(() => {});
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