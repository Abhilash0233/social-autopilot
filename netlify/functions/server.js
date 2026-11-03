// Netlify Functions entry — wraps the Express app for serverless.
const serverless = require('serverless-http');
const app = require('../../server');

exports.handler = serverless(app, {
  binary: ['image/*', 'video/*', 'application/octet-stream'],
});
