const express = require('express');
const db = require('../db');
const { notFound } = require('../errors');
const {
  validateId,
  validateCreate,
  validateReplace,
  validatePatch,
} = require('../validation');

const router = express.Router();
const missing = (id) => notFound(`Task ${id} not found`);

// GET /tasks — list all tasks
router.get('/', async (_req, res) => {
  const { rows } = await db.query('SELECT * FROM tasks ORDER BY created_at ASC, id ASC');
  res.json(rows);
});

// POST /tasks — create a task
router.post('/', validateCreate, async (req, res) => {
  const { title, completed = false } = req.input;
  const { rows } = await db.query(
    'INSERT INTO tasks (title, completed) VALUES ($1, $2) RETURNING *',
    [title, completed]
  );
  res.status(201).json(rows[0]);
});

// PUT /tasks/:id — replace title and completed
router.put('/:id', validateId, validateReplace, async (req, res) => {
  const { title, completed } = req.input;
  const { rows } = await db.query(
    'UPDATE tasks SET title = $1, completed = $2 WHERE id = $3 RETURNING *',
    [title, completed, req.taskId]
  );
  if (rows.length === 0) throw missing(req.taskId);
  res.json(rows[0]);
});

// PATCH /tasks/:id — partial update; an empty body toggles completed
router.patch('/:id', validateId, validatePatch, async (req, res) => {
  const { title, completed } = req.input;
  const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [req.taskId]);
  if (rows.length === 0) throw missing(req.taskId);
  const current = rows[0];
  let nextCompleted = current.completed;
  if (completed !== undefined) nextCompleted = completed;
  else if (title === undefined) nextCompleted = !current.completed;
  const { rows: updated } = await db.query(
    'UPDATE tasks SET title = $1, completed = $2 WHERE id = $3 RETURNING *',
    [title !== undefined ? title : current.title, nextCompleted, req.taskId]
  );
  res.json(updated[0]);
});

// DELETE /tasks/:id — remove a task
router.delete('/:id', validateId, async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM tasks WHERE id = $1', [req.taskId]);
  if (rowCount === 0) throw missing(req.taskId);
  res.status(204).end();
});

module.exports = router;
