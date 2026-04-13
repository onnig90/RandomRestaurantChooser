const { randomInt } = require('crypto');

class Wheel {
  constructor() {
    this.restaurants = [];
  }

  setRestaurant(list) {
    if (!Array.isArray(list) || list.length === 0) {
      const err = new Error('Restaurant list must be a non-empty array');
      err.status = 400;
      throw err;
    }
    this.restaurants = list;
  }

  spin() {
    const index = randomInt(0, this.restaurants.length);
    return { selected: this.restaurants[index], index };
  }
}

module.exports = Wheel;
