type Status = {
  stage: string;
  percent: number;
  downloadPath?: string;
  error?: string;
  expiresAt?: number;
};

const g = global as any;
if (!g.__BATOSTORE__) {
  g.__BATOSTORE__ = new Map<string, Status>();
}
export const store: Map<string, Status> = g.__BATOSTORE__;

function ensureCleanupTimer() {
  const g = global as any;
  if (g.__BATO_CLEANER__) return;
  g.__BATO_CLEANER__ = setInterval(async () => {
    try {
      const now = Date.now();
      const toDelete: string[] = [];
      for (const [id, s] of store.entries()) {
        if (s.expiresAt && s.expiresAt < now && s.downloadPath) {
          try {
            const { unlink, rm } = await import('node:fs/promises');
            const { dirname } = await import('node:path');
            await unlink(s.downloadPath).catch(() => {});
            const dir = dirname(s.downloadPath).replace(/\.zip$/i, '');
            await rm(dir, { recursive: true, force: true }).catch(() => {});
          } catch {}
          toDelete.push(id);
        }
      }
      toDelete.forEach((id) => store.delete(id));
    } catch {}
  }, 60 * 1000);
}
ensureCleanupTimer();
