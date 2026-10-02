/**
 * Board view — columns by status, drag a card between them to move it through the
 * lifecycle.
 *
 * Only transitions that correspond to a real action are droppable. 'Draft' and 'Posted'
 * are read-only columns: there is no meaningful "un-draft", and a post already on X
 * cannot be dragged back. Attempting an invalid drop does nothing rather than silently
 * half-succeeding.
 *
 * Dropping into Approved goes through the same approve endpoint as the button, so the
 * gate's checks (non-empty body, a scheduled time, confirming it) all still apply — a
 * drag is not a back door around the approval rules.
 */
import { useMemo, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { MiniCard, BOARD_COLUMNS, labelCls, type QueuePost } from './queueShared';

export function PostQueueBoard({
  posts, conflictIds, onTransition, onOpen,
}: {
  posts: QueuePost[];
  conflictIds: Set<number>;
  /** target is one of the droppable board statuses. */
  onTransition: (id: number, target: string) => void;
  onOpen: (id: number) => void;
}) {
  // Ref as well as state: `dragover` fires before React re-renders from `dragstart`,
  // so a state-only check reads stale null, skips preventDefault, and the browser then
  // never fires `drop`. State is kept only for the visual dimming. See PostQueueWeek.
  const dragIdRef = useRef<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const beginDrag = (id: number) => { dragIdRef.current = id; setDragId(id); };
  const endDrag = () => { dragIdRef.current = null; setDragId(null); setOverCol(null); };

  const byStatus = useMemo(() => {
    const m = new Map<string, QueuePost[]>();
    for (const col of BOARD_COLUMNS) m.set(col.status, []);
    for (const p of posts) {
      // Statuses outside the five board columns (failed, archived) are folded into the
      // nearest sensible one rather than disappearing from the board entirely.
      const key = m.has(p.status) ? p.status
                : p.status === 'failed' ? 'needs_review'
                : p.status === 'archived' ? 'skipped'
                : null;
      if (key) m.get(key)!.push(p);
    }
    for (const list of m.values()) {
      list.sort((a, b) => {
        if (!a.scheduled_at) return 1;
        if (!b.scheduled_at) return -1;
        return a.scheduled_at < b.scheduled_at ? -1 : 1;
      });
    }
    return m;
  }, [posts]);

  return (
    <div>
      <p className={cn(labelCls, 'mb-2')}>
        Board — drag between columns. Draft and Posted are read-only.
      </p>
      <div className="grid grid-cols-5 gap-1.5">
        {BOARD_COLUMNS.map(col => {
          const items = byStatus.get(col.status) ?? [];
          const isOver = overCol === col.status;

          return (
            <div
              key={col.status}
              onDragOver={e => {
                if (!col.droppable || dragIdRef.current == null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOverCol(col.status);
              }}
              onDragLeave={() => setOverCol(prev => (prev === col.status ? null : prev))}
              onDrop={e => {
                if (!col.droppable) return;
                e.preventDefault();
                const id = Number(e.dataTransfer.getData('text/plain')) || dragIdRef.current;
                endDrag();
                if (id) onTransition(id, col.status);
              }}
              className={cn(
                'min-h-[200px] border p-1 space-y-1 transition-colors',
                'border-btc-orange/15',
                !col.droppable && 'bg-black/20',
                isOver && 'border-btc-orange bg-btc-orange/10',
              )}
            >
              <div className="flex items-baseline justify-between px-0.5 pb-1 border-b border-btc-orange/10">
                <span className="text-[9px] font-mono uppercase tracking-wider text-gray-500">{col.label}</span>
                <span className="text-[10px] font-mono text-gray-600">{items.length}</span>
              </div>

              {items.map(p => (
                <MiniCard
                  key={p.id}
                  post={p}
                  dragging={dragId === p.id}
                  conflicted={conflictIds.has(p.id)}
                  onDragStart={e => {
                    beginDrag(p.id);
                    e.dataTransfer.setData('text/plain', String(p.id));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={endDrag}
                  onClick={() => onOpen(p.id)}
                />
              ))}

              {items.length === 0 && <p className="text-[9px] font-mono text-gray-700 px-0.5 pt-1">—</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
