import type { Clip } from '../core/types';
import { clamp } from './envelope';

export interface ClipChain {
  input: AudioNode;
  gain: GainNode;
  nodes: AudioNode[];
}

/**
 * Build a per-clip audio chain: 3-band EQ → optional compressor → envelope gain → pan.
 * The returned input is the first node to connect the source to; gain is the fader.
 */
export function createClipChain(ctx: BaseAudioContext, clip: Clip, destination: AudioNode): ClipChain {
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 150;
  low.gain.value = clamp(clip.eqLow ?? 0, -24, 24);

  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1100;
  mid.Q.value = 0.9;
  mid.gain.value = clamp(clip.eqMid ?? 0, -24, 24);

  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 5500;
  high.gain.value = clamp(clip.eqHigh ?? 0, -24, 24);

  low.connect(mid);
  mid.connect(high);
  const nodes: AudioNode[] = [low, mid, high];
  let tail: AudioNode = high;

  const amount = clamp(clip.compress ?? 0, 0, 1);
  if (amount > 0.01) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12 - 30 * amount;
    comp.knee.value = 10;
    comp.ratio.value = 2 + 8 * amount;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    tail.connect(comp);
    tail = comp;
    nodes.push(comp);
  }

  const gain = ctx.createGain();
  tail.connect(gain);
  nodes.push(gain);

  const panner = ctx.createStereoPanner();
  panner.pan.value = clamp(clip.pan ?? 0, -1, 1);
  gain.connect(panner);
  panner.connect(destination);
  nodes.push(panner);

  return { input: low, gain, nodes };
}
