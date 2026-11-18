const axios = require('axios');

const API_URL = 'http://localhost:3000/api/measurements';

// Base realistic values
let ph = 9.1;
let ec = 3.7;
let turbidity = 65.0;
let temp = 26.5;

// Random walk parameters
const randomWalk = (val, min, max, step) => {
  let change = (Math.random() * step * 2) - step;
  let newVal = val + change;
  if (newVal < min) newVal = min;
  if (newVal > max) newVal = max;
  return Number(newVal.toFixed(2));
};

console.log('--- ESP32 Simulator Started ---');
console.log(`Sending data to ${API_URL} every 5 seconds...`);

setInterval(async () => {
  // Update values slightly
  ph = randomWalk(ph, 8.8, 9.5, 0.05);
  ec = randomWalk(ec, 3.0, 4.5, 0.1);
  turbidity = randomWalk(turbidity, 40, 80, 2.0);
  temp = randomWalk(temp, 25.0, 30.0, 0.2);

  const payload = {
    device_id: "ESP32-COOLANT-001",
    ph: ph,
    ec: ec,
    turbidity: turbidity,
    temperature: temp
  };

  try {
    const response = await axios.post(API_URL, payload);
    console.log(`[${new Date().toLocaleTimeString()}] Data Sent -> pH: ${ph}, EC: ${ec}, Turb: ${turbidity}, Temp: ${temp} | Resp: ${response.status}`);
  } catch (error) {
    console.error(`[${new Date().toLocaleTimeString()}] Error sending data:`, error.message);
  }
}, 5000);
