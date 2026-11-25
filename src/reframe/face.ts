import type { FaceDetector } from '@mediapipe/tasks-vision';

export interface FaceBox {
  /** Centre as a fraction of the source frame. */
  cx: number;
  cy: number;
  /** Area as a fraction of the source frame. */
  size: number;
  score: number;
}

let detectorPromise: Promise<FaceDetector> | null = null;

async function createDetector(): Promise<FaceDetector> {
  const { FaceDetector: Detector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const base = new URL(import.meta.env.BASE_URL || './', window.location.href);
  const wasmDir = new URL('vendor/mediapipe', base).href;
  const model = new URL('models/face_detector.tflite', base).href;
  const fileset = await FilesetResolver.forVisionTasks(wasmDir);
  return Detector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: model, delegate: 'CPU' },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.35,
  });
}

export function loadFaceDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = createDetector().catch((err: unknown) => {
      detectorPromise = null;
      throw new Error(
        `Face detection could not start on this device. ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
  return detectorPromise;
}

export async function detectFaces(canvas: HTMLCanvasElement): Promise<FaceBox[]> {
  const detector = await loadFaceDetector();
  const result = detector.detect(canvas);
  const out: FaceBox[] = [];
  for (const det of result.detections) {
    const box = det.boundingBox;
    if (!box || !box.width || !box.height) continue;
    out.push({
      cx: (box.originX + box.width / 2) / canvas.width,
      cy: (box.originY + box.height / 2) / canvas.height,
      size: (box.width * box.height) / (canvas.width * canvas.height),
      score: det.categories?.[0]?.score ?? 0,
    });
  }
  return out;
}