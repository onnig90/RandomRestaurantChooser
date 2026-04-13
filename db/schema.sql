CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------
-- Users
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user" (
    id_user       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(120) NOT NULL,
    phone         VARCHAR(20),
    email         VARCHAR(255) NOT NULL UNIQUE,
    location      VARCHAR(255),
    password_hash TEXT         NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_email ON "user"(email);

-- -------------------------------------------------------
-- Filters
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS filter (
    id_filter    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    cuisine      VARCHAR(100),
    price_range  VARCHAR(20),       -- '1'–'4' matching Google Places price_level
    min_rating   NUMERIC(2,1) CHECK (min_rating BETWEEN 0.0 AND 5.0),
    max_distance INTEGER,           -- metres
    open_hours   VARCHAR(50),       -- 'now' or 'HH:MM-HH:MM'
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------
-- UserFilter junction (one user can have many saved filter presets)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_filter (
    id_user    UUID        NOT NULL REFERENCES "user"(id_user) ON DELETE CASCADE,
    id_filter  UUID        NOT NULL REFERENCES filter(id_filter) ON DELETE CASCADE,
    label      VARCHAR(100),
    is_default BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id_user, id_filter)
);

CREATE INDEX IF NOT EXISTS idx_user_filter_user ON user_filter(id_user);

-- Enforce at most one default filter per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_filter_default
    ON user_filter(id_user)
    WHERE is_default = TRUE;
