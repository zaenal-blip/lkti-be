require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function randomValue(min, max) {
  return (Math.random() * (max - min) + min).toFixed(2);
}

async function seed() {
  try {
    await client.connect();
    console.log('Connected to database for seeding.');

    // Clear existing data (cascade will handle child tables)
    console.log('Clearing existing data...');
    await client.query('TRUNCATE TABLE devices, sensor_parameters CASCADE');

    // 1. Seed Device
    console.log('Seeding device...');
    const deviceRes = await client.query(`
      INSERT INTO devices (device_code, device_name, location, firmware_version, status, last_seen)
      VALUES ('ESP32-COOLANT-001', 'Primary Coolant Sensor', 'Line 1 Machining', 'v1.0.0', 'ONLINE', NOW())
      RETURNING id
    `);
    const deviceId = deviceRes.rows[0].id;

    // 2. Seed Parameters
    console.log('Seeding parameters...');
    const params = [
      { code: 'PH', name: 'pH', unit: 'pH', desc: 'Acidity/Alkalinity' },
      { code: 'EC', name: 'Electrical Conductivity', unit: 'mS/cm', desc: 'Conductivity of coolant' },
      { code: 'TURBIDITY', name: 'Turbidity', unit: 'NTU', desc: 'Suspended contamination' },
      { code: 'TEMPERATURE', name: 'Temperature', unit: '°C', desc: 'Coolant temperature' }
    ];

    const paramIds = {};
    for (const p of params) {
      const res = await client.query(`
        INSERT INTO sensor_parameters (code, name, unit, description)
        VALUES ($1, $2, $3, $4) RETURNING id
      `, [p.code, p.name, p.unit, p.desc]);
      paramIds[p.code] = res.rows[0].id;
    }

    // 3. Seed Evaluation Criteria
    console.log('Seeding criteria...');
    await client.query(`
      INSERT INTO evaluation_criteria (parameter_id, min_value, max_value, target_value) VALUES
      ($1, 8.0, 9.5, 8.8), -- pH
      ($2, 3.0, 6.0, 4.5), -- EC
      ($3, 0.0, 200.0, 50.0), -- Turbidity
      ($4, 20.0, 35.0, 25.0) -- Temperature
    `, [paramIds['PH'], paramIds['EC'], paramIds['TURBIDITY'], paramIds['TEMPERATURE']]);

    // 4. Seed Historical Data (30 Batches = 30 BEFORE + 30 AFTER)
    console.log('Seeding 30 historical samples...');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30); // 30 days ago
    
    for (let i = 1; i <= 30; i++) {
      const batchCode = `C${i.toString().padStart(3, '0')}`;
      const sampleDate = new Date(startDate.getTime() + (i * 24 * 60 * 60 * 1000));
      
      // -- BEFORE MEASUREMENT --
      // Sometimes create abnormal data for BEFORE to simulate dirty coolant
      const isAbnormal = Math.random() > 0.5;
      const beforePH = isAbnormal ? randomValue(6.5, 7.8) : randomValue(8.0, 8.5);
      const beforeEC = isAbnormal ? randomValue(6.1, 8.0) : randomValue(4.0, 5.8);
      const beforeTurbidity = isAbnormal ? randomValue(250, 400) : randomValue(150, 220);
      const beforeTemp = randomValue(28, 32);

      const beforeRes = await client.query(`
        INSERT INTO measurement_samples (sample_code, measurement_stage, measured_at, treatment_batch, device_id, notes)
        VALUES ($1, 'BEFORE', $2, $3, $4, 'Routine check') RETURNING id
      `, [`${batchCode}-BEFORE`, sampleDate, batchCode, deviceId]);
      const beforeId = beforeRes.rows[0].id;

      await client.query(`
        INSERT INTO measurement_values (sample_id, parameter_id, value) VALUES
        ($1, $2, $3), ($1, $4, $5), ($1, $6, $7), ($1, $8, $9)
      `, [
        beforeId, 
        paramIds['PH'], beforePH, 
        paramIds['EC'], beforeEC, 
        paramIds['TURBIDITY'], beforeTurbidity, 
        paramIds['TEMPERATURE'], beforeTemp
      ]);

      // -- TREATMENT RECORD --
      const treatmentDate = new Date(sampleDate.getTime() + (2 * 60 * 60 * 1000)); // 2 hours later
      await client.query(`
        INSERT INTO treatment_records (sample_id, treatment_method, treatment_duration, notes)
        VALUES ($1, 'Filtration & pH Adjustment', 120, 'Standard treatment protocol applied')
      `, [beforeId]);

      // -- AFTER MEASUREMENT --
      const afterRes = await client.query(`
        INSERT INTO measurement_samples (sample_code, measurement_stage, measured_at, treatment_batch, device_id, notes)
        VALUES ($1, 'AFTER', $2, $3, $4, 'Post-treatment verification') RETURNING id
      `, [`${batchCode}-AFTER`, treatmentDate, batchCode, deviceId]);
      const afterId = afterRes.rows[0].id;

      // After values should be closer to ideal targets
      const afterPH = randomValue(8.5, 9.2);
      const afterEC = randomValue(3.5, 4.8);
      const afterTurbidity = randomValue(30, 90);
      const afterTemp = randomValue(25, 29);

      await client.query(`
        INSERT INTO measurement_values (sample_id, parameter_id, value) VALUES
        ($1, $2, $3), ($1, $4, $5), ($1, $6, $7), ($1, $8, $9)
      `, [
        afterId, 
        paramIds['PH'], afterPH, 
        paramIds['EC'], afterEC, 
        paramIds['TURBIDITY'], afterTurbidity, 
        paramIds['TEMPERATURE'], afterTemp
      ]);
    }

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Seeding failed:', error);
  } finally {
    await client.end();
  }
}

seed();
