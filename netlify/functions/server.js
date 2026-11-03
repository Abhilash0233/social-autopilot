// Netlify Functions entry — wraps the Express app for serverless.
const serverless = require('serverless-http');
const app = require('../../server');

exports.handler = serverless(app, {
  binary: ['image/*', 'video/*', 'application/octet-stream'],
  // Express 5 + older serverless-http left JSON bodies as Buffers; parse them here as a safety net.
  request(req) {
    if (Buffer.isBuffer(req.body)) {
      const raw = req.body.toString('utf8');
      if (!raw) {
        req.body = {};
        return;
      }
      const type = String(req.headers['content-type'] || '');
      if (type.includes('application/json')) {
        try { req.body = JSON.parse(raw); } catch { req.body = {}; }
      } else if (type.includes('text/csv') || type.includes('text/plain')) {
        req.body = raw;
      }
    }
  },
});
