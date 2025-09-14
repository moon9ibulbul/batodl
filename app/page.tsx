'use client';

import React, { useEffect, useRef, useState } from 'react';
import Progress from '@/components/Progress';

type BuildOptions = {
  ids: string;
  stitch: boolean;
  rawOnly: boolean;
  splitHeight: number;
  outType: '.png' | '.jpg' | '.webp';
  widthEnforce: 0 | 1 | 2;
  customWidth: number;
  lowRam: boolean;
  unitImages: number;
};

type StatusMessage = {
  type: 'stage' | 'progress' | 'log' | 'done' | 'error';
  stage?: string;
  chapterId?: string;
  percent?: number;
  message?: string;
  downloadUrl?: string;
};

export default function Page() {
  const [form, setForm] = useState<BuildOptions>({
    ids: '',
    stitch: true,
    rawOnly: false,
    splitHeight: 5000,
    outType: '.png',
    widthEnforce: 1,
    customWidth: 720,
    lowRam: false,
    unitImages: 20,
  });
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState('Idle');
  const [percent, setPercent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [stage, percent]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setStage('Initializing...');
    setPercent(0);
    setDownloadUrl(null);

    const res = await fetch('/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      setStage('Failed to start build');
      setRunning(false);
      return;
    }
    const { jobId } = await res.json();

    // SSE
    const es = new EventSource(`/api/progress?jobId=${encodeURIComponent(jobId)}`);
    es.onmessage = (ev) => {
      const data: StatusMessage = JSON.parse(ev.data);
      if (data.type === 'stage') {
        setStage(data.stage || '');
      } else if (data.type === 'progress') {
        setPercent(data.percent || 0);
      } else if (data.type === 'done') {
        setStage('Done');
        setPercent(100);
        setDownloadUrl(data.downloadUrl || null);
        setRunning(false);
        es.close();
      } else if (data.type === 'error') {
        setStage(data.message || 'Error');
        setRunning(false);
        es.close();
      }
    };
    es.onerror = () => {
      setStage('Stream closed');
      setRunning(false);
      es.close();
    };
  };

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="text-2xl font-semibold">Batoto Stitcher</div>
        <div className="text-sm text-neutral-400">ID-based downloader + optional stitching</div>
      </header>

      <form onSubmit={onSubmit} className="grid gap-4 rounded-2xl bg-neutral-900 p-5 shadow">
        <div className="grid gap-2">
          <label className="text-sm text-neutral-300">Chapter IDs (comma-separated)</label>
          <input
            className="rounded-xl bg-neutral-800 px-3 py-2 outline-none focus:ring-2 ring-white/20"
            placeholder="e.g. 3748169,3748170"
            value={form.ids}
            onChange={(e) => setForm({ ...form, ids: e.target.value })}
            required
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <label className="text-sm text-neutral-300">Split height</label>
            <input type="number" min={1000} max={20000}
              className="rounded-xl bg-neutral-800 px-3 py-2"
              value={form.splitHeight}
              onChange={(e) => setForm({ ...form, splitHeight: Number(e.target.value) })}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-neutral-300">Output type</label>
            <select
              className="rounded-xl bg-neutral-800 px-3 py-2"
              value={form.outType}
              onChange={(e) => setForm({ ...form, outType: e.target.value as any })}
            >
              <option value=".png">.png</option>
              <option value=".jpg">.jpg</option>
              <option value=".webp">.webp</option>
            </select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-neutral-300">Width enforce</label>
            <select
              className="rounded-xl bg-neutral-800 px-3 py-2"
              value={form.widthEnforce}
              onChange={(e) => setForm({ ...form, widthEnforce: Number(e.target.value) as any })}
            >
              <option value={0}>0 - none</option>
              <option value={1}>1 - min width</option>
              <option value={2}>2 - custom</option>
            </select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-neutral-300">Custom width (for enforce=2)</label>
            <input type="number" min={320} max={3000}
              className="rounded-xl bg-neutral-800 px-3 py-2"
              value={form.customWidth}
              onChange={(e) => setForm({ ...form, customWidth: Number(e.target.value) })}
            />
          </div>
          <div className="grid gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-300">
              <input type="checkbox" checked={form.stitch}
                onChange={(e) => setForm({ ...form, stitch: e.target.checked })}/>
              Stitch after download
            </label>
          </div>
          <div className="grid gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-300">
              <input type="checkbox" checked={form.rawOnly}
                onChange={(e) => setForm({ ...form, rawOnly: e.target.checked, stitch: e.target.checked ? false : form.stitch })}/>
              Save raw images only (no stitch)
            </label>
          </div>
          <div className="grid gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-300">
              <input type="checkbox" checked={form.lowRam}
                onChange={(e) => setForm({ ...form, lowRam: e.target.checked })}/>
              Low-RAM mode
            </label>
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-neutral-300">Unit images (low RAM)</label>
            <input type="number" min={5} max={200}
              className="rounded-xl bg-neutral-800 px-3 py-2"
              value={form.unitImages}
              onChange={(e) => setForm({ ...form, unitImages: Number(e.target.value) })}
            />
          </div>
        </div>

        <button
          disabled={running}
          className="rounded-2xl bg-white/90 text-neutral-900 font-medium px-4 py-2 hover:bg-white"
        >
          {running ? 'Running…' : 'Start'}
        </button>
      </form>

      <div className="grid gap-3 rounded-2xl bg-neutral-900 p-5 shadow">
        <div className="text-sm text-neutral-400">{stage}</div>
        <Progress value={percent} />
        {downloadUrl ? (
          <a href={downloadUrl} className="inline-block rounded-xl bg-white text-neutral-900 font-medium px-4 py-2 mt-2">
            Download ZIP
          </a>
        ) : null}
        <div ref={logRef} className="max-h-48 overflow-auto text-xs text-neutral-400"></div>
      </div>
    </main>
  );
}