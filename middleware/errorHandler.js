export const notFound = (req, res, next) => {
  res.status(404);
  next(new Error(`Not found: ${req.originalUrl}`));
};

export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
  if (statusCode === 404) {
    console.warn('Not found:', req.originalUrl);
  } else {
    console.error('Error handled:', err.message, err.stack);
  }
  // Dual-shape: keep legacy `message`/`stack` for old clients, AND emit the
  // mobile-app envelope { success, message, errors }. Existing clients that
  // read .message continue to work.
  res.status(statusCode).json({
    success: false,
    message: err.message,
    errors: err.errors || undefined,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
};
