'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SyllabusUpload from '@/components/SyllabusUpload';
import AssessmentConfirm from '@/components/AssessmentConfirm';

export type SyllabusListItem = {
  courseId: string;
  courseLabel: string;
  syllabus: { id: string; filename: string; size: number; extractedAt: string | null } | null;
};

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One row per enrolled course this term: either the syllabus already on file
 * (with a toggleable in-app viewer and a delete action) or an upload form.
 * The viewer is an <embed> pointed at our own streaming route, never a blob
 * URL — see src/app/api/syllabus/[id]/file/route.ts for why.
 */
export default function SyllabusList({ termId, items }: { termId: string; items: SyllabusListItem[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(syllabusId: string) {
    setDeletingId(syllabusId);
    setError(null);
    try {
      const res = await fetch(`/api/syllabus?id=${syllabusId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Could not delete that syllabus.');
        return;
      }
      if (openId === syllabusId) setOpenId(null);
      router.refresh();
    } catch {
      setError('Could not delete that syllabus. Check your connection and try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {items.map((item) => (
        <div key={item.courseId} className="rounded-card border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">{item.courseLabel}</span>
            {item.syllabus && (
              <div className="flex items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === item.syllabus!.id ? null : item.syllabus!.id)}
                  className="font-medium text-brand-accent hover:underline"
                >
                  {openId === item.syllabus.id ? 'Hide' : 'View'}
                </button>
                <button
                  type="button"
                  disabled={deletingId === item.syllabus.id}
                  onClick={() => handleDelete(item.syllabus!.id)}
                  className="font-medium text-danger hover:underline disabled:opacity-50"
                >
                  {deletingId === item.syllabus.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            )}
          </div>

          {item.syllabus ? (
            <>
              <p className="mt-1 text-sm text-text-secondary">
                {item.syllabus.filename} · {formatSize(item.syllabus.size)}
              </p>
              {openId === item.syllabus.id && (
                <embed
                  src={`/api/syllabus/${item.syllabus.id}/file`}
                  type="application/pdf"
                  className="mt-4 h-[37.5rem] w-full rounded-input border border-border"
                />
              )}
              <AssessmentConfirm
                syllabusId={item.syllabus.id}
                alreadyExtracted={item.syllabus.extractedAt !== null}
                onSaved={() => router.refresh()}
              />
            </>
          ) : (
            <SyllabusUpload courseId={item.courseId} termId={termId} onUploaded={() => router.refresh()} />
          )}
        </div>
      ))}
    </div>
  );
}
