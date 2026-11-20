const request = require('supertest');
const { createFakeDb } = require('./fakeDb');

const mockFake = createFakeDb();
jest.mock('../db', () => mockFake.db);
const app = require('../app');

beforeEach(() => {
  mockFake.reset([
    { id: 1, title: 'one', completed: false },
    { id: 2, title: 'two', completed: true },
    { id: 3, title: 'three', completed: false },
  ]);
});

describe('DELETE /tasks/:id', () => {
  const del = (id) => request(app).delete(`/tasks/${id}`);

  it('deletes an existing task and returns 204 with no body', async () => {
    const res = await del(2);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(mockFake.state.tasks.map((t) => t.id)).toEqual([1, 3]);
    expect((await request(app).get('/tasks/2')).status).toBe(404);
  });

  it('leaves other tasks unchanged', async () => {
    await del(2);
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: 1, title: 'one', completed: false }),
      expect.objectContaining({ id: 3, title: 'three', completed: false }),
    ]);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await del(999);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'not_found', message: 'Task 999 not found' });
    expect(mockFake.state.tasks).toHaveLength(3);
  });

  it('returns 404 when deleting the same task twice', async () => {
    expect((await del(1)).status).toBe(204);
    expect((await del(1)).status).toBe(404);
  });

  it.each(['abc', '1.5', '-1', '0', '1abc', '99999999999'])(
    'returns 400 for invalid id %s',
    async (id) => {
      const res = await del(id);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
      expect(res.body.error.details).toEqual([
        { field: 'id', message: 'id must be a positive integer' },
      ]);
      expect(mockFake.state.calls).toHaveLength(0);
      expect(mockFake.state.tasks).toHaveLength(3);
    }
  );
});
