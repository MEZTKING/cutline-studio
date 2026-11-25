import { useEditor } from '../state/store';
import { formatDuration } from '../core/model';
import { preferredTrack } from '../core/placement';
import { defaultInsertStart } from '../core/placement';
import type { MediaAsset } from '../core/types';
import { Icon } from './icons';

export function MediaBin({ showHead = true, onImport, onRelink }: { showHead?: boolean; onImport: () => void; onRelink?: () => void }) {
  const assets = useEditor((s) => s.assets);
  const order = useEditor((s) => s.assetOrder);
  const addClipToTrack = useEditor((s) => s.addClipToTrack);
  const removeAsset = useEditor((s) => s.removeAsset);
  const notify = useEditor((s) => s.notify);
  const list = order.map((id) => assets[id]).filter(Boolean);
  const offlineCount = list.filter((a) => a.offline).length;

  const addToTimeline = (asset: MediaAsset, mode: 'free' | 'insert' | 'overwrite' = 'free') => {
    const state = useEditor.getState();
    const track = preferredTrack(state.project, asset.kind, state.selection.trackId);
    if (!track) {
      notify(`Add a ${asset.kind === 'audio' ? 'audio' : 'video'} track first.`, 'error');
      return;
    }
    const duration = asset.kind === 'image' ? 5 : asset.duration;
    if (mode === 'insert') {
      state.insertClipToTrack(track.id, asset, state.playhead, duration);
      notify(`Inserted “${asset.name}” on ${track.name}`, 'success');
    } else if (mode === 'overwrite') {
      state.overwriteClipToTrack(track.id, asset, state.playhead, duration);
      notify(`Overwrote “${asset.name}” on ${track.name}`, 'success');
    } else {
      const start = defaultInsertStart(track, state.playhead, duration);
      addClipToTrack(track.id, asset, start, duration);
      notify(`Placed “${asset.name}” on ${track.name}`, 'success');
    }
  };

  return (
    <>
      {showHead && (
        <div className="panel-head">
          <span>Media</span>
          <span className="count">{list.length} items</span>
        </div>
      )}

      <div className="panel-scroll">
        {list.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Icon name="film" size={24} />
            </div>
            <h3>Your media goes here</h3>
            <p>Import video, audio, or stills. On phones everything stays on-device — nothing is uploaded.</p>
            <button className="btn primary sm" onClick={onImport}>
              <Icon name="upload" size={14} /> Import media
            </button>
          </div>
        ) : (
          <>
            {offlineCount > 0 && (
              <div className="offline-banner">
                <span>
                  <Icon name="flag" size={13} /> {offlineCount} media file{offlineCount === 1 ? '' : 's'} offline
                </span>
                {onRelink && (
                  <button className="btn sm" onClick={onRelink}>
                    <Icon name="link" size={12} /> Relink…
                  </button>
                )}
              </div>
            )}
            <div className="asset-grid">
              {list.map((asset) => (
                <div
                  key={asset.id}
                  className={`asset-card ${asset.offline ? 'offline' : ''}`}
                  draggable={!asset.offline}
                  onDragStart={(e) => {
                    if (asset.offline) return;
                    e.dataTransfer.setData('text/x-cutline-asset', asset.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={(e) => {
                    if (asset.offline) {
                      notify(`“${asset.name}” is offline. Use Relink to locate it.`, 'error');
                      return;
                    }
                    addToTimeline(asset, e.shiftKey ? 'insert' : e.ctrlKey || e.metaKey ? 'overwrite' : 'free');
                  }}
                  title={asset.offline ? `${asset.name} — offline` : `Add ${asset.name} at the playhead · Shift inserts · Ctrl/Cmd overwrites`}
                >
                  <div className="asset-thumb" style={asset.thumbnail ? { backgroundImage: `url(${asset.thumbnail})` } : undefined}>
                    {!asset.thumbnail && <Icon name={asset.kind === 'audio' ? 'music' : asset.kind === 'image' ? 'image' : 'film'} size={18} />}
                    <span className="asset-badge">
                      <Icon name={asset.kind === 'audio' ? 'music' : asset.kind === 'image' ? 'image' : 'film'} size={9} />
                      {asset.kind === 'video' ? 'VID' : asset.kind === 'audio' ? 'AUD' : 'IMG'}
                    </span>
                    {asset.offline && <span className="asset-offline">OFFLINE</span>}
                    <span className="asset-dur">{formatDuration(asset.duration)}</span>
                    <div className="asset-add">
                      <Icon name="plus" size={10} /> Add to timeline
                    </div>
                  </div>
                  <div className="asset-meta">
                    <div className="asset-name">{asset.name}</div>
                  </div>
                  <button
                    className="asset-del"
                    title="Remove from project"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove “${asset.name}” and any clips using it?`)) removeAsset(asset.id);
                    }}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
              ))}
            </div>
            <div className="drop-hint">
              Tap a card to insert it at the playhead, or drag it onto the timeline.
            </div>
          </>
        )}
      </div>

      <div className="bin-footer">
        <button className="btn sm" onClick={onImport} style={{ flex: 1 }}>
          <Icon name="plus" size={13} /> Import
        </button>
        <button
          className="btn sm icon"
          title="Add every unused asset to the timeline"
          disabled={list.length === 0}
          onClick={() => {
            const state = useEditor.getState();
            let v = 0;
            let a = 0;
            for (const asset of list) {
              const track = preferredTrack(useEditor.getState().project, asset.kind);
              if (!track) continue;
              const duration = asset.kind === 'image' ? 5 : asset.duration;
              if (asset.kind === 'audio') {
                useEditor.getState().addClipToTrack(track.id, asset, a, duration);
                a += duration;
              } else {
                useEditor.getState().addClipToTrack(track.id, asset, v, duration);
                v += duration;
              }
            }
            state.notify('Added all media to the timeline', 'success');
          }}
        >
          <Icon name="layers" size={13} />
        </button>
      </div>
    </>
  );
}