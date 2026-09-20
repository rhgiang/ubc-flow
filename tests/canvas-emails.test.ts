// tests/canvas-emails.test.ts
import { describe, it, expect } from 'vitest';
import { reminderEmail } from '@/canvas/emails';
import type { DeadlineForNotice, Notice } from '@/canvas/notices';

const NOW = new Date('2026-10-24T15:00:00Z');
const notice = (i: number): Notice => {
  const deadline: DeadlineForNotice = {
    id: `d${i}`, title: `Assignment ${i}`, courseName: 'CPSC 110',
    dueAt: new Date(NOW.getTime() + (i + 1) * 3600_000), allDay: false, url: null,
    movedFrom: null, movedAt: null, removedAt: null,
  };
  return { deadline, key: `lead:72:${deadline.dueAt.toISOString()}`, kind: 'lead', leadHours: 72 };
};

describe('reminderEmail', () => {
  it('lists everything when there is little to list', () => {
    const body = reminderEmail([notice(0), notice(1)], 'https://x/reminders/t').body;
    expect(body).toContain('Assignment 0');
    expect(body).toContain('Assignment 1');
    expect(body).not.toMatch(/\bmore\./);
  });

  it('caps a pathological feed at 25 a section and points at the page for the rest', () => {
    const body = reminderEmail(Array.from({ length: 400 }, (_, i) => notice(i)), 'https://x/reminders/t').body;
    expect(body).toContain('Assignment 24');
    expect(body).not.toContain('Assignment 25');
    expect(body).toContain('and 375 more.');
    expect(body).toContain('/deadlines');
  });
});
