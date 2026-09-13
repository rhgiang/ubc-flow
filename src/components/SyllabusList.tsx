'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SyllabusUpload from '@/components/SyllabusUpload';
import AssessmentConfirm from '@/components/AssessmentConfirm';

export type SyllabusListItem = {
  courseId: string;
  courseLabel: string;
  syllabus: {
    id: string;
    /** All three null together when there is no uploaded PDF on this row. */
    filename: string | null;
    size: number | null;
    url: string | null;
    /** ponytail: sent inline rather than behind a fetch route. Capped at
     *  MAX_SYLLABUS_TEXT_CHARS and a real syllabus is a fraction of that; if
     *  these payloads ever get heavy, serve it from a route like the PDF. */
    sourceText: string | null;
    extractedAt: string | null;
  } | null;
};

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One row per enrolled course this term: whatever the student has recorded so
 * far (any of an uploaded PDF, a link, and the pasted text, with a toggleable
 * viewer and a delete action) plus the form to add another. The PDF viewer is
 * an <embed> pointed at our own streaming route, never a blob URL - see
 * src/app/api/syllabus/[id]/file/route.ts for why.
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
                {[
                  item.syllabus.filename && item.syllabus.size !== null
                    ? `${item.syllabus.filename} · ${formatSize(item.syllabus.size)}`
                    : null,
                  item.syllabus.url ? 'link' : null,
                  item.syllabus.sourceText ? 'pasted text' : null,
                ].filter(Boolean).join(' · ')}
              </p>

              {openId === item.syllabus.id && (
                <div className="mt-4 space-y-3">
                  {item.syllabus.url && (
                    // Outbound and untrusted: the student typed this. rel
                    // stops the opened page reaching back through
                    // window.opener, and the scheme was checked on write.
                    <a
                      href={item.syllabus.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block break-all text-sm font-medium text-brand-accent hover:underline"
                    >
                      {item.syllabus.url}
                    </a>
                  )}
                  {item.syllabus.filename && (
                    <embed
                      src={`/api/syllabus/${item.syllabus.id}/file`}
                      type="application/pdf"
                      className="h-[37.5rem] w-full rounded-input border border-border"
                    />
                  )}
                  {item.syllabus.sourceText && (
                    <pre className="max-h-[25rem] overflow-auto whitespace-pre-wrap rounded-input border border-border bg-surface-muted p-3 text-sm text-text-secondary">
                      {item.syllabus.sourceText}
                    </pre>
                  )}
                </div>
              )}

              <AssessmentConfirm
                syllabusId={item.syllabus.id}
                alreadyExtracted={item.syllabus.extractedAt !== null}
                // A link is a bookmark: we never fetch it, so there is
                // nothing to read until a PDF or the pasted text arrives.
                readable={item.syllabus.filename !== null || item.syllabus.sourceText !== null}
                onSaved={() => router.refresh()}
              />

              <details
                className="mt-3"
                open={item.syllabus.filename === null && item.syllabus.sourceText === null}
              >
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  Add a PDF, a link, or the syllabus text
                </summary>
                <SyllabusUpload courseId={item.courseId} termId={termId} onUploaded={() => router.refresh()} />
              </details>
            </>
          ) : (
            <SyllabusUpload courseId={item.courseId} termId={termId} onUploaded={() => router.refresh()} />
          )}
        </div>
      ))}
    </div>
  );
}
