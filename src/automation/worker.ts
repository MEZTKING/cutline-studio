import { desktop, hydrateDesktopProject } from '../desktop/bridge';
import { exportProject, type ExportFormat, type ExportQuality } from '../export/exporter';

interface AutomationSettings {
  width: number;
  height: number;
  fps: number;
  quality: ExportQuality;
  format: ExportFormat;
  includeAudio: boolean;
  fileName: string;
}

interface AutomationJob {
  data: Parameters<typeof hydrateDesktopProject>[0];
  settings: AutomationSettings;
  outputPath: string;
}

interface AutomationApi {
  automationJob(): Promise<AutomationJob>;
  automationProgress(progress: { phase: string; percent: number }): void;
  automationWrite(buffer: ArrayBuffer, filename: string): Promise<{ ok: boolean }>;
  automationDone(): void;
  automationError(message: string): void;
}

const api = desktop as unknown as AutomationApi;

async function run(): Promise<void> {
  if (!api?.automationJob) throw new Error('Automation bridge unavailable.');
  const job = await api.automationJob();
  const { project, assets } = await hydrateDesktopProject(job.data);
  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));
  const result = await exportProject(
    project,
    assetMap,
    { ...job.settings, fileName: project.name },
    (p) => api.automationProgress(p),
    new AbortController().signal,
  );
  const buffer = await result.blob.arrayBuffer();
  await api.automationWrite(buffer, result.filename);
  api.automationDone();
}

void run().catch((err: unknown) => {
  api?.automationError?.(err instanceof Error ? err.message : String(err));
});
