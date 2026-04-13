const Wheel = require('../../lib/wheel');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { restaurants } = req.body || {};

    const wheel = new Wheel();
    wheel.setRestaurant(restaurants);
    const result = wheel.spin();

    return res.status(200).json(result);
  } catch (err) {
    console.error('wheel/spin error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};
