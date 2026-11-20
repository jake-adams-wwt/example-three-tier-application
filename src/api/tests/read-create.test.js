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

describe('GET /health', () => {
  it('returns ok without touching the database', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(mockFake.state.calls).toHaveLength(0);
  });
});

describe('GET /tasks', () => {
  it('lists all tasks', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body.map((t) => t.id)).toEqual([1, 2]);
  });

  it('returns an empty array when there are no tasks', async () => {
    mockFake.reset([]);
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns a 500 JSON error when the database fails', async () => {
    mockFake.state.failWith = new Error('connection refused');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    console.error.mockRestore();
  });
});

describe('POST /tasks', () => {
  it('creates a task with a trimmed title', async () => {
    const res = await request(app).post('/tasks').send({ title: '  new  ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 3, title: 'new', completed: false });
  });

  it('accepts an explicit completed flag', async () => {
    const res = await request(app).post('/tasks').send({ title: 'x', completed: true });
    expect(res.status).toBe(201);
    expect(res.body.completed).toBe(true);
  });

  it.each([
    ['missing title', {}, 'title is required'],
    ['non-string title', { title: 5 }, 'title must be a string'],
    ['blank title', { title: '   ' }, 'title must not be empty'],
    ['too long title', { title: 'a'.repeat(501) }, 'title must be at most 500 characters'],
    ['non-boolean completed', { title: 'x', completed: 'yes' }, 'completed must be a boolean'],
  ])('returns 400 for %s', async (_name, body, message) => {
    const res = await request(app).post('/tasks').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.map((d) => d.message)).toContain(message);
    expect(mockFake.state.tasks).toHaveLength(2);
  });

  it('accepts a title of exactly 500 characters', async () => {
    const res = await request(app).post('/tasks').send({ title: 'a'.repeat(500) });
    expect(res.status).toBe(201);
  });

  it('returns 400 when no body is sent', async () => {
    const res = await request(app).post('/tasks');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toEqual({ field: 'title', message: 'title is required' });
  });

  it('returns 400 when the body is not an object', async () => {
    const res = await request(app).post('/tasks').send([1, 2]);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('body');
  });
});
