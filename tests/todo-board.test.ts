// tests/todo-board.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  addTodoFor,
  removeTodoFor,
  setDeadlineOnBoardFor,
  setTodoDoneFor,
  setBoardNoteFor,
  adjacentWeeks,
  finishedInWeek,
  isComingUp,
  stillOnBoard,
  weekParam,
  weekStartFromParam,
  todosForBoard,
  vancouverWeekEndUtc,
  vancouverWeekStartUtc,
} from '@/canvas/todos';
import { sortBoard, type BoardItem } from '@/canvas/board-order';

const E = 'zz-todo-board@example.com';
let userId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  userId = (await db.user.create({ data: { email: E } })).id;
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  await db.$disconnect();
});
beforeEach(async () => {
  await db.todo.deleteMany({ where: { userId } });
  await db.canvasDeadline.deleteMany({ where: { userId } });
});

describe('vancouverWeekStartUtc', () => {
  it('lands on Monday 00:00 Vancouver, whatever day of the week it is asked', () => {
    // Mon Sep 28 through Sun Oct 4 2026 is one week. Every day in it must
    // answer with the same Monday. 07:00Z is midnight Pacific on that date.
    const monday = '2026-09-28T07:00:00.000Z';
    for (const day of ['2026-09-28', '2026-09-30', '2026-10-04']) {
      expect(vancouverWeekStartUtc(new Date(`${day}T20:00:00Z`)).toISOString()).toBe(monday);
    }
    // The next Monday opens the next week, not the same one.
    expect(vancouverWeekStartUtc(new Date('2026-10-05T20:00:00Z')).toISOString())
      .toBe('2026-10-05T07:00:00.000Z');
  });

  it('reads the weekday off the Vancouver day, not off the UTC instant', () => {
    // Sunday 5pm Pacific is already MONDAY in UTC. Reading the weekday off
    // the instant would roll the board over on Sunday afternoon and drop
    // everything the student finished that weekend.
    const sundayEvening = new Date('2026-10-05T00:00:00Z'); // Sun Oct 4, 5pm PDT
    expect(vancouverWeekStartUtc(sundayEvening).toISOString()).toBe('2026-09-28T07:00:00.000Z');
  });

  it('spans exactly seven days, for the range the board prints', () => {
    const start = vancouverWeekStartUtc(new Date('2026-09-30T20:00:00Z'));
    const end = vancouverWeekEndUtc(start);
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 3600_000 - 1);
  });
});

describe('what the board shows', () => {
  const weekStart = vancouverWeekStartUtc(new Date('2026-09-30T20:00:00Z'));

  it('keeps an unfinished item, so it rolls over without anything running', () => {
    expect(stillOnBoard({ completedAt: null }, weekStart)).toBe(true);
  });

  it('keeps one finished this week', () => {
    expect(stillOnBoard({ completedAt: new Date('2026-09-29T18:00:00Z') }, weekStart)).toBe(true);
  });

  it('drops one finished before Monday', () => {
    expect(stillOnBoard({ completedAt: new Date('2026-09-27T18:00:00Z') }, weekStart)).toBe(false);
  });

  it('keeps one finished in the first second of the week, not just after it', () => {
    expect(stillOnBoard({ completedAt: weekStart }, weekStart)).toBe(true);
  });
});

describe('what the board offers to put on it', () => {
  const now = new Date('2026-09-30T20:00:00Z');
  const inDays = (n: number) => new Date(now.getTime() + n * 24 * 3600_000);

  it('offers the next two weeks', () => {
    expect(isComingUp(inDays(1), now)).toBe(true);
    expect(isComingUp(inDays(13), now)).toBe(true);
  });

  it('offers something already overdue, which is the row that matters most', () => {
    expect(isComingUp(inDays(-3), now)).toBe(true);
  });

  it('leaves the far end of term alone', () => {
    expect(isComingUp(inDays(15), now)).toBe(false);
    expect(isComingUp(inDays(60), now)).toBe(false);
  });
});

describe('a todo', () => {
  it('goes on the board, ticks off, and stays there for the rest of the week', async () => {
    expect(await addTodoFor(userId, '  Email prof about lab swap ')).toEqual({ ok: true });
    const [todo] = await todosForBoard(userId, new Date());
    expect(todo.title).toBe('Email prof about lab swap');
    expect(todo.completedAt).toBeNull();

    expect(await setTodoDoneFor(userId, todo.id, true)).toEqual({ ok: true });
    // Ticked just now, so it is still this week's and still on the board.
    expect(await todosForBoard(userId, new Date())).toHaveLength(1);
  });

  it('drops off the board once the week has turned, without being deleted', async () => {
    await addTodoFor(userId, 'Readings ch. 4-6');
    const [todo] = await todosForBoard(userId, new Date());
    await setTodoDoneFor(userId, todo.id, true);

    // Same data, read from a week later: gone from the board, still on record.
    const nextWeek = new Date(Date.now() + 8 * 24 * 3600_000);
    expect(await todosForBoard(userId, nextWeek)).toHaveLength(0);
    expect(await db.todo.count({ where: { id: todo.id } })).toBe(1);
  });

  it('refuses a blank title', async () => {
    expect(await addTodoFor(userId, '   ')).toEqual({ ok: false, error: 'Give it a name.' });
    expect(await todosForBoard(userId, new Date())).toHaveLength(0);
  });

  it('belongs to whoever wrote it', async () => {
    await addTodoFor(userId, 'Mine');
    const [todo] = await todosForBoard(userId, new Date());
    expect(await setTodoDoneFor('someone-else', todo.id, true)).toEqual({ ok: false, error: 'Not found.' });
    expect(await removeTodoFor('someone-else', todo.id)).toEqual({ ok: false, error: 'Not found.' });
    expect(await db.todo.count({ where: { id: todo.id } })).toBe(1);
    expect(await removeTodoFor(userId, todo.id)).toEqual({ ok: true });
  });
});

describe('a deadline pulled onto the board', () => {
  async function aDeadline() {
    return db.canvasDeadline.create({
      data: {
        userId, uid: 'demo-board-1', kind: 'assignment', title: 'PSet 3',
        courseName: 'CPSC 110 101', dueAt: new Date('2026-10-01T06:59:59Z'), allDay: false,
      },
    });
  }

  it('goes on and comes off without the deadline itself changing', async () => {
    const d = await aDeadline();
    expect(await setDeadlineOnBoardFor(userId, d.id, true)).toEqual({ ok: true });
    const on = await db.canvasDeadline.findUniqueOrThrow({ where: { id: d.id } });
    expect(on.onBoardAt).not.toBeNull();

    expect(await setDeadlineOnBoardFor(userId, d.id, false)).toEqual({ ok: true });
    const off = await db.canvasDeadline.findUniqueOrThrow({ where: { id: d.id } });
    // Taking it off the board is not removing the deadline: everything that
    // makes it a deadline has to survive it.
    expect(off.onBoardAt).toBeNull();
    expect(off.title).toBe('PSet 3');
    expect(off.dueAt).toEqual(d.dueAt);
    expect(off.removedAt).toBeNull();
    expect(off.completedAt).toBeNull();
  });

  it('is not somebody else to put on their board', async () => {
    const d = await aDeadline();
    expect(await setDeadlineOnBoardFor('someone-else', d.id, true)).toEqual({ ok: false, error: 'Not found.' });
    expect((await db.canvasDeadline.findUniqueOrThrow({ where: { id: d.id } })).onBoardAt).toBeNull();
  });
});

describe('the order the board renders in', () => {
  const item = (o: Partial<BoardItem> & { id: string }): BoardItem => ({
    kind: 'todo', title: o.id, done: false, boardOrder: null, dueAtMs: null, ...o,
  });
  const ids = (list: BoardItem[]) => sortBoard(list).map((i) => i.id);

  it('sinks finished rows to the bottom, whatever else they have going for them', () => {
    const out = ids([
      item({ id: 'done-first', title: 'A', done: true }),
      item({ id: 'open-last', title: 'Z' }),
    ]);
    expect(out).toEqual(['open-last', 'done-first']);
  });

  it('sinks a finished row even when it was dragged to the top', () => {
    const out = ids([
      item({ id: 'dragged-done', boardOrder: 0, done: true }),
      item({ id: 'untouched-open' }),
    ]);
    expect(out).toEqual(['untouched-open', 'dragged-done']);
  });

  it('puts dated things first, by when, then the rest by name', () => {
    const out = ids([
      item({ id: 'zebra-todo', title: 'Zebra' }),
      item({ id: 'later', kind: 'deadline', title: 'B', dueAtMs: 2000 }),
      item({ id: 'apple-todo', title: 'Apple' }),
      item({ id: 'sooner', kind: 'deadline', title: 'A', dueAtMs: 1000 }),
    ]);
    expect(out).toEqual(['sooner', 'later', 'apple-todo', 'zebra-todo']);
  });

  it('sorts todo names case-insensitively and numerically', () => {
    // "Reading 10" after "Reading 2", which a plain string compare gets wrong.
    const out = ids([
      item({ id: 'r10', title: 'reading 10' }),
      item({ id: 'r2', title: 'Reading 2' }),
    ]);
    expect(out).toEqual(['r2', 'r10']);
  });

  it('lets a hand-placed row beat the default order entirely', () => {
    const out = ids([
      item({ id: 'urgent-deadline', kind: 'deadline', dueAtMs: 1, title: 'A' }),
      item({ id: 'dragged-to-top', title: 'Zzz', boardOrder: 0 }),
    ]);
    expect(out).toEqual(['dragged-to-top', 'urgent-deadline']);
  });

  it('keeps hand-placed rows above anything added since, in the order chosen', () => {
    const out = ids([
      item({ id: 'new-since', title: 'Aaa' }),
      item({ id: 'placed-2nd', title: 'Yyy', boardOrder: 1 }),
      item({ id: 'placed-1st', title: 'Zzz', boardOrder: 0 }),
    ]);
    expect(out).toEqual(['placed-1st', 'placed-2nd', 'new-since']);
  });

  it('is a total order, so equal-looking rows cannot swap between renders', () => {
    const twins = [
      item({ id: 'b', title: 'Same' }),
      item({ id: 'a', title: 'Same' }),
    ];
    expect(ids(twins)).toEqual(ids([...twins].reverse()));
  });

  it('does not mutate what it was given', () => {
    const list = [item({ id: 'z', title: 'Z' }), item({ id: 'a', title: 'A' })];
    sortBoard(list);
    expect(list.map((i) => i.id)).toEqual(['z', 'a']);
  });
});

describe('moving between weeks', () => {
  // Mon Oct 12 2026 is a Monday; 07:00Z is midnight Pacific on it.
  const NOW = new Date('2026-10-14T20:00:00Z'); // a Wednesday
  const THIS_MONDAY = '2026-10-12T07:00:00.000Z';

  it('takes a Monday, and any day inside a week, back to that Monday', () => {
    expect(weekStartFromParam('2026-10-05', NOW)?.toISOString()).toBe('2026-10-05T07:00:00.000Z');
    // A link to mid-week still lands somewhere sensible rather than nowhere.
    expect(weekStartFromParam('2026-10-08', NOW)?.toISOString()).toBe('2026-10-05T07:00:00.000Z');
  });

  it('refuses a week that has not happened, and anything it cannot read', () => {
    // A future week has nothing finished in it and no board to plan.
    expect(weekStartFromParam('2026-10-19', NOW)).toBeNull();
    expect(weekStartFromParam('next monday', NOW)).toBeNull();
    expect(weekStartFromParam('2026-13-45', NOW)).toBeNull();
    expect(weekStartFromParam(undefined, NOW)).toBeNull();
  });

  it('allows the current week itself', () => {
    expect(weekStartFromParam('2026-10-12', NOW)?.toISOString()).toBe(THIS_MONDAY);
  });

  it('steps back a week at a time and stops going forward at the current one', () => {
    const current = vancouverWeekStartUtc(NOW);
    expect(adjacentWeeks(current, NOW).prev.toISOString()).toBe('2026-10-05T07:00:00.000Z');
    // No forward arrow in the current week: there is nothing ahead to show.
    expect(adjacentWeeks(current, NOW).next).toBeNull();
    const past = vancouverWeekStartUtc(new Date('2026-10-07T20:00:00Z'));
    expect(adjacentWeeks(past, NOW).next?.toISOString()).toBe(THIS_MONDAY);
  });

  it('round-trips a Monday through the url parameter', () => {
    const current = vancouverWeekStartUtc(NOW);
    expect(weekStartFromParam(weekParam(current), NOW)?.toISOString()).toBe(current.toISOString());
  });
});

describe('what a past week shows', () => {
  const MONDAY = vancouverWeekStartUtc(new Date('2026-10-14T20:00:00Z'));
  const at = (ms: number) => new Date(MONDAY.getTime() + ms);

  beforeEach(async () => {
    await db.todo.deleteMany({ where: { userId } });
    await db.canvasDeadline.deleteMany({ where: { userId } });
  });

  async function todoDoneAt(title: string, when: Date | null) {
    return db.todo.create({ data: { userId, title, completedAt: when } });
  }
  async function deadlineDoneAt(uid: string, title: string, when: Date | null, onBoard = false) {
    return db.canvasDeadline.create({
      data: { userId, uid, kind: 'assignment', title, courseName: 'CPSC 110 101',
        dueAt: at(0), allDay: false, completedAt: when, onBoardAt: onBoard ? new Date() : null },
    });
  }

  it('includes both ends of the week and excludes a second either side', async () => {
    await todoDoneAt('first instant', MONDAY);
    await todoDoneAt('last instant', vancouverWeekEndUtc(MONDAY));
    await todoDoneAt('a second early', new Date(MONDAY.getTime() - 1000));
    await todoDoneAt('a second late', new Date(vancouverWeekEndUtc(MONDAY).getTime() + 1000));

    const { todos } = await finishedInWeek(userId, MONDAY);
    expect(todos.map((t) => t.title).sort()).toEqual(['first instant', 'last instant']);
  });

  it('ignores whether it was ever on the board, which is the point', async () => {
    await deadlineDoneAt('d-board', 'Ticked from the board', at(3600_000), true);
    await deadlineDoneAt('d-list', 'Ticked from the List', at(7200_000), false);

    const { deadlines } = await finishedInWeek(userId, MONDAY);
    expect(deadlines.map((d) => d.title).sort()).toEqual(['Ticked from the List', 'Ticked from the board']);
  });

  it('leaves unfinished work out, because it belongs to no week', async () => {
    // It has not gone anywhere: it is still on the CURRENT board, which is
    // what makes showing only completions honest rather than lossy.
    await todoDoneAt('still open', null);
    await deadlineDoneAt('d-open', 'Also still open', null);

    const { todos, deadlines } = await finishedInWeek(userId, MONDAY);
    expect(todos).toHaveLength(0);
    expect(deadlines).toHaveLength(0);
    expect(await db.todo.count({ where: { userId, completedAt: null } })).toBe(1);
  });
});

describe('a note on a board row', () => {
  it('saves on a todo and on a deadline, trimmed, and clears when emptied', async () => {
    await addTodoFor(userId, 'Lab report');
    const [todo] = await todosForBoard(userId, new Date());
    const d = await db.canvasDeadline.create({
      data: {
        userId, uid: 'demo-note-1', kind: 'assignment', title: 'PSet 6',
        courseName: 'CPSC 110 101', dueAt: new Date('2026-10-01T06:59:59Z'), allDay: false,
      },
    });

    expect(await setBoardNoteFor(userId, 'todo', todo.id, '  do this today  ')).toEqual({ ok: true });
    expect(await setBoardNoteFor(userId, 'deadline', d.id, 'q3 is the hard one')).toEqual({ ok: true });
    expect((await todosForBoard(userId, new Date()))[0].note).toBe('do this today');
    expect((await db.canvasDeadline.findUniqueOrThrow({ where: { id: d.id } })).note).toBe('q3 is the hard one');

    // Emptying the box is how a note is deleted, so it goes back to null
    // rather than leaving an empty string that still renders.
    expect(await setBoardNoteFor(userId, 'todo', todo.id, '   ')).toEqual({ ok: true });
    expect((await todosForBoard(userId, new Date()))[0].note).toBeNull();
  });

  it('belongs to whoever owns the row', async () => {
    await addTodoFor(userId, 'Mine');
    const [todo] = await todosForBoard(userId, new Date());
    expect(await setBoardNoteFor('someone-else', 'todo', todo.id, 'hi')).toEqual({ ok: false, error: 'Not found.' });
    expect((await todosForBoard(userId, new Date()))[0].note).toBeNull();
  });
});
