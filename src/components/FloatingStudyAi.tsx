import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StudyAiPanel } from './StudyAiPanel';

const STORAGE_KEY = 'studycloud_floating_ai_pos_v1';
const BUBBLE_SIZE = 56;
const EDGE_PADDING = 12;

interface Position {
  x: number;
  y: number;
}

function clampPosition(x: number, y: number): Position {
  if (typeof window === 'undefined') return { x: 24, y: 24 };
  const maxX = Math.max(EDGE_PADDING, window.innerWidth - BUBBLE_SIZE - EDGE_PADDING);
  const maxY = Math.max(EDGE_PADDING, window.innerHeight - BUBBLE_SIZE - EDGE_PADDING);
  return {
    x: Math.min(maxX, Math.max(EDGE_PADDING, x)),
    y: Math.min(maxY, Math.max(EDGE_PADDING, y)),
  };
}

function getInitialPosition(): Position {
  if (typeof window === 'undefined') return { x: 24, y: 24 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        return clampPosition(parsed.x, parsed.y);
      }
    }
  } catch {
    // ignore storage errors
  }
  return clampPosition(window.innerWidth - BUBBLE_SIZE - 18, window.innerHeight - BUBBLE_SIZE - 22);
}

export const FloatingStudyAi: React.FC = () => {
  const [pos, setPos] = useState<Position>(() => getInitialPosition());
  const [isDragging, setIsDragging] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const posRef = useRef<Position>(pos);
  posRef.current = pos;

  useEffect(() => {
    const onResize = () => {
      setPos((prev) => clampPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = posRef.current.x;
    const originY = posRef.current.y;

    dragStartRef.current = {
      pointerX: startX,
      pointerY: startY,
      originX,
      originY,
      moved: false,
    };
    setIsDragging(true);

    const onPointerMove = (ev: PointerEvent) => {
      const drag = dragStartRef.current;
      if (!drag) return;
      const dx = ev.clientX - drag.pointerX;
      const dy = ev.clientY - drag.pointerY;
      if (!drag.moved && Math.hypot(dx, dy) > 6) {
        drag.moved = true;
      }
      const next = clampPosition(drag.originX + dx, drag.originY + dy);
      setPos(next);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      const drag = dragStartRef.current;
      dragStartRef.current = null;
      setIsDragging(false);

      if (drag?.moved) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(posRef.current));
        } catch {
          // ignore storage errors
        }
      } else {
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }, []);

  return (
    <>
      {/* Draggable Floating AI Bubble */}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        style={{
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          width: `${BUBBLE_SIZE}px`,
          height: `${BUBBLE_SIZE}px`,
        }}
        className={`fixed z-40 touch-none select-none overflow-hidden rounded-full ring-2 ring-[#22C55E] shadow-[0_8px_28px_rgba(34,197,94,0.45)] transition-transform ${
          isDragging ? 'scale-110 cursor-grabbing shadow-[0_12px_36px_rgba(34,197,94,0.75)]' : 'cursor-grab hover:scale-105 active:scale-95'
        }`}
        aria-label="Study Cloud AI Doubt Solver"
        title="Drag anywhere or tap to open Study Cloud AI"
      >
        <img
          src="/assets/aistudio/Screenshot_2026_1126_234908_5c427dc1.png"
          alt="Study Cloud AI"
          draggable={false}
          className="h-full w-full rounded-full object-cover scale-[2.02] -translate-x-[1.5%] pointer-events-none"
        />
      </button>

      {/* Study Cloud AI Drawer / Modal */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-end sm:p-4 bg-black/60 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="h-[88dvh] sm:h-[82dvh] w-full sm:max-w-md overflow-hidden rounded-t-3xl sm:rounded-3xl border border-[var(--card-border)] shadow-2xl"
          >
            <StudyAiPanel
              variant="drawer"
              scopeKey="home:global"
              onClose={() => setIsOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
};
