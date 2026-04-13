const { verifyToken } = require('./auth');

function requireAuth(req) {
  const authHeader = req.headers && req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  const token = authHeader.slice(7);
  try {
    return verifyToken(token);
  } catch {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
}

module.exports = { requireAuth };
