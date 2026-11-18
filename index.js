const express = require('express');
const os = require('os');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// GET /api/dashboard/summary
app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const totalSamples = await db.query('SELECT COUNT(*) FROM measurement_samples');
    
    // Total BEFORE and AFTER
    const stages = await db.query('SELECT measurement_stage, COUNT(*) FROM measurement_samples GROUP BY measurement_stage');
    let beforeCount = 0;
    let afterCount = 0;
    stages.rows.forEach(row => {
      if (row.measurement_stage === 'BEFORE') beforeCount = parseInt(row.count);
      if (row.measurement_stage === 'AFTER') afterCount = parseInt(row.count);
    });

    const activeParams = await db.query('SELECT COUNT(*) FROM sensor_parameters WHERE is_active = true');

    res.json({
      success: true,
      data: {
        totalSamples: parseInt(totalSamples.rows[0].count),
        beforeMeasurements: beforeCount,
        afterMeasurements: afterCount,
        parametersMonitored: parseInt(activeParams.rows[0].count)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/measurements/latest
// Ambil nilai terbaru per-parameter secara independen,
// sehingga selalu tampil 4 sensor meski sample terbaru tidak lengkap.
app.get('/api/measurements/latest', async (req, res) => {
  try {
    // DISTINCT ON: ambil 1 baris terbaru per parameter_id
    const valuesQuery = await db.query(`
      SELECT DISTINCT ON (mv.parameter_id)
        sp.code, sp.name, sp.unit, mv.value,
        ms.measured_at,
        ec.min_value, ec.max_value, ec.target_value
      FROM measurement_values mv
      JOIN sensor_parameters sp ON mv.parameter_id = sp.id
      JOIN measurement_samples ms ON mv.sample_id = ms.id
      LEFT JOIN evaluation_criteria ec ON ec.parameter_id = sp.id
      WHERE sp.is_active = true
      ORDER BY mv.parameter_id, ms.measured_at DESC
    `);

    if (valuesQuery.rows.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const formattedData = valuesQuery.rows.map(row => {
      let status = 'Within Defined Criteria';
      let statusCode = 'GREEN';

      const val = parseFloat(row.value);
      if (row.min_value !== null && row.max_value !== null) {
        if (val < row.min_value || val > row.max_value) {
          status = 'Further Verification Required';
          statusCode = 'RED';
        }
      }

      return {
        parameter: row.code,
        name: row.name,
        value: val,
        unit: row.unit,
        timestamp: row.measured_at,
        status: status,
        statusCode: statusCode
      };
    });

    res.json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/measurements/history
app.get('/api/measurements/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    
    const historyQuery = await db.query(`
      SELECT 
        ms.id, ms.sample_code, ms.measurement_stage, ms.measured_at, d.device_code,
        json_object_agg(sp.code, mv.value) as sensor_values
      FROM measurement_samples ms
      LEFT JOIN devices d ON ms.device_id = d.id
      LEFT JOIN measurement_values mv ON mv.sample_id = ms.id
      LEFT JOIN sensor_parameters sp ON mv.parameter_id = sp.id
      GROUP BY ms.id, ms.sample_code, ms.measurement_stage, ms.measured_at, d.device_code
      ORDER BY ms.measured_at DESC
      LIMIT $1
    `, [limit]);

    res.json({
      success: true,
      data: historyQuery.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /api/measurements (Data Ingestion from ESP32)
// GET /api/ping - Health check untuk ESP32
app.get('/api/ping', (req, res) => {
  res.json({ success: true, message: 'pong', timestamp: new Date().toISOString() });
});

// POST /api/measurements (Data Ingestion from ESP32)
app.post('/api/measurements', async (req, res) => {
  try {
    // Expected payload: { "device_id": "ESP32-COOLANT-001", "ph": 9.19, "ec": 3.77, "turbidity": 66.08, "temperature": 26.88 }
    const payload = req.body;

    // Look up device_id in DB
    let deviceIdDb = null;
    if (payload.device_id) {
      const devQuery = await db.query('SELECT id FROM devices WHERE device_code = $1', [payload.device_id]);
      if (devQuery.rows.length > 0) {
        deviceIdDb = devQuery.rows[0].id;
      }
    }

    if (!deviceIdDb) {
      return res.status(400).json({ success: false, error: 'Invalid or missing device_id' });
    }

    // Auto-update device status jadi ONLINE + catat last_seen
    await db.query(
      `UPDATE devices SET status = 'ONLINE', last_seen = NOW(), updated_at = NOW() WHERE id = $1`,
      [deviceIdDb]
    );

    // Create new sample record (ROUTINE)
    const sampleCode = `ROUTINE-${Date.now()}`;
    const insertSample = await db.query(
      `INSERT INTO measurement_samples (device_id, sample_code, measurement_stage) VALUES ($1, $2, 'ROUTINE') RETURNING id`,
      [deviceIdDb, sampleCode]
    );
    const sampleId = insertSample.rows[0].id;

    // Get parameters map
    const paramsQuery = await db.query('SELECT id, code FROM sensor_parameters WHERE is_active = true');
    const paramMap = {};
    paramsQuery.rows.forEach(p => { paramMap[p.code] = p.id; });

    // Insert values — hanya sensor yang dikirim ESP32 (tidak wajib semua)
    const insertValue = async (code, valKey) => {
      if (paramMap[code] && payload[valKey] !== undefined && payload[valKey] !== null) {
        await db.query(
          `INSERT INTO measurement_values (sample_id, parameter_id, value) VALUES ($1, $2, $3)`,
          [sampleId, paramMap[code], payload[valKey]]
        );
      }
    };

    await insertValue('PH', 'ph');
    await insertValue('EC', 'ec');
    await insertValue('TURBIDITY', 'turbidity');
    await insertValue('TEMPERATURE', 'temperature');

    console.log(`[${new Date().toLocaleTimeString()}] Data diterima dari ${payload.device_id} -> pH: ${payload.ph}, EC: ${payload.ec}, Turb: ${payload.turbidity}, Temp: ${payload.temperature}`);

    res.status(201).json({ success: true, message: 'Data saved successfully', sampleId });
  } catch (error) {
    console.error('Error saving sensor data:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/devices
app.get('/api/devices', async (req, res) => {
  try {
    const devices = await db.query('SELECT * FROM devices ORDER BY id ASC');
    res.json({
      success: true,
      data: devices.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/samples/:sampleCode
app.get('/api/samples/:sampleCode', async (req, res) => {
  try {
    const { sampleCode } = req.params;
    
    // Get sample info
    const sampleQuery = await db.query(`
      SELECT ms.*, d.device_code, d.device_name 
      FROM measurement_samples ms
      LEFT JOIN devices d ON ms.device_id = d.id
      WHERE ms.sample_code = $1
    `, [sampleCode]);
    
    if (sampleQuery.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Sample not found' });
    }
    
    const sample = sampleQuery.rows[0];
    
    // Get treatment record if any
    const treatmentQuery = await db.query('SELECT * FROM treatment_records WHERE sample_id = $1', [sample.id]);
    const treatment = treatmentQuery.rows.length > 0 ? treatmentQuery.rows[0] : null;

    // Get sensor values with evaluation
    const valuesQuery = await db.query(`
      SELECT 
        sp.code, sp.name, sp.unit, mv.value, 
        ec.min_value, ec.max_value
      FROM measurement_values mv
      JOIN sensor_parameters sp ON mv.parameter_id = sp.id
      LEFT JOIN evaluation_criteria ec ON ec.parameter_id = sp.id
      WHERE mv.sample_id = $1
    `, [sample.id]);

    const results = valuesQuery.rows.map(row => {
      let status = 'Within Defined Criteria';
      let statusCode = 'GREEN';
      const val = parseFloat(row.value);
      
      if (row.min_value !== null && row.max_value !== null) {
        if (val < row.min_value || val > row.max_value) {
          status = 'Further Verification Required';
          statusCode = 'RED';
        }
      }
      return {
        parameter: row.code,
        name: row.name,
        value: val,
        unit: row.unit,
        status,
        statusCode
      };
    });

    res.json({
      success: true,
      data: {
        sample_info: sample,
        treatment_info: treatment,
        sensor_results: results
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /api/analysis/before-after/:batchId
app.get('/api/analysis/before-after/:batchId', async (req, res) => {
  try {
    const { batchId } = req.params;

    // Fetch BEFORE and AFTER samples for the batch
    const samplesQuery = await db.query(`
      SELECT id, sample_code, measurement_stage, measured_at 
      FROM measurement_samples 
      WHERE treatment_batch = $1
    `, [batchId]);

    const beforeSample = samplesQuery.rows.find(s => s.measurement_stage === 'BEFORE');
    const afterSample = samplesQuery.rows.find(s => s.measurement_stage === 'AFTER');

    if (!beforeSample || !afterSample) {
      return res.status(404).json({ success: false, error: 'Complete Before/After data not found for this batch' });
    }

    // Fetch values for BEFORE
    const beforeValues = await db.query(`
      SELECT sp.code, sp.name, sp.unit, mv.value 
      FROM measurement_values mv
      JOIN sensor_parameters sp ON mv.parameter_id = sp.id
      WHERE mv.sample_id = $1
    `, [beforeSample.id]);

    // Fetch values for AFTER
    const afterValues = await db.query(`
      SELECT sp.code, sp.name, sp.unit, mv.value 
      FROM measurement_values mv
      JOIN sensor_parameters sp ON mv.parameter_id = sp.id
      WHERE mv.sample_id = $1
    `, [afterSample.id]);

    const comparison = [];

    beforeValues.rows.forEach(b => {
      const a = afterValues.rows.find(av => av.code === b.code);
      if (a) {
        const valBefore = parseFloat(b.value);
        const valAfter = parseFloat(a.value);
        const absDiff = valAfter - valBefore;
        let pctChange = null;
        if (valBefore !== 0) {
          pctChange = ((absDiff / valBefore) * 100).toFixed(2);
        }
        
        comparison.push({
          parameter: b.code,
          name: b.name,
          unit: b.unit,
          beforeValue: valBefore,
          afterValue: valAfter,
          absoluteDifference: absDiff.toFixed(2),
          percentageChange: pctChange
        });
      }
    });

    res.json({
      success: true,
      data: {
        batch: batchId,
        measuredAtBefore: beforeSample.measured_at,
        measuredAtAfter: afterSample.measured_at,
        comparison: comparison
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=== API Server running on port ${PORT} ===`);
  console.log(`Local:   http://localhost:${PORT}`);

  // Tampilkan semua IP jaringan lokal (untuk dikonfigurasi di ESP32)
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`Network: http://${net.address}:${PORT}  <-- gunakan IP ini di ESP32`);
      }
    }
  }
  console.log('=========================================\n');
});
