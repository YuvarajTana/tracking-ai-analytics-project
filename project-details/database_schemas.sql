-- PostgreSQL Database Schema
-- File: database/migrations/001_initial_schema.sql

-- Users table
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    properties JSONB DEFAULT '{}',
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    session_end TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    page_views INTEGER DEFAULT 0,
    events_count INTEGER DEFAULT 0,
    platform VARCHAR(20) CHECK (platform IN ('web', 'android', 'ios')),
    device_info JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    country VARCHAR(2),
    city VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Projects/Apps table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    settings JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Dashboards table
CREATE TABLE dashboards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    layout JSONB DEFAULT '[]',
    filters JSONB DEFAULT '{}',
    is_public BOOLEAN DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- AI Queries log table
CREATE TABLE ai_queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    project_id UUID REFERENCES projects(id),
    natural_language_query TEXT NOT NULL,
    generated_sql TEXT,
    execution_time_ms INTEGER,
    result_count INTEGER,
    error_message TEXT,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- API Keys table for authentication
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    key_name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    permissions JSONB DEFAULT '{}',
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Refresh tokens table
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_last_seen ON users(last_seen);
CREATE INDEX idx_users_properties ON users USING gin(properties);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_start_time ON sessions(session_start);
CREATE INDEX idx_sessions_platform ON sessions(platform);

CREATE INDEX idx_projects_api_key ON projects(api_key);
CREATE INDEX idx_projects_created_by ON projects(created_by);

CREATE INDEX idx_dashboards_project_id ON dashboards(project_id);
CREATE INDEX idx_dashboards_created_by ON dashboards(created_by);

CREATE INDEX idx_ai_queries_user_id ON ai_queries(user_id);
CREATE INDEX idx_ai_queries_project_id ON ai_queries(project_id);
CREATE INDEX idx_ai_queries_created_at ON ai_queries(created_at);

CREATE INDEX idx_api_keys_project_id ON api_keys(project_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- Create update trigger for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dashboards_updated_at BEFORE UPDATE ON dashboards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- ClickHouse Schema for Events
-- File: database/clickhouse-init.sql
-- ========================================

-- Events table (ClickHouse)
CREATE DATABASE IF NOT EXISTS analytics;

USE analytics;

CREATE TABLE events (
    id UUID DEFAULT generateUUIDv4(),
    project_id String,
    user_id String,
    session_id String,
    event_name String,
    properties Map(String, String),
    timestamp DateTime DEFAULT now(),
    ip String,
    user_agent String,
    platform Enum('web' = 1, 'android' = 2, 'ios' = 3),
    country String,
    city String,
    device_type Enum('desktop' = 1, 'mobile' = 2, 'tablet' = 3),
    browser String,
    os String,
    screen_resolution String,
    referrer String,
    utm_source String,
    utm_medium String,
    utm_campaign String,
    utm_content String,
    utm_term String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, user_id, event_name)
SETTINGS index_granularity = 8192;

-- Page views materialized view for faster queries
CREATE MATERIALIZED VIEW page_views_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, toDate(timestamp), properties['page'])
AS SELECT
    project_id,
    toDate(timestamp) as date,
    properties['page'] as page,
    count() as views,
    uniq(user_id) as unique_users,
    uniq(session_id) as unique_sessions
FROM events
WHERE event_name = 'page_view'
GROUP BY project_id, date, page;

-- User sessions materialized view
CREATE MATERIALIZED VIEW user_sessions_mv
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, user_id, session_id)
AS SELECT
    project_id,
    user_id,
    session_id,
    min(timestamp) as session_start,
    max(timestamp) as session_end,
    count() as events_count,
    uniq(if(event_name = 'page_view', properties['page'], null)) as pages_visited,
    platform,
    country,
    city
FROM events
GROUP BY project_id, user_id, session_id, platform, country, city;

-- Daily active users materialized view
CREATE MATERIALIZED VIEW daily_active_users_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date)
AS SELECT
    project_id,
    toDate(timestamp) as date,
    uniq(user_id) as active_users,
    uniq(session_id) as sessions,
    count() as total_events
FROM events
GROUP BY project_id, date;

-- Event names aggregation for quick lookups
CREATE MATERIALIZED VIEW event_names_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, event_name, toDate(timestamp))
AS SELECT
    project_id,
    event_name,
    toDate(timestamp) as date,
    count() as event_count,
    uniq(user_id) as unique_users
FROM events
GROUP BY project_id, event_name, date;

-- ========================================
-- Database Initialization Script
-- File: database/init.sql
-- ========================================

-- This script runs when PostgreSQL container starts
\c analytics;

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create initial admin user
INSERT INTO users (id, email, first_name, last_name, properties) VALUES
(uuid_generate_v4(), 'admin@company.com', 'Admin', 'User', '{"role": "admin"}')
ON CONFLICT (email) DO NOTHING;

-- Create sample project
INSERT INTO projects (id, name, api_key, description, created_by) VALUES
(uuid_generate_v4(), 'Demo Project', 'demo_' || encode(gen_random_bytes(16), 'hex'), 'Sample project for testing', 
(SELECT id FROM users WHERE email = 'admin@company.com' LIMIT 1))
ON CONFLICT (api_key) DO NOTHING;

-- Create sample dashboard
INSERT INTO dashboards (project_id, name, description, created_by) VALUES
((SELECT id FROM projects WHERE name = 'Demo Project' LIMIT 1), 'Main Dashboard', 'Default dashboard', 
(SELECT id FROM users WHERE email = 'admin@company.com' LIMIT 1));

-- ========================================
-- Migration Script
-- File: backend/scripts/migrate.js
-- ========================================

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function runMigrations() {
    try {
        console.log('Running database migrations...');
        
        const migrationFile = fs.readFileSync(
            path.join(__dirname, '../../database/migrations/001_initial_schema.sql'),
            'utf8'
        );
        
        await pool.query(migrationFile);
        console.log('✅ PostgreSQL migrations completed successfully');
        
        // You would also run ClickHouse migrations here
        console.log('✅ All migrations completed');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    runMigrations();
}

module.exports = runMigrations;

-- ========================================
-- Sample Data Seeds
-- File: database/seeds/001_sample_data.sql
-- ========================================

-- Insert sample users
INSERT INTO users (email, first_name, last_name, properties) VALUES
('john.doe@company.com', 'John', 'Doe', '{"department": "engineering", "role": "developer"}'),
('jane.smith@company.com', 'Jane', 'Smith', '{"department": "marketing", "role": "manager"}'),
('bob.wilson@company.com', 'Bob', 'Wilson', '{"department": "sales", "role": "rep"}')
ON CONFLICT (email) DO NOTHING;

-- Insert sample sessions
INSERT INTO sessions (user_id, platform, device_info, ip_address, country, city) VALUES
((SELECT id FROM users WHERE email = 'john.doe@company.com'), 'web', '{"browser": "Chrome", "os": "macOS"}', '192.168.1.100', 'US', 'San Francisco'),
((SELECT id FROM users WHERE email = 'jane.smith@company.com'), 'android', '{"device": "Pixel 7", "os": "Android 13"}', '192.168.1.101', 'US', 'New York'),
((SELECT id FROM users WHERE email = 'bob.wilson@company.com'), 'web', '{"browser": "Firefox", "os": "Windows"}', '192.168.1.102', 'US', 'Chicago');

-- ========================================
-- Performance Optimization Queries
-- File: database/optimize.sql
-- ========================================

-- Optimize PostgreSQL
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
ALTER SYSTEM SET pg_stat_statements.track = 'all';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET work_mem = '8MB';
ALTER SYSTEM SET maintenance_work_mem = '128MB';

-- ClickHouse optimization settings
-- Add these to clickhouse-server config:
-- <max_memory_usage>1000000000</max_memory_usage>
-- <max_threads>4</max_threads>
-- <max_query_size>268435456</max_query_size>