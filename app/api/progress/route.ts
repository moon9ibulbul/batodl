import { store } from '@/app/api/_store';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId') || '';

  return new Response(new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = () => {
        const s = store.get(jobId);
        if (!s) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'error', message: 'Job not found' })}\n\n`));
          controller.close();
          return;
        }
        if (s.error) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'error', message: s.error })}\n\n`));
          controller.close();
          return;
        }
        const done = s.stage === 'Done' && s.percent >= 100;
        if (done) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done', downloadUrl: '/api/download?jobId=' + jobId })}\n\n`));
          controller.close();
          return;
        }
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'stage', stage: s.stage })}\n\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'progress', percent: s.percent })}\n\n`));
      };
      const t = setInterval(send, 500);
      send();
      return () => clearInterval(t as any);
    }
  }), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    }
  });
}