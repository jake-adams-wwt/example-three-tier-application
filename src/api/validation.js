const { validationError } = require('./errors');

const MAX_TITLE_LENGTH = 500; // matches tasks.title varchar(500)
const MAX_ID = 2147483647; // Postgres `serial` (int4)

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkTitle(value, errors) {
  if (typeof value !== 'string') {
    errors.push({ field: 'title', message: 'title must be a string' });
    return undefined;
  }
  const title = value.trim();
  if (!title) {
    errors.push({ field: 'title', message: 'title must not be empty' });
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.push({
      field: 'title',
      message: `title must be at most ${MAX_TITLE_LENGTH} characters`,
    });
  }
  return title;
}

function checkCompleted(value, errors) {
  if (typeof value !== 'boolean') {
    errors.push({ field: 'completed', message: 'completed must be a boolean' });
  }
  return value;
}

// Express 5 leaves req.body undefined when no body was sent.
function bodyObject(req, errors) {
  if (req.body === undefined) return {};
  if (!isPlainObject(req.body)) {
    errors.push({ field: 'body', message: 'body must be a JSON object' });
    return {};
  }
  return req.body;
}

function validateId(req, _res, next) {
  const raw = req.params.id;
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_ID) {
    return next(
      validationError([{ field: 'id', message: 'id must be a positive integer' }])
    );
  }
  req.taskId = id;
  next();
}

// Builds a middleware from a rule: { title, completed } each 'required' | 'optional'.
function bodyValidator(rules) {
  return (req, _res, next) => {
    const errors = [];
    const body = bodyObject(req, errors);
    const out = {};
    const checks = { title: checkTitle, completed: checkCompleted };
    for (const field of Object.keys(rules)) {
      if (body[field] !== undefined) {
        out[field] = checks[field](body[field], errors);
      } else if (rules[field] === 'required' && !errors.some((e) => e.field === 'body')) {
        errors.push({ field, message: `${field} is required` });
      }
    }
    if (errors.length) return next(validationError(errors));
    req.input = out;
    next();
  };
}

module.exports = {
  MAX_TITLE_LENGTH,
  validateId,
  // POST: title required, completed optional.
  validateCreate: bodyValidator({ title: 'required', completed: 'optional' }),
  // PUT: full replacement, both required.
  validateReplace: bodyValidator({ title: 'required', completed: 'required' }),
  // PATCH: both optional; an empty body toggles completed.
  validatePatch: bodyValidator({ title: 'optional', completed: 'optional' }),
};
