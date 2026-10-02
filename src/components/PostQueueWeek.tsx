/**
 * Week view — a seven-column grid you can drag posts around in.
 *
 * Drag-and-drop is native HTML5 rather than dnd-kit (the plan's recommendation) or
 * FullCalendar (its alternative). The interaction here is "drop a card into a day
 * column", which the browser handles natively in a few lines; dnd-kit earns its weight
 * on sortable lists and pointer-sensor nuance that this grid does not need, and
 * FullCalendar would fight the brand styling. Revisit if within-day reordering by pixel
 * position is ever wanted.
 *
 * Dropping onto a day KEEPS the post's clock time and changes only its date. That is
 * almost always the intent — "move Tuesday's close analysis to Wednesday" means 4:20pm
 * Wednesday, not 4:20pm-minus-whatever-the-drag-offset-was.
 */
import { useMemo, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { etParts, etToUtc, etDateString, etZoneAbbrev } from '../services/time';
import { MiniCard, labelCls, type QueuePost, type EmptySlot } from './queueShared';
import { Plus } from 'lucide-react';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PostQueueWeek({
  posts, emptySlots, from, conflictIds, busy, onMove, onGenerate, onOpen,
}: {
  posts: QueuePost[];
  emptySlots: EmptySlot[];
  from: Date;
  conflictIds: Set<number>;
  busy: boolean;
  /** Called with the post id and the target ET calendar date ("YYYY-MM-DD"). */
  onMove: (id: number, etDate: string) => void;
  onGenerate: (typeId: number) => void;
  onOpen: (id: number) => void;
}) {
  // The id lives in a ref as well as state. `dragover` has to decide synchronously
  // whether to accept the drop, and it fires immediately after `dragstart` — before
  // React has re-rendered with the new state, so a state-only check reads stale null,
  // skips preventDefault, and the browser then refuses to fire `drop` at all. State is
  // kept purely for the visual dimming.
  const dragIdRef = useRef<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const zone = useMemo(() => etZoneAbbrev(), []);

  const beginDrag = (id: number) => { dragIdRef.current = id; setDragId(id); };
  const endDrag = () => { dragIdRef.current = null; setDragId(null); setOverDay(null); };

  // Seven ET calendar days starting from the window start. Built by calendar arithmetic
  // on y/m/d so a DST transition inside the week cannot shift or duplicate a column.
  const days = useMemo(() => {
    const base = etParts(from);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.UTC(base.year, base.month - 1, base.day + i));
      const etDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      return { etDate, weekday: d.getUTCDay(), dayNum: d.getUTCDate() };
    });
  }, [from]);

  const todayEt = etDateString();

  const byDay = useMemo(() => {
    const m = new Map<string, QueuePost[]>();
    for (const p of posts) {
      if (!p.scheduled_at) continue;
      const k = p.et_date ?? etDateString(new Date(p.scheduled_at));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1));
    }
    return m;
  }, [posts]);

  const slotsByDay = useMemo(() => {
    const m = new Map<string, EmptySlot[]>();
    for (const s of emptySlots) {
      if (!m.has(s.etDate)) m.set(s.etDate, []);
      m.get(s.etDate)!.push(s);
    }
    return m;
  }, [emptySlots]);

  return (
    <div>
      <p className={cn(labelCls, 'mb-2')}>
        Week · {zone} — drag a post to another day; it keeps its time
      </p>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map(day => {
          const dayPosts = byDay.get(day.etDate) ?? [];
          const daySlots = slotsByDay.get(day.etDate) ?? [];
          const isToday = day.etDate === todayEt;
          const isOver = overDay === day.etDate;

          return (
            <div
              key={day.etDate}
              onDragOver={e => {
                if (dragIdRef.current == null) return;
                e.preventDefault();                  // required to allow a drop
                e.dataTransfer.dropEffect = 'move';
                setOverDay(day.etDate);
              }}
              onDragLeave={() => setOverDay(prev => (prev === day.etDate ? null : prev))}
              onDrop={e => {
                e.preventDefault();
                const id = Number(e.dataTransfer.getData('text/plain')) || dragIdRef.current;
                endDrag();
                if (id) onMove(id, day.etDate);
              }}
              className={cn(
                'min-h-[180px] border p-1 space-y-1 transition-colors',
                isToday ? 'border-btc-orange/40 bg-btc-orange/[0.03]' : 'border-btc-orange/15',
                isOver && 'border-btc-orange bg-btc-orange/10',
              )}
            >
              <div className="flex items-baseline justify-between px-0.5 pb-1 border-b border-btc-orange/10">
                <span className={cn('text-[9px] font-mono uppercase tracking-wider',
                  isToday ? 'text-btc-orange' : 'text-gray-600')}>
                  {DAY_NAMES[day.weekday]}
                </span>
                <span className={cn('text-[10px] font-mono', isToday ? 'text-white' : 'text-gray-500')}>
                  {day.dayNum}
                </span>
              </div>

              {dayPosts.map(p => (
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

              {daySlots.map(s => (
                <button
                  key={`${s.typeId}-${s.at}`}
                  disabled={busy}
                  onClick={() => onGenerate(s.typeId)}
                  title={`${s.name} — no post yet`}
                  className="w-full flex items-center gap-1 px-1.5 py-1 border border-dashed
                             border-btc-orange/20 hover:border-btc-orange/50 hover:bg-btc-orange/5
                             transition-colors disabled:opacity-30"
                >
                  <Plus size={9} className="text-btc-orange/50 shrink-0" />
                  <span className="text-[8px] font-mono text-btc-orange/50">{s.code}</span>
                </button>
              ))}

              {dayPosts.length === 0 && daySlots.length === 0 && (
                <p className="text-[9px] font-mono text-gray-700 px-0.5 pt-1">—</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
