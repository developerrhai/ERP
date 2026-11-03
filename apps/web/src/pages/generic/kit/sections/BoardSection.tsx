// apps/web/src/pages/generic/kit/sections/BoardSection.tsx
// Interactive Kanban board section with HTML5 drag-and-drop and keyboard move (docs/plans/07-ENGINE-KIT.md §2.3, §12 T-KIT-08)

import { useEffect, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import { formatMoney } from '../../fieldModel';
import type { PanelCall } from '../panelTypes';

export interface BoardCard {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  amount?: number;
}

export interface BoardLane {
  key: string;
  label: string;
  cards: BoardCard[];
}

export function BoardSection({
  title,
  draggable,
  move,
  lanes,
  onCall,
}: {
  title?: string;
  draggable: boolean;
  move?: PanelCall;
  lanes: BoardLane[];
  onCall?: (call: PanelCall, opts?: { payload?: Record<string, unknown> }) => Promise<unknown>;
}) {
  const toast = useToast();
  const [boardLanes, setBoardLanes] = useState<BoardLane[]>(lanes);
  const [pickedCard, setPickedCard] = useState<{ cardId: string; fromLane: string } | null>(null);

  useEffect(() => {
    setBoardLanes(lanes);
  }, [lanes]);

  const handleMove = async (cardId: string, toLaneKey: string, fromLaneKey: string) => {
    if (toLaneKey === fromLaneKey) return;
    if (!move || !onCall) return;

    // Save previous state for revert on error
    const previous = boardLanes;

    // Optimistic UI only after confirmation or handle error revert
    try {
      await onCall(move, { payload: { cardId, laneKey: toLaneKey } });
      // On success update local lanes
      setBoardLanes((cur) => {
        let movedCard: BoardCard | undefined;
        const newLanes = cur.map((lane) => {
          if (lane.key === fromLaneKey) {
            movedCard = lane.cards.find((c) => c.id === cardId);
            return { ...lane, cards: lane.cards.filter((c) => c.id !== cardId) };
          }
          return lane;
        });
        if (!movedCard) return cur;
        return newLanes.map((lane) => {
          if (lane.key === toLaneKey && movedCard) {
            return { ...lane, cards: [...lane.cards, movedCard] };
          }
          return lane;
        });
      });
      setPickedCard(null);
    } catch (err: unknown) {
      setBoardLanes(previous);
      setPickedCard(null);
      toast(err instanceof Error ? err.message : 'Could not move card.');
    }
  };

  const onDragStart = (e: React.DragEvent, cardId: string, laneKey: string) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ cardId, fromLane: laneKey }));
  };

  const onDragOver = (e: React.DragEvent) => {
    if (draggable) e.preventDefault();
  };

  const onDrop = (e: React.DragEvent, toLaneKey: string) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain')) as {
        cardId: string;
        fromLane: string;
      };
      if (data.cardId && data.fromLane) {
        void handleMove(data.cardId, toLaneKey, data.fromLane);
      }
    } catch {
      // Ignore invalid drag data
    }
  };

  const onKeyDownCard = (e: React.KeyboardEvent, cardId: string, currentLaneKey: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!pickedCard) {
        setPickedCard({ cardId, fromLane: currentLaneKey });
      } else if (pickedCard.cardId === cardId) {
        setPickedCard(null);
      } else {
        void handleMove(pickedCard.cardId, currentLaneKey, pickedCard.fromLane);
      }
    } else if (pickedCard && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const currentIdx = boardLanes.findIndex((l) => l.key === currentLaneKey);
      const targetIdx = e.key === 'ArrowRight' ? currentIdx + 1 : currentIdx - 1;
      if (targetIdx >= 0 && targetIdx < boardLanes.length) {
        const targetLane = boardLanes[targetIdx];
        if (targetLane) {
          void handleMove(pickedCard.cardId, targetLane.key, pickedCard.fromLane);
        }
      }
    }
  };

  return (
    <div className="v9-section board-section">
      {title ? <h3>{title}</h3> : null}
      {boardLanes.length === 0 ? (
        <p className="v9-muted">No lanes configured.</p>
      ) : (
        <div
          className="v9-kanban"
          role="region"
          aria-label={title ?? 'Kanban board'}
          style={{
            gridTemplateColumns: `repeat(${boardLanes.length}, minmax(180px, 1fr))`,
          }}
        >
          {boardLanes.map((lane) => (
            <div
              key={lane.key}
              className="v9-lane"
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, lane.key)}
              role="list"
              aria-label={lane.label}
            >
              <div className="v9-lane-head">
                <span>{lane.label}</span>
                <span className="count">{lane.cards.length}</span>
              </div>
              <div className="lane-cards" style={{ marginTop: '8px' }}>
                {lane.cards.map((card) => {
                  const isPicked = pickedCard?.cardId === card.id;
                  return (
                    <div
                      key={card.id}
                      className="v9-ticket"
                      role="listitem"
                      tabIndex={0}
                      draggable={draggable}
                      onDragStart={(e) => onDragStart(e, card.id, lane.key)}
                      onKeyDown={(e) => onKeyDownCard(e, card.id, lane.key)}
                      style={{
                        cursor: draggable ? 'grab' : 'default',
                        border: isPicked ? '2px solid #2563eb' : undefined,
                        boxShadow: isPicked ? '0 0 0 2px rgba(37,99,235,0.2)' : undefined,
                      }}
                      title={draggable ? 'Drag or press Enter to pick up/drop' : undefined}
                    >
                      <b>{card.title}</b>
                      {card.subtitle ? <small>{card.subtitle}</small> : null}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: '6px',
                        }}
                      >
                        {card.badge ? (
                          <span
                            className="status"
                            style={{ fontSize: '8px', padding: '1px 4px' }}
                          >
                            {card.badge}
                          </span>
                        ) : (
                          <span />
                        )}
                        {card.amount !== undefined ? (
                          <b style={{ fontSize: '10px' }}>{formatMoney(card.amount)}</b>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
