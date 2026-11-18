-- Devices Table
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    device_code VARCHAR(100) UNIQUE NOT NULL,
    device_name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    firmware_version VARCHAR(50),
    status VARCHAR(50) DEFAULT 'OFFLINE',
    last_seen TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sensor Parameters Table
CREATE TABLE IF NOT EXISTS sensor_parameters (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    unit VARCHAR(20),
    description TEXT,
    min_value DECIMAL(10, 4),
    max_value DECIMAL(10, 4),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Measurement Samples Table
CREATE TABLE IF NOT EXISTS measurement_samples (
    id SERIAL PRIMARY KEY,
    sample_code VARCHAR(100) NOT NULL,
    measurement_stage VARCHAR(50) NOT NULL, -- 'BEFORE' or 'AFTER'
    measured_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    treatment_batch VARCHAR(100),
    device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Measurement Values Table
CREATE TABLE IF NOT EXISTS measurement_values (
    id SERIAL PRIMARY KEY,
    sample_id INTEGER NOT NULL REFERENCES measurement_samples(id) ON DELETE CASCADE,
    parameter_id INTEGER NOT NULL REFERENCES sensor_parameters(id) ON DELETE CASCADE,
    value DECIMAL(15, 4) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Treatment Records Table
CREATE TABLE IF NOT EXISTS treatment_records (
    id SERIAL PRIMARY KEY,
    sample_id INTEGER NOT NULL REFERENCES measurement_samples(id) ON DELETE CASCADE,
    treatment_method VARCHAR(255) NOT NULL,
    treatment_duration INTEGER, -- duration in minutes or seconds
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Evaluation Criteria Table
CREATE TABLE IF NOT EXISTS evaluation_criteria (
    id SERIAL PRIMARY KEY,
    parameter_id INTEGER NOT NULL REFERENCES sensor_parameters(id) ON DELETE CASCADE,
    min_value DECIMAL(10, 4),
    max_value DECIMAL(10, 4),
    target_value DECIMAL(10, 4),
    effective_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    effective_until TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
