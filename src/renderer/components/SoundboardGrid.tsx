import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { Profile, Sound } from '@shared/types';
import { SoundCard } from './SoundCard';
import { SoundRow } from './SoundRow';
import { UrlImportModal } from './UrlImportModal';
import { TrimEditor } from './TrimEditor';
import { useStore } from '../state/store';
import { validateSoundFile } from '../audio/validate';
import { confirmDialog } from './confirm';
import { Button } from './Button';

type Props = {
  profile: Profile;
  onPreview: (soundId: string) => void;
  onStopPreview: (soundId: string) => void;
};

const SOUND_DRAG_MIME = 'application/x-sb-sound-index';

export function SoundboardGrid({ profile, onPreview, onStopPreview }: Props) {
  const setProfiles = useStore((s) => s.setProfiles);
  const viewMode = useStore((s) => s.settings.viewMode);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState('');
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const trimSoundId = useStore((s) => s.trimSoundId);
  const setTrimSoundId = useStore((s) => s.setTrimSoundId);
  const dragDepth = useRef(0);

  const refreshProfiles = async () => {
    const refreshed = await window.api.getState();
    setProfiles(refreshed.profiles);
  };

  /**
   * Validate freshly-imported sounds. Sounds whose audio fails to decode are
   * removed from storage and reported via the global toast stack.
   */
  const validateAndPruneImports = async (imported: Sound[]) => {
    if (imported.length === 0) return;
    const failures: Array<{ name: string; reason: string }> = [];
    for (const sound of imported) {
      const result = await validateSoundFile(sound.filePath);
      if (!result.ok) {
        failures.push({ name: sound.name, reason: result.reason });
        try {
          await window.api.removeSound(profile.id, sound.id);
        } catch {
          /* ignore */
        }
      }
    }
    if (failures.length > 0) {
      const pushToast = useStore.getState().pushToast;
      pushToast({
        kind: 'error',
        message: `Skipped ${failures.length} unreadable file${
          failures.length === 1 ? '' : 's'
        }: ${failures.map((f) => f.name).join(', ')}`,
      });
      const refreshed = await window.api.getState();
      setProfiles(refreshed.profiles);
    }
  };
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setQuery('');
  }, [profile.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profile.sounds.map((s, i) => ({ sound: s, index: i }));
    return profile.sounds
      .map((sound, index) => ({ sound, index }))
      .filter(({ sound }) => sound.name.toLowerCase().includes(q));
  }, [profile.sounds, query]);

  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  const onGridDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (!isFileDrag(e)) return;
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onGridDragLeave = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onGridDragOver = (e: DragEvent) => e.preventDefault();
  const onGridDrop = async (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => !!p);
    if (paths.length === 0) return;
    try {
      const imported = await window.api.importSoundsByPath(profile.id, paths);
      const refreshed = await window.api.getState();
      setProfiles(refreshed.profiles);
      await validateAndPruneImports(imported);
    } catch (err) {
      useStore.getState().pushToast({
        kind: 'error',
        message: `Couldn't import files: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const onAddClick = async () => {
    try {
      const imported = await window.api.importSoundsDialog(profile.id);
      const refreshed = await window.api.getState();
      setProfiles(refreshed.profiles);
      await validateAndPruneImports(imported);
    } catch (err) {
      useStore.getState().pushToast({
        kind: 'error',
        message: `Couldn't import files: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // --- Card drag-to-reorder handlers ---
  const reorderEnabled = query.trim().length === 0;

  const onCardDragStart = (idx: number, e: DragEvent<HTMLDivElement>) => {
    if (!reorderEnabled) {
      e.preventDefault();
      return;
    }
    // Don't hijack drags that originate on form controls or buttons —
    // the user is interacting with that control, not dragging the card.
    const target = e.target as HTMLElement | null;
    if (
      target &&
      target.closest(
        'input, select, textarea, button, [role="slider"], [contenteditable="true"]',
      )
    ) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(SOUND_DRAG_MIME, String(idx));
    setDraggingIndex(idx);
  };

  const onCardDragOver = (idx: number, e: DragEvent<HTMLDivElement>) => {
    if (isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (hoverIndex !== idx) setHoverIndex(idx);
  };

  const onCardDragLeave = (idx: number) => {
    setHoverIndex((cur) => (cur === idx ? null : cur));
  };

  const onCardDrop = async (idx: number, e: DragEvent<HTMLDivElement>) => {
    if (isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData(SOUND_DRAG_MIME);
    setHoverIndex(null);
    setDraggingIndex(null);
    if (!raw) return;
    const from = parseInt(raw, 10);
    if (Number.isNaN(from) || from === idx) return;
    const next = await window.api.reorderSounds(profile.id, from, idx);
    setProfiles(next);
  };

  const onCardDragEnd = () => {
    setDraggingIndex(null);
    setHoverIndex(null);
  };

  const hasSounds = profile.sounds.length > 0;

  return (
    <div
      className={`min-h-full rounded-lg p-3 transition ${
        dragOver ? 'bg-surface2/40 outline outline-2 outline-dashed outline-accent' : ''
      }`}
      onDragEnter={onGridDragEnter}
      onDragLeave={onGridDragLeave}
      onDragOver={onGridDragOver}
      onDrop={onGridDrop}
    >
      {!hasSounds ? (
        <div className="h-64 flex flex-col items-center justify-center text-muted gap-3">
          <div className="text-lg">No sounds in “{profile.name}”</div>
          <div className="text-sm">Drag audio files here, or</div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void onAddClick()}>
              Add sounds
            </Button>
            <Button onClick={() => setUrlModalOpen(true)}>From URL…</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Button variant="primary" onClick={() => void onAddClick()}>
              + Add sounds
            </Button>
            <Button
              onClick={() => setUrlModalOpen(true)}
              title="Download from YouTube, Twitch, SoundCloud, …"
            >
              + From URL
            </Button>
            <div className="relative flex-1 max-w-md ml-2">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQuery('');
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Search sounds…  (Ctrl+F)"
                className="w-full bg-surface2 border border-border rounded pl-3 pr-8 py-1.5 text-sm placeholder:text-muted focus:outline-none focus:border-accent"
              />
              {query && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text text-sm"
                  onClick={() => setQuery('')}
                  title="Clear"
                  type="button"
                >
                  ×
                </button>
              )}
            </div>
            <span className="text-xs text-muted ml-auto">
              {query
                ? `${filtered.length} of ${profile.sounds.length}`
                : `${profile.sounds.length} sound${profile.sounds.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="text-muted text-sm">No sounds match “{query}”.</div>
              <button
                className="px-3 py-1 rounded bg-surface2 hover:bg-border text-sm"
                onClick={() => setQuery('')}
              >
                Clear search
              </button>
            </div>
          ) : (
            <div
              className={
                viewMode === 'list'
                  ? 'flex flex-col gap-2'
                  : 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3'
              }
            >
              {filtered.map(({ sound, index }) => {
                const isHovered =
                  reorderEnabled && hoverIndex === index && draggingIndex !== index;
                const isSource = draggingIndex === index;
                const sharedProps = {
                  profileId: profile.id,
                  sound,
                  onPreview: () => onPreview(sound.id),
                  onStopPreview: () => onStopPreview(sound.id),
                  onChange: async (patch: Partial<Sound>) => {
                    const next = await window.api.updateSound(
                      profile.id,
                      sound.id,
                      patch,
                    );
                    setProfiles(next);
                  },
                  onRemove: async () => {
                    const ok = await confirmDialog({
                      title: 'Remove this sound?',
                      message: `“${sound.name}” will be removed from this soundboard.`,
                      confirmLabel: 'Remove',
                      tone: 'danger',
                    });
                    if (!ok) return;
                    const snapshot = { ...sound };
                    const originalIndex = index;
                    const next = await window.api.removeSound(profile.id, sound.id);
                    setProfiles(next);
                    const { pushToast } = useStore.getState();
                    pushToast({
                      kind: 'info',
                      message: `Removed “${snapshot.name}”`,
                      autoDismissMs: 6000,
                      actions: [
                        {
                          label: 'Undo',
                          onClick: () => {
                            void (async () => {
                              try {
                                const restored = await window.api.restoreSound(
                                  profile.id,
                                  snapshot,
                                  originalIndex,
                                );
                                setProfiles(restored);
                              } catch (err) {
                                useStore.getState().pushToast({
                                  kind: 'error',
                                  message: `Couldn't restore sound: ${
                                    err instanceof Error ? err.message : String(err)
                                  }`,
                                });
                              }
                            })();
                          },
                        },
                      ],
                    });
                  },
                  onTrim: () => setTrimSoundId(sound.id),
                };
                return (
                  <DraggableCardWrapper
                    key={sound.id}
                    reorderEnabled={reorderEnabled}
                    isHovered={isHovered}
                    isSource={isSource}
                    onDragStart={(e) => onCardDragStart(index, e)}
                    onDragOver={(e) => onCardDragOver(index, e)}
                    onDragLeave={() => onCardDragLeave(index)}
                    onDrop={(e) => void onCardDrop(index, e)}
                    onDragEnd={onCardDragEnd}
                  >
                    {viewMode === 'list' ? (
                      <SoundRow {...sharedProps} />
                    ) : (
                      <SoundCard {...sharedProps} />
                    )}
                  </DraggableCardWrapper>
                );
              })}
            </div>
          )}
        </>
      )}

      {urlModalOpen && (
        <UrlImportModal
          profileId={profile.id}
          onClose={() => setUrlModalOpen(false)}
          onImported={async (sound: Sound) => {
            await refreshProfiles();
            setTrimSoundId(sound.id);
          }}
        />
      )}

      {/* trim editor mount, below */}
      {trimSoundId && (() => {
        const target = profile.sounds.find((s) => s.id === trimSoundId);
        if (!target) {
          // Could happen if the sound was deleted while the editor was queued.
          setTrimSoundId(null);
          return null;
        }
        return (
          <TrimEditor
            key={target.filePath}
            sourceFilePath={target.filePath}
            sourceName={target.name}
            onClose={() => setTrimSoundId(null)}
            onSave={async (bytes) => {
              const next = await window.api.replaceSoundAudio(
                profile.id,
                target.id,
                bytes,
                'wav',
              );
              setProfiles(next);
              setTrimSoundId(null);
            }}
          />
        );
      })()}
    </div>
  );
}

// Wraps each card/row and manages HTML5 drag-and-drop. Critical detail: the
// draggable attribute is toggled OFF synchronously in mouseDownCapture when the
// click originates on a form control, so dragging a slider/select/button never
// initiates a card reorder. The attribute is restored on the next mouseup.
type DraggableWrapperProps = {
  reorderEnabled: boolean;
  isHovered: boolean;
  isSource: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  children: ReactNode;
};

function DraggableCardWrapper(props: DraggableWrapperProps) {
  const {
    reorderEnabled,
    isHovered,
    isSource,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
    children,
  } = props;
  const ref = useRef<HTMLDivElement>(null);

  const onMouseDownCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!reorderEnabled) return;
    const target = e.target as HTMLElement | null;
    if (
      !target ||
      !target.closest(
        'input, select, textarea, button, [role="slider"], [contenteditable="true"]',
      )
    ) {
      return;
    }
    // The click is on a form control — disable drag for this gesture only.
    const node = ref.current;
    if (!node) return;
    node.draggable = false;
    const restore = () => {
      if (ref.current) ref.current.draggable = reorderEnabled;
      window.removeEventListener('mouseup', restore);
    };
    window.addEventListener('mouseup', restore, { once: true });
  };

  const cursorClass = !reorderEnabled
    ? ''
    : isSource
      ? 'cursor-grabbing'
      : 'cursor-grab';

  return (
    <div
      ref={ref}
      draggable={reorderEnabled}
      onMouseDownCapture={onMouseDownCapture}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title={reorderEnabled ? 'Drag to reorder' : undefined}
      className={`relative rounded-lg transition ${cursorClass} ${
        isSource ? 'opacity-40' : ''
      } ${isHovered ? 'outline outline-2 outline-accent outline-offset-1' : ''}`}
    >
      {children}
    </div>
  );
}
