-- =============================================================================
-- LINBO Docker - Database Initialization
-- PostgreSQL Schema
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Rooms
-- =============================================================================
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    location VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- Host Groups
-- =============================================================================
CREATE TABLE IF NOT EXISTS host_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    default_config_id UUID,
    defaults JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- Configurations (start.conf)
-- =============================================================================
CREATE TABLE IF NOT EXISTS configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    status VARCHAR(50) DEFAULT 'draft',
    linbo_settings JSONB NOT NULL DEFAULT '{}',
    created_by VARCHAR(255),
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- Hosts (Clients)
-- =============================================================================
CREATE TABLE IF NOT EXISTS hosts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hostname VARCHAR(255) UNIQUE NOT NULL,
    mac_address VARCHAR(17) UNIQUE NOT NULL,
    ip_address INET,
    room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
    group_id UUID REFERENCES host_groups(id) ON DELETE SET NULL,
    config_id UUID REFERENCES configs(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'offline',
    last_seen TIMESTAMP WITH TIME ZONE,
    boot_mode VARCHAR(50),
    hardware JSONB,
    cache_info JSONB,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- Config Partitions
-- =============================================================================
CREATE TABLE IF NOT EXISTS config_partitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_id UUID REFERENCES configs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    device VARCHAR(50) NOT NULL,
    label VARCHAR(255),
    size VARCHAR(50),
    partition_id INTEGER,
    fs_type VARCHAR(50),
    bootable BOOLEAN DEFAULT FALSE
);

-- =============================================================================
-- Config OS Definitions
-- =============================================================================
CREATE TABLE IF NOT EXISTS config_os (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_id UUID REFERENCES configs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    os_type VARCHAR(50),
    icon_name VARCHAR(255),
    base_image VARCHAR(255),
    differential_image VARCHAR(255),
    root_device VARCHAR(50),
    kernel VARCHAR(255),
    initrd VARCHAR(255),
    append TEXT[],
    start_enabled BOOLEAN DEFAULT TRUE,
    sync_enabled BOOLEAN DEFAULT TRUE,
    new_enabled BOOLEAN DEFAULT TRUE,
    autostart BOOLEAN DEFAULT FALSE,
    autostart_timeout INTEGER DEFAULT 0,
    default_action VARCHAR(50),
    prestart_script TEXT,
    postsync_script TEXT
);

-- =============================================================================
-- Images
-- =============================================================================
CREATE TABLE IF NOT EXISTS images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(255) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL,
    path VARCHAR(1024) NOT NULL,
    size BIGINT,
    checksum VARCHAR(64),
    backing_image VARCHAR(255),
    description TEXT,
    status VARCHAR(50) DEFAULT 'available',
    torrent_file VARCHAR(1024),
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    uploaded_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    last_used_by VARCHAR(255)
);

-- =============================================================================
-- Operations
-- =============================================================================
CREATE TABLE IF NOT EXISTS operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    target_hosts UUID[] NOT NULL,
    commands TEXT[] NOT NULL,
    options JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    stats JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- =============================================================================
-- Sessions
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operation_id UUID REFERENCES operations(id) ON DELETE CASCADE,
    host_id UUID REFERENCES hosts(id),
    hostname VARCHAR(255),
    tmux_session_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    log_file VARCHAR(1024),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- =============================================================================
-- Users
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'viewer',
    active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- API Keys
-- =============================================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]',
    rate_limit INTEGER,
    created_by UUID REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- Audit Logs
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actor VARCHAR(255) NOT NULL,
    actor_type VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id UUID,
    target_name VARCHAR(255),
    changes JSONB,
    status VARCHAR(50),
    error_message TEXT,
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(255)
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_hosts_status ON hosts(status);
CREATE INDEX IF NOT EXISTS idx_hosts_room ON hosts(room_id);
CREATE INDEX IF NOT EXISTS idx_hosts_group ON hosts(group_id);
CREATE INDEX IF NOT EXISTS idx_hosts_mac ON hosts(mac_address);
CREATE INDEX IF NOT EXISTS idx_sessions_operation ON sessions(operation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_host ON sessions(host_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);

-- =============================================================================
-- Default Admin User (password: admin - CHANGE IN PRODUCTION!)
-- Hash generated with: bcrypt.hashSync('admin', 10)
-- =============================================================================
INSERT INTO users (username, email, password_hash, role)
VALUES ('admin', 'admin@localhost', '$2a$10$20JYBTLuakYPfsXcrqR7beQXj7H/aLAYkxkMRop7fglp8mx7TnuMy', 'admin')
ON CONFLICT (username) DO NOTHING;

-- =============================================================================
-- Trigger for updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_hosts_updated_at
    BEFORE UPDATE ON hosts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rooms_updated_at
    BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_host_groups_updated_at
    BEFORE UPDATE ON host_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_configs_updated_at
    BEFORE UPDATE ON configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
