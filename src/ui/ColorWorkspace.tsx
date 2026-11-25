import { useEffect, useRef, useState } from 'react';
import { defaultColor, findClip } from '../core/model';
import { CURVE_DEFAULTS, QUALIFIER_DEFAULTS, WINDOW_DEFAULTS, type ColorGrade, type ColorWheel, type CurvePoint } from '../core/types';
import { ZERO_WHEEL } from '../core/types';
import { parseCube, lutChoices, lutLabel } from '../color/lut';
import { webglAvailable } from '../color/colorizer';
import { useEditor } from '../state/store';
import { Icon } from './icons';

const round = (n: number) => Math.round(n * 1000) / 1000;

function Scopes() {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const vectorRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const sample = document.createElement('canvas');
    sample.width = 192;
    sample.height = 108;
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    const wave = waveRef.current;
    const vector = vectorRef.current;
    const hist = histRef.current;
    if (!wave || !vector || !hist || !sctx) return;
    const wctx = wave.getContext('2d');
    const vctx = vector.getContext('2d');
    const hctx = hist.getContext('2d');
    if (!wctx || !vctx || !hctx) return;

    const draw = () => {
      const preview = document.querySelector<HTMLCanvasElement>('.preview-frame canvas');
      if (!preview || !preview.width) {
        setAvailable(false);
        return;
      }
      try {
        sctx.drawImage(preview, 0, 0, sample.width, sample.height);
      } catch {
        setAvailable(false);
        return;
      }
      setAvailable(true);
      const data = sctx.getImageData(0, 0, sample.width, sample.height).data;

      // --- waveform (RGB additive) ---
      const W = wave.width;
      const H = wave.height;
      wctx.clearRect(0, 0, W, H);
      wctx.fillStyle = '#05080a';
      wctx.fillRect(0, 0, W, H);
      wctx.strokeStyle = 'rgba(255,255,255,0.06)';
      wctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (H / 4) * i;
        wctx.beginPath();
        wctx.moveTo(0, y);
        wctx.lineTo(W, y);
        wctx.stroke();
      }
      wctx.globalCompositeOperation = 'lighter';
      for (let y = 0; y < sample.height; y += 2) {
        for (let x = 0; x < sample.width; x += 2) {
          const i = (y * sample.width + x) * 4;
          const px = (x / sample.width) * W;
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          wctx.fillStyle = 'rgba(255,64,64,0.10)';
          wctx.fillRect(px, H - r * H, 1, 1);
          wctx.fillStyle = 'rgba(64,255,128,0.10)';
          wctx.fillRect(px, H - g * H, 1, 1);
          wctx.fillStyle = 'rgba(80,140,255,0.10)';
          wctx.fillRect(px, H - b * H, 1, 1);
        }
      }
      wctx.globalCompositeOperation = 'source-over';

      // --- vectorscope ---
      const VW = vector.width;
      const VH = vector.height;
      vctx.clearRect(0, 0, VW, VH);
      vctx.fillStyle = '#05080a';
      vctx.fillRect(0, 0, VW, VH);
      vctx.strokeStyle = 'rgba(255,255,255,0.1)';
      vctx.beginPath();
      vctx.arc(VW / 2, VH / 2, VW / 2 - 4, 0, Math.PI * 2);
      vctx.stroke();
      vctx.beginPath();
      vctx.moveTo(8, VH / 2);
      vctx.lineTo(VW - 8, VH / 2);
      vctx.moveTo(VW / 2, 8);
      vctx.lineTo(VW / 2, VH - 8);
      vctx.stroke();
      vctx.globalCompositeOperation = 'lighter';
      const scale = (VW / 2 - 6) * 1.25;
      for (let i = 0; i < data.length; i += 4 * 3) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const u = -0.169 * r - 0.331 * g + 0.5 * b;
        const v = 0.5 * r - 0.419 * g - 0.081 * b;
        vctx.fillStyle = 'rgba(92,242,176,0.14)';
        vctx.fillRect(VW / 2 + u * scale, VH / 2 - v * scale, 1, 1);
      }
      vctx.globalCompositeOperation = 'source-over';

      // --- histogram ---
      const HW = hist.width;
      const HH = hist.height;
      hctx.clearRect(0, 0, HW, HH);
      hctx.fillStyle = '#05080a';
      hctx.fillRect(0, 0, HW, HH);
      const bins = 64;
      const counts = [new Float32Array(bins), new Float32Array(bins), new Float32Array(bins)];
      for (let i = 0; i < data.length; i += 4) {
        counts[0][Math.min(bins - 1, data[i] >> 2)]++;
        counts[1][Math.min(bins - 1, data[i + 1] >> 2)]++;
        counts[2][Math.min(bins - 1, data[i + 2] >> 2)]++;
      }
      let peak = 1;
      for (const c of counts) for (const n of c) peak = Math.max(peak, n);
      const colors = ['rgba(255,80,80,0.8)', 'rgba(80,255,140,0.8)', 'rgba(90,150,255,0.8)'];
      counts.forEach((c, ci) => {
        hctx.strokeStyle = colors[ci];
        hctx.lineWidth = 1;
        hctx.beginPath();
        for (let i = 0; i < bins; i++) {
          const x = (i / (bins - 1)) * HW;
          const y = HH - (c[i] / peak) * (HH - 4);
          if (i === 0) hctx.moveTo(x, y);
          else hctx.lineTo(x, y);
        }
        hctx.stroke();
      });
    };

    const tick = (now: number) => {
      if (now - last > 180) {
        last = now;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="scopes">
      <div className="scope-head">
        <span>Scopes</span>
        <span className="scope-live">{available ? 'LIVE' : 'NO SIGNAL'}</span>
      </div>
      <div className="scope-label">Waveform · RGB</div>
      <canvas ref={waveRef} width={280} height={62} className="scope-wave" />
      <div className="scope-row">
        <div>
          <div className="scope-label">Vectorscope</div>
          <canvas ref={vectorRef} width={112} height={112} className="scope-vector" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="scope-label">Histogram</div>
          <canvas ref={histRef} width={150} height={62} className="scope-hist" />
        </div>
      </div>
    </div>
  );
}

function ColorSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const begin = () => useEditor.getState().beginGesture();
  const end = () => useEditor.getState().endGesture();
  return (
    <div className="color-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={begin}
        onPointerUp={end}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="color-slider-value">{Number(value.toFixed(1))}</span>
    </div>
  );
}

function CurveEditor({ points, onChange }: { points: CurvePoint[]; onChange: (points: CurvePoint[]) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ index: number; points: CurvePoint[] } | null>(null);

  const draw = () => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#080a0d';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = (i / 4) * w, y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, 0); ctx.stroke();
    const sorted = [...points].sort((a, b) => a.x - b.x);
    ctx.strokeStyle = '#5cf2b0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const x = i / 100;
      let a = sorted[0], b = sorted[sorted.length - 1];
      for (let k = 0; k < sorted.length - 1; k++) {
        if (x >= sorted[k].x && x <= sorted[k + 1].x) { a = sorted[k]; b = sorted[k + 1]; break; }
      }
      const t = Math.min(1, Math.max(0, (x - a.x) / Math.max(1e-6, b.x - a.x)));
      const y = a.y + (b.y - a.y) * (t * t * (3 - 2 * t));
      const px = x * w, py = (1 - y) * h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    for (const pt of sorted) {
      ctx.beginPath();
      ctx.arc(pt.x * w, (1 - pt.y) * h, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0b0d10'; ctx.fill();
      ctx.strokeStyle = '#5cf2b0'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  };

  useEffect(draw, [points]);

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: 1 - (event.clientY - rect.top) / rect.height };
  };

  const onDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pos = pointAt(event);
    const sorted = [...points].sort((a, b) => a.x - b.x);
    let index = sorted.findIndex((p) => Math.hypot(p.x - pos.x, p.y - pos.y) < 0.08);
    let next = sorted;
    if (index < 0) {
      next = [...sorted, { x: Math.min(0.99, Math.max(0.01, pos.x)), y: Math.min(1, Math.max(0, pos.y)) }].sort((a, b) => a.x - b.x);
      index = next.findIndex((p) => p.x === Math.min(0.99, Math.max(0.01, pos.x)));
    }
    drawing.current = { index, points: next };
    useEditor.getState().beginGesture();
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange(next);
  };

  const onMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const pos = pointAt(event);
    const pts = drawing.current.points.map((p) => ({ ...p }));
    const i = drawing.current.index;
    const isFirst = i === 0, isLast = i === pts.length - 1;
    if (!isFirst && !isLast) {
      const left = pts[i - 1].x + 0.01;
      const right = pts[i + 1].x - 0.01;
      pts[i].x = Math.min(right, Math.max(left, pos.x));
    }
    pts[i].y = Math.min(1, Math.max(0, pos.y));
    drawing.current.points = pts;
    onChange(pts);
  };

  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = null;
    useEditor.getState().endGesture();
  };

  const onDouble = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pos = pointAt(event);
    const sorted = [...points].sort((a, b) => a.x - b.x);
    const index = sorted.findIndex((p) => Math.hypot(p.x - pos.x, p.y - pos.y) < 0.08);
    if (index > 0 && index < sorted.length - 1) {
      onChange(sorted.filter((_, k) => k !== index));
    }
  };

  return (
    <div>
      <canvas
        ref={ref}
        className="curve-canvas"
        width={220}
        height={140}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={onDouble as unknown as React.MouseEventHandler<HTMLCanvasElement>}
        title="Click to add a point, drag to shape, double-click a point to remove"
      />
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <span className="hint" style={{ margin: 0 }}>Master RGB · click to add, drag to shape</span>
        <button className="btn ghost sm" onClick={() => onChange(CURVE_DEFAULTS.map((p) => ({ ...p })))}>Reset</button>
      </div>
    </div>
  );
}

function Wheel({
  label,
  wheel,
  onChange,
  onStart,
  onEnd,
}: {
  label: string;
  wheel: ColorWheel;
  onChange: (w: ColorWheel) => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const face = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = (clientX: number, clientY: number) => {
    const rect = face.current?.getBoundingClientRect();
    if (!rect) return;
    let x = ((clientX - rect.left) / rect.width) * 2 - 1;
    let y = ((clientY - rect.top) / rect.height) * 2 - 1;
    const r = Math.hypot(x, y);
    if (r > 1) {
      x /= r;
      y /= r;
    }
    onChange({ ...wheel, x: round(x), y: round(y) });
  };

  return (
    <div className="wheel">
      <div className="wheel-label">{label}</div>
      <div
        className="wheel-face"
        ref={face}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          onStart();
          update(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (dragging.current) update(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          dragging.current = false;
          onEnd();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          onEnd();
        }}
        onDoubleClick={() => {
          onStart();
          onChange({ x: 0, y: 0, master: wheel.master });
          onEnd();
        }}
        title="Drag to shift colour. Double-click to reset."
      >
        <span
          className="wheel-puck"
          style={{ left: `${((wheel.x + 1) / 2) * 100}%`, top: `${((wheel.y + 1) / 2) * 100}%` }}
        />
      </div>
      <input
        className="wheel-master"
        type="range"
        min={-0.5}
        max={0.5}
        step={0.01}
        value={wheel.master}
        title="Luminance"
        onPointerDown={onStart}
        onPointerUp={onEnd}
        onChange={(e) => onChange({ ...wheel, master: Number(e.target.value) })}
      />
    </div>
  );
}

export function ColorWorkspace({ showHead = true }: { showHead?: boolean }) {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const colorBypass = useEditor((s) => s.colorBypass);
  const setWorkspace = useEditor((s) => s.setWorkspace);
  const setColorBypass = useEditor((s) => s.setColorBypass);
  const livePatchClip = useEditor((s) => s.livePatchClip);
  const found = selection.clipId ? findClip(project, selection.clipId) : null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [gpu] = useState(() => webglAvailable());

  if (showHead) {
    return (
      <>
        <div className="panel-head">
          <span>Color</span>
          <button className="btn ghost sm" onClick={() => setWorkspace('edit')}>
            <Icon name="settings" size={12} /> Edit
          </button>
        </div>
        <ColorBody />
      </>
    );
  }

  return <ColorBody />;

  function ColorBody() {
    if (!found) {
      return (
        <div className="panel-scroll">
          <div className="empty-state">
            <div className="empty-icon">
              <Icon name="palette" size={24} />
            </div>
            <h3>Select a clip to grade</h3>
            <p>Pick a clip on the timeline, then use the wheels, LUTs, and scopes here.</p>
            <button className="btn sm" onClick={() => setWorkspace('edit')}>
              Back to edit
            </button>
          </div>
        </div>
      );
    }

    const { clip } = found;
    const color = clip.color;
    const qualifier = { ...QUALIFIER_DEFAULTS, ...(color.qualifier ?? {}) };
    const powerWindow = { ...WINDOW_DEFAULTS, ...(color.window ?? {}) };
    const lift = color.lift ?? ZERO_WHEEL;
    const gamma = color.gamma ?? ZERO_WHEEL;
    const gain = color.gain ?? ZERO_WHEEL;
    const luts = project.luts;
    const importedLut = color.lutId && luts?.[color.lutId];

    const setColor = (patch: Partial<ColorGrade>) => {
      livePatchClip(clip.id, { color: { ...color, ...patch } });
    };
    const gesture = (fn: () => void) => () => {
      const s = useEditor.getState();
      s.beginGesture();
      fn();
      s.endGesture();
    };

    const importLut = async (file: File) => {
      try {
        const parsed = parseCube(await file.text(), file.name.replace(/\.[^.]+$/, ''));
        const state = useEditor.getState();
        const id = state.addLut({
          name: parsed.name,
          size: parsed.size,
          data: parsed.data,
          domainMin: parsed.domainMin,
          domainMax: parsed.domainMax,
        });
        state.updateClip(clip.id, { color: { ...clip.color, lutId: id, lutMix: 1 } }, false);
        state.notify(`Loaded LUT “${parsed.name}”`, 'success');
      } catch (err) {
        useEditor.getState().notify(err instanceof Error ? err.message : 'Could not read that LUT.', 'error');
      }
    };

    return (
      <div className="panel-scroll">
        <div className="color-body">
          <div className="color-title-row">
            <div style={{ minWidth: 0 }}>
              <div className="clip-card-name">{clip.name}</div>
              <div className="clip-card-sub">{found.track.name} · primary grade</div>
            </div>
            <button
              className={`btn sm ${colorBypass ? 'active' : ''}`}
              onClick={() => setColorBypass(!colorBypass)}
              title="Bypass the grade (viewer only)"
              style={colorBypass ? { color: 'var(--warn)', borderColor: 'var(--warn)' } : undefined}
            >
              <Icon name="eye" size={13} /> {colorBypass ? 'Bypassed' : 'Compare'}
            </button>
            <button
              className="btn ghost icon sm"
              title="Reset grade"
              onClick={gesture(() => setColor(defaultColor()))}
            >
              <Icon name="reset" size={13} />
            </button>
          </div>

          {!gpu && (
            <div className="hint warn">
              GPU grading is unavailable in this browser; LUTs and wheels will not render. Basic filters still apply.
            </div>
          )}

          <Scopes />

          <div className="section color-card">
            <div className="section-head">
              <Icon name="sparkle" size={11} />
              <span>LUT</span>
              {importedLut && (
                <span className="head-extra">
                  <button
                    className="btn ghost icon sm"
                    title="Remove imported LUT"
                    onClick={() => useEditor.getState().removeLut(color.lutId!)}
                  >
                    <Icon name="trash" size={11} />
                  </button>
                </span>
              )}
            </div>
            <div className="section-body">
              <div className="field">
                <select
                  value={color.lutId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    const s = useEditor.getState();
                    s.beginGesture();
                    setColor({ lutId: id, lutMix: color.lutMix ?? 1 });
                    s.endGesture();
                  }}
                >
                  <option value="">None</option>
                  {lutChoices(luts).map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={12} /> Import .cube
                </button>
                <span className="hint" style={{ flex: 1 }}>
                  {lutLabel(luts, color.lutId)}
                </span>
              </div>
              <ColorSlider
                label="Mix"
                value={(color.lutMix ?? 1) * 100}
                min={0}
                max={100}
                step={1}
                onChange={(v) => setColor({ lutMix: v / 100 })}
              />
            </div>
          </div>

          <div className="section color-card">
            <div className="section-head">
              <Icon name="dial" size={11} />
              <span>Primary wheels</span>
            </div>
            <div className="section-body">
              <div className="wheel-grid">
                <Wheel
                  label="Lift"
                  wheel={lift}
                  onChange={(w) => setColor({ lift: w })}
                  onStart={() => useEditor.getState().beginGesture()}
                  onEnd={() => useEditor.getState().endGesture()}
                />
                <Wheel
                  label="Gamma"
                  wheel={gamma}
                  onChange={(w) => setColor({ gamma: w })}
                  onStart={() => useEditor.getState().beginGesture()}
                  onEnd={() => useEditor.getState().endGesture()}
                />
                <Wheel
                  label="Gain"
                  wheel={gain}
                  onChange={(w) => setColor({ gain: w })}
                  onStart={() => useEditor.getState().beginGesture()}
                  onEnd={() => useEditor.getState().endGesture()}
                />
              </div>
              <div className="hint">Lift shadows, shape midtones with gamma, and set highlight colour with gain.</div>
            </div>
          </div>

          <div className="section color-card">
            <div className="section-head">
              <Icon name="gauge" size={11} />
              <span>Curves</span>
            </div>
            <div className="section-body">
              <CurveEditor points={color.curve ?? CURVE_DEFAULTS} onChange={(points) => setColor({ curve: points })} />
            </div>
          </div>

          <div className="section color-card">
            <div className="section-head">
              <Icon name="sliders" size={11} />
              <span>Basic</span>
            </div>
            <div className="section-body">
              <ColorSlider label="Exposure" value={color.brightness} min={-100} max={100} step={1} onChange={(v) => setColor({ brightness: v })} />
              <ColorSlider label="Contrast" value={color.contrast} min={-100} max={100} step={1} onChange={(v) => setColor({ contrast: v })} />
              <ColorSlider label="Saturation" value={color.saturation} min={-100} max={100} step={1} onChange={(v) => setColor({ saturation: v })} />
              <ColorSlider label="Temperature" value={color.temperature} min={-100} max={100} step={1} onChange={(v) => setColor({ temperature: v })} />
              <ColorSlider label="Hue" value={color.hue} min={-180} max={180} step={1} onChange={(v) => setColor({ hue: v })} />
              <ColorSlider label="Vignette" value={color.vignette} min={0} max={100} step={1} onChange={(v) => setColor({ vignette: v })} />
              <ColorSlider label="Blur" value={color.blur} min={0} max={20} step={0.1} onChange={(v) => setColor({ blur: v })} />
            </div>
          </div>

          <div className="section color-card">
            <div className="section-head">
              <Icon name="sliders" size={11} />
              <span>HSL qualifier</span>
            </div>
            <div className="section-body">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={qualifier.enabled}
                  onChange={(e) => setColor({ qualifier: { ...qualifier, enabled: e.target.checked } })}
                />
                Restrict the grade to a colour range
              </label>
              <ColorSlider label="Hue" value={qualifier.hue * 360} min={0} max={360} step={1} onChange={(v) => setColor({ qualifier: { ...qualifier, hue: v / 360 } })} />
              <ColorSlider label="Range" value={qualifier.hueRange * 360} min={0} max={180} step={1} onChange={(v) => setColor({ qualifier: { ...qualifier, hueRange: v / 360 } })} />
              <ColorSlider label="Sat min" value={qualifier.satMin * 100} min={0} max={100} step={1} onChange={(v) => setColor({ qualifier: { ...qualifier, satMin: v / 100 } })} />
              <ColorSlider label="Sat max" value={qualifier.satMax * 100} min={0} max={100} step={1} onChange={(v) => setColor({ qualifier: { ...qualifier, satMax: v / 100 } })} />
              <ColorSlider label="Luma min" value={qualifier.lumMin * 100} min={0} max={100} step={1} onChange={(v) => setColor({ qualifier: { ...qualifier, lumMin: v / 100 } })} />
              <ColorSlider label="Luma max" value={qualifier.lumMax * 100} min={0} max={100} step={1} onChange={(v) => setColor({ qualifier: { ...qualifier, lumMax: v / 100 } })} />
              <ColorSlider label="Softness" value={qualifier.softness * 100} min={0} max={100} step={1} onChange={(v) => setColor({ qualifier: { ...qualifier, softness: v / 100 } })} />
              <label className="toggle-row">
                <input type="checkbox" checked={qualifier.invert} onChange={(e) => setColor({ qualifier: { ...qualifier, invert: e.target.checked } })} />
                Invert qualifier
              </label>
            </div>
          </div>

          <div className="section color-card">
            <div className="section-head">
              <Icon name="layers" size={11} />
              <span>Power window</span>
            </div>
            <div className="section-body">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={powerWindow.enabled}
                  onChange={(e) => setColor({ window: { ...powerWindow, enabled: e.target.checked } })}
                />
                Limit the grade to a shape
              </label>
              <div className="field">
                <label>Shape</label>
                <select value={powerWindow.shape} onChange={(e) => setColor({ window: { ...powerWindow, shape: e.target.value as 'ellipse' | 'rect' } })}>
                  <option value="ellipse">Ellipse</option>
                  <option value="rect">Rectangle</option>
                </select>
              </div>
              <ColorSlider label="Centre X" value={powerWindow.cx * 100} min={0} max={100} step={1} onChange={(v) => setColor({ window: { ...powerWindow, cx: v / 100 } })} />
              <ColorSlider label="Centre Y" value={powerWindow.cy * 100} min={0} max={100} step={1} onChange={(v) => setColor({ window: { ...powerWindow, cy: v / 100 } })} />
              <ColorSlider label="Width" value={powerWindow.width * 100} min={2} max={100} step={1} onChange={(v) => setColor({ window: { ...powerWindow, width: v / 100 } })} />
              <ColorSlider label="Height" value={powerWindow.height * 100} min={2} max={100} step={1} onChange={(v) => setColor({ window: { ...powerWindow, height: v / 100 } })} />
              <ColorSlider label="Feather" value={powerWindow.feather * 100} min={0} max={100} step={1} onChange={(v) => setColor({ window: { ...powerWindow, feather: v / 100 } })} />
              <label className="toggle-row">
                <input type="checkbox" checked={powerWindow.invert} onChange={(e) => setColor({ window: { ...powerWindow, invert: e.target.checked } })} />
                Invert window
              </label>
            </div>
          </div>

          <div className="hint">
            The viewer bypass only affects preview; exports always use the full grade. Qualifier and power window restrict the primary grade and LUT, and are baked into exports.
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".cube,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importLut(file);
            }}
          />
        </div>
      </div>
    );
  }
}
