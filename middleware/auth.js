import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import Employee from '../models/Employee.js';

export const protect = asyncHandler(async (req, res, next) => {
  let token;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) token = header.split(' ')[1];
  if (!token) {
    res.status(401);
    throw new Error('Not authorized, token missing');
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await Employee.findById(decoded.id).select('-password');
    if (!user || !user.active) {
      res.status(401);
      throw new Error('User not found or inactive');
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(401);
    throw new Error('Not authorized, invalid token');
  }
});

// Existing routes use adminOnly — kept for back-compat.
export const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403);
  throw new Error('Admin access required');
};

// Flexible role guard. Usage: router.use(authorize('admin', 'hr'))
export const authorize = (...allowed) => (req, res, next) => {
  if (req.user && allowed.includes(req.user.role)) return next();
  res.status(403);
  throw new Error('Insufficient permissions');
};

// Convenience: admin OR hr.
export const adminOrHR = authorize('admin', 'hr');

// Ownership guard for employee-scoped resources. Pass a getter that
// returns the owner _id from req (sync or async); admin/hr always pass.
export const ownerOrAdmin = (getOwnerId) => asyncHandler(async (req, res, next) => {
  if (['admin', 'hr'].includes(req.user.role)) return next();
  const ownerId = await getOwnerId(req);
  if (ownerId && ownerId.toString() === req.user._id.toString()) return next();
  res.status(403);
  throw new Error('Not authorized');
});
