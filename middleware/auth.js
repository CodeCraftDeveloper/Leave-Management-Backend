import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import Employee from '../models/Employee.js';
import { isSuperAdmin } from '../utils/headScope.js';

export const protect = asyncHandler(async (req, res, next) => {
  let token;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) token = header.split(' ')[1];
  if (!token && typeof req.query?.token === 'string' && req.query.token) {
    token = req.query.token;
  }
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

// Flexible role guard. Usage: router.use(authorize('head', 'dept_head'))
export const authorize = (...allowed) => (req, res, next) => {
  if (req.user && allowed.includes(req.user.role)) return next();
  res.status(403);
  throw new Error('Insufficient permissions');
};

// Only the top-of-org `head` role — full org visibility, manages dept_heads,
// handles dept_head leave approvals and system-wide settings.
export const headOnly = authorize('head');

// The single overall super admin. Heads are department-scoped, so global powers
// — weekly digest, org-wide dept_head role assignment — are reserved for the
// super admin alone.
export const superAdminOnly = asyncHandler(async (req, res, next) => {
  if (req.user && isSuperAdmin(req.user)) return next();
  res.status(403);
  throw new Error('Only the super admin can perform this action');
});

// Department + employee management surface. Any `head` may use it, but the
// controllers further restrict scoped heads to the department(s) they oversee;
// the super admin is unrestricted.
export const headOrSuperAdmin = asyncHandler(async (req, res, next) => {
  if (req.user && (req.user.role === 'head' || isSuperAdmin(req.user))) return next();
  res.status(403);
  throw new Error('Only a head or the super admin can perform this action');
});

// Any reviewer — used for the shared management surface (My Team, review queue).
export const reviewerOnly = authorize('head', 'dept_head');

// Legacy guards for the payroll/salary-structure helpers that still reference
// `hr`. Heads inherit everything the old `admin` could do.
export const headOrHR = authorize('head', 'hr');

// Back-compat aliases. Old code imported these names — keep them mapped to the
// new role so a missed import does not crash; routes are being migrated.
export const adminOnly = headOnly;
export const adminOrHR = headOrHR;

// Ownership guard for employee-scoped resources. Pass a getter that returns
// the owner _id from req (sync or async); head/hr always pass.
export const ownerOrAdmin = (getOwnerId) => asyncHandler(async (req, res, next) => {
  if (['head', 'hr'].includes(req.user.role)) return next();
  const ownerId = await getOwnerId(req);
  if (ownerId && ownerId.toString() === req.user._id.toString()) return next();
  res.status(403);
  throw new Error('Not authorized');
});
