// Consistent JSON envelope for mobile clients.
// Routes can still return raw objects (legacy), but new endpoints should
// use these helpers so the mobile app gets a predictable shape.

export const ok = (res, data = {}, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, message, data });

export const created = (res, data = {}, message = 'Created') =>
  ok(res, data, message, 201);

export const fail = (res, message = 'Error', status = 400, errors = undefined) => {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
};
