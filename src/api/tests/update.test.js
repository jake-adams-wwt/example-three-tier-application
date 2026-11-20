const request = require('supertest');
const { createFakeDb } = require('./fakeDb');

const mockFake = createFakeDb();
jest.mock('../db', () => mockFake.db);
const app = require('../app');

beforeEach(() => {
  mockFake.reset([
    { id: 1, title: 'one', completed: false },
    { id: 2, title: 'two', completed: true },
  ]);
});

describe('PUT /tasks/:id', () => {
  const put = (id, body) => request(app).put(`/tasks/${id}`).send(body);

  it('replaces title and completed', async () => {
    const res = await put(1, { title: ' renamed ', completed: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, title: 'renamed', completed: true });
    expect(mockFake.state.tasks[0].title).toBe('renamed');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await put(999, { title: 'x', completed: false });
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'not_found', message: 'Task 999 not found' });
  });

  it.each(['abc', '1.5', '-1', '0', '1abc', '99999999999'])(
    'returns 400 for invalid id %s',
    async (id) => {
      const res = await put(id, { title: 'x', completed: false });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'id', message: 'id must be a positive integer' },
      ]);
      expect(mockFake.state.calls).toHaveLength(0);
    }
  );

  it('requires both title and completed', async () => {
    const res = await put(1, {});
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toEqual(['title', 'completed']);
  });

  it('rejects blank titles and non-boolean completed', async () => {
    const res = await put(1, { title: '  ', completed: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveLength(2);
    expect(mockFake.state.tasks[0].title).toBe('one');
  });
});

describe('PATCH /tasks/:id', () => {
  const patch = (id, body = {}) => request(app).patch(`/tasks/${id}`).send(body);

  it('toggles completed when the body is empty', async () => {
    let res = await patch(1);
    expect(res.body.completed).toBe(true);
    res = await patch(1, {});
    expect(res.body.completed).toBe(false);
  });

  it('sets completed explicitly', async () => {
    const res = await patch(2, { completed: false });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(false);
  });

  it('renames without changing completed', async () => {
    const res = await patch(2, { title: ' renamed ' });
    expect(res.body).toMatchObject({ id: 2, title: 'renamed', completed: true });
  });

  it('returns 404 for an unknown id', async () => {
    const res = await patch(999);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it.each(['abc', '0', '99999999999'])('returns 400 for invalid id %s', async (id) => {
    const res = await patch(id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns 400 for invalid title or completed', async () => {
    expect((await patch(1, { title: '   ' })).status).toBe(400);
    expect((await patch(1, { title: 3 })).status).toBe(400);
    expect((await patch(1, { completed: 'true' })).status).toBe(400);
    expect(mockFake.state.calls).toHaveLength(0);
  });
});
