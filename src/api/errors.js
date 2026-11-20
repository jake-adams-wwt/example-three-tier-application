// Consistent JSON error bodies:
// { "error": { "code": "...", "message": "...", "details": [{ "field", "message" }] } }

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) =>
  new ApiError(400, 'bad_request', message, details);

const validationError = (details) =>
  new ApiError(400, 'validation_error', 'Request validation failed', details);

const notFound = (message = 'Resource not found') =>
  new ApiError(404, 'not_found', message);

function notFoundHandler(req, _res, next) {
  next(notFound(`Route not found: ${req.method} ${req.path}`));
}

function toApiError(err) {
  if (err instanceof ApiError) return err;
  if (err.type === 'entity.parse.failed') return badRequest('Malformed JSON body');
  if (err.type === 'entity.too.large') {
    return new ApiError(413, 'payload_too_large', 'Request body too large');
  }
  if (err.status >= 400 && err.status < 500) {
    return new ApiError(err.status, 'bad_request', 'Invalid request');
  }
  console.error(err);
  return new ApiError(500, 'internal_error', 'Internal server error');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  const apiError = toApiError(err);
  const body = { code: apiError.code, message: apiError.message };
  if (apiError.details) body.details = apiError.details;
  res.status(apiError.status).json({ error: body });
}

module.exports = {
  ApiError,
  badRequest,
  validationError,
  notFound,
  notFoundHandler,
  errorHandler,
};
