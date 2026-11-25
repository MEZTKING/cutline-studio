import { useEffect, useState, type ReactNode } from 'react';
import {
  findClip,
  formatDuration,
  isAnimated,
  keyframeAt,
  previousClip,
  propValue,
  sourceDuration,
  upsertKeyframe,
} from '../core/model';
import { COLOR_DEFAULTS, TRANSITION_LABEL, type AnimatableProp, type ColorGrade, type TransitionType } from '../core/types';
import { useEditor } from '../state/store';
import { Icon } from './icons';

function useSlowPlayhead(): number {
  const [t, setT] = useState(() => useEditor.getState().playhead);
  useEffect(() => {
    let last = 0;
    return useEditor.subscribe((s) => {
      const now = performance.now();
      if (now - last > 120) {
        last = now;
        setT(s.playhead);
      }
    });
  }, []);
  return t;
}

function Section({
  title,
  children,
  defaultOpen = true,
  extra,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <div className={`section-head ${open ? '' : 'collapsed'}`} onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron" size={11} className="chev" />
        <span>{title}</span>
        {extra && <span className="head-extra" onClick={(e) => e.stopPropagation()}>{extra}</span>}
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

function formatNumber(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0';
}

function NumberField({
  value,
  min = -1_000_000,
  max = 1_000_000,
  step = 1,
  className,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(() => formatNumber(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(formatNumber(value));
  }, [value, editing]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  return (
    <input
      className={className}
      type="number"
      step={step}
      value={text}
      onFocus={(e) => {
        setEditing(true);
        setText(formatNumber(value));
        useEditor.getState().beginGesture();
        e.currentTarget.select();
      }}
      onBlur={() => {
        const n = parseFloat(text);
        if (Number.isFinite(n)) onChange(clamp(n));
        setEditing(false);
        useEditor.getState().endGesture();
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) onChange(clamp(n));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function ParamRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  kf,
  kfLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  kf?: 'none' | 'off' | 'on' | 'animated';
  kfLabel?: string;
}) {
  const begin = () => useEditor.getState().beginGesture();
  const end = () => useEditor.getState().endGesture();
  return (
    <div className="param">
      <span className="param-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onPointerDown={begin}
        onPointerUp={end}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <NumberField className="num" value={value} min={min} max={max} step={step} onChange={onChange} />
      {kf && kf !== 'none' ? (
        <button
          className={`kf ${kf}`}
          title={kfLabel ?? 'Toggle keyframe at playhead'}
          onClick={() => {
            const state = useEditor.getState();
            if (state.selection.clipId) state.toggleKeyframe(state.selection.clipId, labelToProp(label));
          }}
        >
          <Icon name="diamond" size={10} />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

const PROP_BY_LABEL: Record<string, AnimatableProp> = {
  'Position X': 'x',
  'Position Y': 'y',
  Scale: 'scale',
  Rotation: 'rotation',
  Opacity: 'opacity',
  Volume: 'volume',
};

function labelToProp(label: string): AnimatableProp {
  return PROP_BY_LABEL[label] ?? 'opacity';
}

const RESOLUTIONS: { label: string; w: number; h: number }[] = [
  { label: '1080p · 16:9', w: 1920, h: 1080 },
  { label: '4K · 16:9', w: 3840, h: 2160 },
  { label: '720p · 16:9', w: 1280, h: 720 },
  { label: 'Vertical · 9:16', w: 1080, h: 1920 },
  { label: 'Square · 1:1', w: 1080, h: 1080 },
  { label: 'Cinema · 2.39:1', w: 2048, h: 858 },
];

export function Inspector({ showHead = true }: { showHead?: boolean }) {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const found = selection.clipId ? findClip(project, selection.clipId) : null;

  return (
    <>
      {showHead && (
        <div className="panel-head">
          <span>Inspector</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="count">{found ? 'Clip' : 'Project'}</span>
            <button
              className="btn ghost icon sm"
              title="Colour page"
              onClick={() => {
                const state = useEditor.getState();
                state.setWorkspace('color');
                state.setMobilePanel('color');
              }}
            >
              <Icon name="palette" size={13} />
            </button>
          </span>
        </div>
      )}
      <div className="panel-scroll">
        <div className="inspector-scroll">
          {found ? (
            <ClipPanel clipId={found.clip.id} />
          ) : (
            <ProjectPanel />
          )}
        </div>
      </div>
    </>
  );
}

function ClipPanel({ clipId }: { clipId: string }) {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const found = findClip(project, clipId);
  const playhead = useSlowPlayhead();
  const livePatchClip = useEditor((s) => s.livePatchClip);

  if (!found) return <ProjectPanel />;
  const { clip, track } = found;
  const asset = assets[clip.assetId];
  const localT = Math.max(0, Math.min(clip.duration, playhead - clip.start));
  const animated = (p: AnimatableProp) => isAnimated(clip, p);
  const kfState = (p: AnimatableProp): 'off' | 'on' | 'animated' => {
    if (keyframeAt(clip, p, localT)) return 'on';
    return animated(p) ? 'animated' : 'off';
  };
  const value = (p: AnimatableProp) => propValue(clip, p, localT);

  const setProp = (p: AnimatableProp, v: number) => {
    if (animated(p)) {
      const keyframes = upsertKeyframe(clip, p, localT, v);
      livePatchClip(clip.id, { keyframes });
    } else if (p === 'volume') {
      livePatchClip(clip.id, { volume: v });
    } else {
      livePatchClip(clip.id, { transform: { ...clip.transform, [p]: v } });
    }
  };

  const setColor = (key: keyof ColorGrade, v: number) => {
    livePatchClip(clip.id, { color: { ...clip.color, [key]: v } });
  };

  const durationLimit = asset ? sourceDuration(clip, asset) : Number.POSITIVE_INFINITY;
  const prev = previousClip(track, clip);

  return (
    <>
      <div className="clip-card">
        <div
          className="clip-card-thumb"
          style={asset?.thumbnail ? { backgroundImage: `url(${asset.thumbnail})`, display: 'grid', placeItems: 'center' } : { display: 'grid', placeItems: 'center', color: 'var(--warn)' }}
        >
          {!asset?.thumbnail && <Icon name={clip.text ? 'text' : 'film'} size={14} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="clip-card-name">{clip.text ? clip.text.content.split('\n')[0] || (clip.text.caption ? 'Caption' : 'Title') : clip.name}</div>
          <div className="clip-card-sub">
            {track.name} · {clip.text ? (clip.text.caption ? 'Caption' : 'Title') : asset ? `${asset.width}×${asset.height}` : '—'} · {formatDuration(clip.duration)}
          </div>
        </div>
        <button
          className="btn ghost icon sm"
          title="Delete clip"
          onClick={() => useEditor.getState().deleteClip(clip.id)}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>

      <div className="actions">
        <button className="btn sm" onClick={() => useEditor.getState().split()}>
          <Icon name="scissors" size={12} /> Split
        </button>
        <button className="btn sm" onClick={() => useEditor.getState().deleteClip(clip.id, false)}>
          Delete
        </button>
        <button className="btn sm" onClick={() => useEditor.getState().deleteClip(clip.id, true)}>
          Ripple delete
        </button>
        <button className="btn sm" onClick={() => useEditor.getState().duplicateClip(clip.id)}>
          <Icon name="layers" size={12} /> Duplicate
        </button>
      </div>

      {clip.text && (
        <Section title={clip.text.caption ? 'Caption' : 'Title'} defaultOpen>
          <div className="field">
            <label>Text</label>
            <textarea
              rows={3}
              value={clip.text.content}
              onFocus={() => useEditor.getState().beginGesture()}
              onBlur={() => useEditor.getState().endGesture()}
              onChange={(e) => livePatchClip(clip.id, { text: { ...clip.text!, content: e.target.value } })}
            />
          </div>
          {clip.text.caption && (
            <div className="field">
              <label>Position</label>
              <div className="seg">
                {(
                  [
                    ['Bottom', 0.355],
                    ['Middle', 0],
                    ['Top', -0.355],
                  ] as const
                ).map(([label, y]) => (
                  <button
                    key={label}
                    className={Math.abs(clip.transform.y - y) < 0.02 ? 'on' : ''}
                    onClick={() => {
                      const st = useEditor.getState();
                      st.beginGesture();
                      st.livePatchClip(clip.id, { transform: { ...clip.transform, y } });
                      st.endGesture();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label>Alignment</label>
            <div className="seg">
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  className={clip.text!.align === align ? 'on' : ''}
                  onClick={() => {
                    const s = useEditor.getState();
                    s.beginGesture();
                    s.livePatchClip(clip.id, { text: { ...clip.text!, align } });
                    s.endGesture();
                  }}
                >
                  {align}
                </button>
              ))}
            </div>
          </div>
          <ParamRow
            label="Size"
            value={clip.text.size}
            min={2}
            max={30}
            step={0.5}
            kf="none"
            onChange={(v) => livePatchClip(clip.id, { text: { ...clip.text!, size: v } })}
          />
          <ParamRow
            label="Backdrop"
            value={clip.text.backgroundOpacity * 100}
            min={0}
            max={100}
            step={1}
            kf="none"
            onChange={(v) => livePatchClip(clip.id, { text: { ...clip.text!, backgroundOpacity: v / 100 } })}
          />
          <ParamRow
            label="Padding"
            value={clip.text.padding}
            min={0}
            max={10}
            step={0.1}
            kf="none"
            onChange={(v) => livePatchClip(clip.id, { text: { ...clip.text!, padding: v } })}
          />
          <div className="field">
            <label>Colors</label>
            <div className="swatch-row">
              <input
                type="color"
                value={clip.text.color}
                title="Text color"
                onChange={(e) => livePatchClip(clip.id, { text: { ...clip.text!, color: e.target.value } })}
              />
              <span>Text</span>
              <input
                type="color"
                value={clip.text.background}
                title="Backdrop color"
                onChange={(e) => livePatchClip(clip.id, { text: { ...clip.text!, background: e.target.value } })}
              />
              <span>Backdrop</span>
            </div>
          </div>
          <div className="row">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={clip.text.bold}
                onChange={(e) => livePatchClip(clip.id, { text: { ...clip.text!, bold: e.target.checked } })}
              />
              Bold
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={clip.text.shadow}
                onChange={(e) => livePatchClip(clip.id, { text: { ...clip.text!, shadow: e.target.checked } })}
              />
              Shadow
            </label>
          </div>
          <div className="hint">Drag the clip on the timeline to change when it appears. Position and scale live under Transform.</div>
        </Section>
      )}

      <Section title="Timing" defaultOpen={false}>
        <div className="row">
          <div className="field grow">
            <label>Start (s)</label>
            <NumberField value={clip.start} min={0} max={36000} step={0.1} onChange={(v) => livePatchClip(clip.id, { start: v })} />
          </div>
          <div className="field grow">
            <label>Duration (s)</label>
            <NumberField
              value={clip.duration}
              min={0.1}
              max={Number.isFinite(durationLimit) ? Math.max(0.1, durationLimit) : 36000}
              step={0.1}
              onChange={(v) => livePatchClip(clip.id, { duration: v })}
            />
          </div>
        </div>
        <div className="hint">
          {clip.text
            ? 'Titles are resolution-independent — they stay sharp at any export size.'
            : `Source in-point ${clip.inPoint.toFixed(2)}s · speed ${clip.speed}× · ${
                Number.isFinite(durationLimit) ? `${durationLimit.toFixed(1)}s left in source` : 'still image'
              }`}
        </div>
      </Section>

      {asset?.kind !== 'audio' && (
        <Section
          title="Transform"
          defaultOpen
          extra={
            <button
              className="btn ghost icon sm"
              title="Reset transform"
              onClick={() =>
                livePatchClip(clip.id, {
                  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
                  keyframes: Object.fromEntries(Object.entries(clip.keyframes).filter(([k]) => !['x', 'y', 'scale', 'rotation', 'opacity'].includes(k))),
                })
              }
            >
              <Icon name="reset" size={12} />
            </button>
          }
        >
          <ParamRow label="Position X" value={value('x') * 100} min={-100} max={100} step={0.5} kf={kfState('x')} onChange={(v) => setProp('x', v / 100)} />
          <ParamRow label="Position Y" value={value('y') * 100} min={-100} max={100} step={0.5} kf={kfState('y')} onChange={(v) => setProp('y', v / 100)} />
          <ParamRow label="Scale" value={value('scale') * 100} min={5} max={400} step={1} kf={kfState('scale')} onChange={(v) => setProp('scale', v / 100)} />
          <ParamRow label="Rotation" value={value('rotation')} min={-180} max={180} step={1} kf={kfState('rotation')} onChange={(v) => setProp('rotation', v)} />
          <ParamRow label="Opacity" value={value('opacity') * 100} min={0} max={100} step={1} kf={kfState('opacity')} onChange={(v) => setProp('opacity', v / 100)} />
          {!clip.text && (
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={Boolean(clip.fill)}
                onChange={(e) => {
                  const s = useEditor.getState();
                  s.beginGesture();
                  s.livePatchClip(clip.id, { fill: e.target.checked });
                  s.endGesture();
                }}
              />
              Fill frame (crop to cover instead of letterbox)
            </label>
          )}
          <div className="hint">Diamond adds a keyframe at the playhead. Animated properties ease in and out.</div>
        </Section>
      )}

      {!clip.text && asset?.kind !== 'audio' && (
        <Section
          title="Color"
          defaultOpen={false}
          extra={
            <button
              className="btn ghost icon sm"
              title="Reset color"
              onClick={() => livePatchClip(clip.id, { color: { ...COLOR_DEFAULTS } })}
            >
              <Icon name="reset" size={12} />
            </button>
          }
        >
          <ParamRow label="Exposure" value={clip.color.brightness} min={-100} max={100} step={1} onChange={(v) => setColor('brightness', v)} />
          <ParamRow label="Contrast" value={clip.color.contrast} min={-100} max={100} step={1} onChange={(v) => setColor('contrast', v)} />
          <ParamRow label="Saturation" value={clip.color.saturation} min={-100} max={100} step={1} onChange={(v) => setColor('saturation', v)} />
          <ParamRow label="Temperature" value={clip.color.temperature} min={-100} max={100} step={1} onChange={(v) => setColor('temperature', v)} />
          <ParamRow label="Hue" value={clip.color.hue} min={-180} max={180} step={1} onChange={(v) => setColor('hue', v)} />
          <ParamRow label="Blur" value={clip.color.blur} min={0} max={20} step={0.1} onChange={(v) => setColor('blur', v)} />
          <ParamRow label="Vignette" value={clip.color.vignette} min={0} max={100} step={1} onChange={(v) => setColor('vignette', v)} />
          <div className="hint">Grade is baked into exports exactly as you see it in the preview.</div>
        </Section>
      )}

      {!clip.text && (
      <Section title="Audio & Speed" defaultOpen={asset?.kind === 'audio'}>
        {asset?.kind !== 'image' && (
          <>
            <ParamRow label="Volume" value={value('volume') * 100} min={0} max={200} step={1} kf={kfState('volume')} onChange={(v) => setProp('volume', v / 100)} />
            <ParamRow label="Fade in" value={clip.fadeIn} min={0} max={Math.min(10, clip.duration)} step={0.05} kf="none" onChange={(v) => livePatchClip(clip.id, { fadeIn: v })} />
            <ParamRow label="Fade out" value={clip.fadeOut} min={0} max={Math.min(10, clip.duration)} step={0.05} kf="none" onChange={(v) => livePatchClip(clip.id, { fadeOut: v })} />
          </>
        )}
        <ParamRow
          label="Speed"
          value={clip.speed}
          min={0.1}
          max={8}
          step={0.05}
          kf="none"
          onChange={(v) => livePatchClip(clip.id, { speed: v })}
        />
        <div className="hint">Speeding a clip shortens its on-timeline duration to fit the source.</div>
      </Section>
      )}

      <Section title="Transition" defaultOpen={Boolean(clip.transition)}>
        <div className="field">
          <label>Incoming transition</label>
          <select
            value={clip.transition?.type ?? ''}
            onChange={(e) => {
              const type = e.target.value as TransitionType | '';
              useEditor.getState().setTransition(clip.id, type || null, clip.transition?.duration ?? 0.6);
            }}
          >
            <option value="">None</option>
            {(Object.keys(TRANSITION_LABEL) as TransitionType[]).map((type) => (
              <option key={type} value={type}>
                {TRANSITION_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
        {clip.transition && (
          <ParamRow
            label="Duration"
            value={clip.transition.duration}
            min={0.1}
            max={3}
            step={0.05}
            kf="none"
            onChange={(v) =>
              livePatchClip(clip.id, {
                transition: { type: clip.transition!.type, duration: v },
              })
            }
          />
        )}
        {!prev && <div className="hint warn">Transitions blend into the clip immediately before this one. Add a clip to the left first.</div>}
        {prev && !clip.transition && <div className="hint">Pick a type to dissolve, wipe, or slide from “{prev.name}”.</div>}
      </Section>

      <Section title="Keyframes" defaultOpen={false}>
        {(['x', 'y', 'scale', 'rotation', 'opacity', 'volume'] as AnimatableProp[]).map((p) =>
          (clip.keyframes[p]?.length ?? 0) > 0 ? (
            <div key={p} className="row" style={{ justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-2)' }}>
              <span style={{ textTransform: 'capitalize' }}>{p}</span>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-3)' }}>
                {clip.keyframes[p]!.length} keys
              </span>
            </div>
          ) : null,
        )}
        {Object.keys(clip.keyframes).length === 0 && (
          <div className="hint">No keyframes yet. Tap a diamond next to Position, Scale, Rotation, Opacity, or Volume.</div>
        )}
      </Section>
    </>
  );
}

function ProjectPanel() {
  const project = useEditor((s) => s.project);
  const setProjectSettings = useEditor((s) => s.setProjectSettings);
  const [name, setName] = useState(project.name);

  useEffect(() => setName(project.name), [project.name]);

  const totalClips = project.tracks.reduce((n, t) => n + t.clips.length, 0);
  const presetKey = `${project.width}x${project.height}`;
  const preset = RESOLUTIONS.find((r) => `${r.w}x${r.h}` === presetKey);

  return (
    <div className="insp-empty">
      <div className="clip-card">
        <div className="clip-card-thumb" style={{ display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
          <Icon name="settings" size={16} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="clip-card-name">Project settings</div>
          <div className="clip-card-sub">
            {project.width}×{project.height} · {project.fps} fps
          </div>
        </div>
      </div>

      <Section title="Project">
        <div className="field">
          <label>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setProjectSettings({ name: e.target.value });
            }}
          />
        </div>
        <div className="field">
          <label>Canvas</label>
          <select
            value={preset ? presetKey : 'custom'}
            onChange={(e) => {
              const found = RESOLUTIONS.find((r) => `${r.w}x${r.h}` === e.target.value);
              if (found) setProjectSettings({ width: found.w, height: found.h });
            }}
          >
            {RESOLUTIONS.map((r) => (
              <option key={r.label} value={`${r.w}x${r.h}`}>
                {r.label}
              </option>
            ))}
            {!preset && <option value="custom">{`Custom · ${project.width}×${project.height}`}</option>}
          </select>
        </div>
        <div className="row">
          <div className="field grow">
            <label>Width</label>
            <NumberField value={project.width} min={16} max={7680} step={2} onChange={(v) => setProjectSettings({ width: Math.round(v) })} />
          </div>
          <div className="field grow">
            <label>Height</label>
            <NumberField value={project.height} min={16} max={7680} step={2} onChange={(v) => setProjectSettings({ height: Math.round(v) })} />
          </div>
        </div>
        <div className="field">
          <label>Frame rate</label>
          <select value={project.fps} onChange={(e) => setProjectSettings({ fps: Number(e.target.value) })}>
            {[23.976, 24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Reframe" defaultOpen={false}>
        <div className="hint">Turn landscape footage into 9:16, 4:5, or square with face-following keyframes.</div>
        <button className="btn sm" onClick={() => useEditor.getState().setReframeOpen(true)}>
          <Icon name="reframe" size={13} /> Auto-reframe…
        </button>
      </Section>

      <Section title="Captions" defaultOpen>
        <div className="hint">Generate subtitles on-device with Whisper, import an .srt, or add cues manually.</div>
        <button className="btn sm" onClick={() => useEditor.getState().setCaptionsOpen(true)}>
          <Icon name="captions" size={13} /> Open captions
        </button>
      </Section>

      <Section title="Stats" defaultOpen={false}>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--text-2)' }}>
          <span>Clips</span>
          <span>{totalClips}</span>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--text-2)' }}>
          <span>Tracks</span>
          <span>{project.tracks.length}</span>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--text-2)' }}>
          <span>Duration</span>
          <span>{formatDuration(project.tracks.flatMap((t) => t.clips).reduce((m, c) => Math.max(m, c.start + c.duration), 0))}</span>
        </div>
      </Section>

      <Section title="Shortcuts" defaultOpen={false}>
        <div className="tips" style={{ border: 'none', padding: 0 }}>
          <div><kbd>Space</kbd> play / pause</div>
          <div><kbd>S</kbd> split at playhead</div>
          <div><kbd>Del</kbd> delete · <kbd>Shift</kbd>+<kbd>Del</kbd> ripple</div>
          <div><kbd>←</kbd> <kbd>→</kbd> step a frame · <kbd>Shift</kbd> one second</div>
          <div><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo</div>
          <div><kbd>Ctrl</kbd>+wheel zoom the timeline</div>
        </div>
      </Section>

      <div className="actions" style={{ marginTop: 4 }}>
        <button
          className="btn sm"
          onClick={() => {
            if (confirm('Start a new project? The timeline clears, but your imported media stays in the bin.')) {
              const s = useEditor.getState();
              s.resetProject();
              s.setPlayhead(0);
              s.notify('New project started', 'success');
            }
          }}
        >
          <Icon name="plus" size={12} /> New project
        </button>
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        Your work autosaves to this device as you edit. Closing the tab or refreshing restores it.
      </div>
    </div>
  );
}