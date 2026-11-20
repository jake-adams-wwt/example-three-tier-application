const request = require('supertest');
const { createFakeDb } = require('./fakeDb');

const mockFake = createFakeDb();
jest.mock('../db', () => mockFake.db);
const app = require('../app');

beforeEach(() => {
  mockFake.reset([{ id: 1, title: 'one', completed: false }]);
});

describe('POST /tasks with an empty title', () => {
  it.each([
    ['empty string', ''],
    ['whitespace-only string', '   '],
  ])('rejects an %s with a 400 validation_error and inserts nothing', async (_name, title) => {
    const res = await request(app).post('/tasks').send({ title });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: [{ field: 'title', message: 'title must not be empty' }],
      },
    });
    expect(mockFake.state.tasks).toHaveLength(1);
    expect(mockFake.state.calls).toHaveLength(0);
  });
});
