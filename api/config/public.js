const { getBrowserApiKey } = require('../../lib/googleMaps');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({
    googleMapsBrowserApiKey: getBrowserApiKey(),
  });
};
