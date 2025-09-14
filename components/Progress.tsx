'use client';
import React from 'react';

export default function Progress({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="w-full">
      {label ? <div className="mb-1 text-sm text-neutral-300">{label}</div> : null}
      <div className="h-3 w-full rounded-full bg-neutral-800 overflow-hidden">
        <div className="h-3 bg-white/80 transition-all" style={{ width: `${v}%` }} />
      </div>
      <div className="mt-1 text-xs text-neutral-400">{v.toFixed(0)}%</div>
    </div>
  );
}