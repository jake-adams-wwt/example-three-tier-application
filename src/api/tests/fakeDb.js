// In-memory stand-in for the pg pool, matching the queries in routes/tasks.js.
function createFakeDb() {
  const state = { tasks: [], nextId: 1, calls: [], failWith: null };

  const reset = (seed = []) => {
    state.tasks = seed.map((t) => ({ created_at: '2024-01-01T00:00:00.000Z', ...t }));
    state.nextId = state.tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1;
    state.calls = [];
    state.failWith = null;
  };

  const query = async (sql, params = []) => {
    state.calls.push({ sql, params });
    if (state.failWith) throw state.failWith;
    if (sql.startsWith('SELECT * FROM tasks WHERE id')) {
      return { rows: state.tasks.filter((t) => t.id === params[0]) };
    }
    if (sql.startsWith('SELECT * FROM tasks')) return { rows: [...state.tasks] };
    if (sql.startsWith('INSERT INTO tasks')) {
      const task = {
        id: state.nextId++,
        title: params[0],
        completed: params[1],
        created_at: '2024-01-01T00:00:00.000Z',
      };
      state.tasks.push(task);
      return { rows: [task], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE tasks SET')) {
      const task = state.tasks.find((t) => t.id === params[2]);
      if (!task) return { rows: [], rowCount: 0 };
      task.title = params[0];
      task.completed = params[1];
      return { rows: [task], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM tasks')) {
      const before = state.tasks.length;
      state.tasks = state.tasks.filter((t) => t.id !== params[0]);
      return { rows: [], rowCount: before - state.tasks.length };
    }
    throw new Error(`unexpected query: ${sql}`);
  };

  return { state, reset, db: { query } };
}

module.exports = { createFakeDb };
