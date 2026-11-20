const express = require('express');
const tasksRouter = require('./routes/tasks');
const { notFoundHandler, errorHandler } = require('./errors');

// The app is exported without listening so tests (supertest) can use it.
const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/tasks', tasksRouter);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
