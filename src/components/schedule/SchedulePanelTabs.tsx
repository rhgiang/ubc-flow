'use client';

import { useState } from 'react';
import SavedCoursesPanel from '@/components/schedule/SavedCoursesPanel';
import FindCoursesPanel from '@/components/schedule/FindCoursesPanel';
import type { SectionHit } from '@/lib/search';

type Tab = 'saved' | 'find';

export default function SchedulePanelTabs({
  termId,
  chosen,
  onAdd,
  onRemove,
  onInfo,
  onDock,
  onSwap,
}: {
  termId: string;
  chosen: SectionHit[];
  onAdd: (hit: SectionHit) => void;
  onRemove: (sectionId: string) => void;
  onInfo: (courseId: string) => void;
  onDock: (courseId: string) => void;
  onSwap?: (section: SectionHit) => void;
}) {
  const [tab, setTab] = useState<Tab>('saved');
  const addedIds = new Set(chosen.map((c) => c.sectionId));

  return (
    <div>
      <div className="flex gap-6 border-b border-border px-4">
        {(
          [
            ['saved', 'Saved Courses'],
            ['find', 'Find Courses'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 py-3 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-brand-accent text-brand-accent'
                : 'border-transparent text-text-secondary hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'saved' ? (
        <SavedCoursesPanel
          chosen={chosen}
          onRemove={onRemove}
          onInfo={onInfo}
          onDock={onDock}
          onSwap={onSwap}
        />
      ) : (
        <FindCoursesPanel
          termId={termId}
          addedIds={addedIds}
          onAdd={onAdd}
          onInfo={onInfo}
          onDock={onDock}
        />
      )}
    </div>
  );
}
