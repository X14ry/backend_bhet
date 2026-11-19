-- BHET Social Discovery - MySQL 8.0+ schema
-- Run through `npm run db:migrate` (creates the database, then these tables).
-- Use `npm run db:reset` to drop and rebuild everything.


-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email          VARCHAR(255) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  date_of_birth  DATE NOT NULL,
  adult_confirmed_at DATETIME NOT NULL,
  role           ENUM('user','admin') NOT NULL DEFAULT 'user',
  status         ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------- profiles
-- One row per user. `intention` is the explicit connection goal (friendship / dating).
-- `broad_area` is a coarse area (e.g. "Kathmandu Valley"), never exact coordinates.
CREATE TABLE profiles (
  user_id      BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(50)  NOT NULL,
  short_bio    VARCHAR(300) NULL,
  photo_url    VARCHAR(500) NULL,
  intention    ENUM('friendship','dating') NOT NULL,
  broad_area   VARCHAR(100) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_profiles_discovery (intention, broad_area),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------ interests
CREATE TABLE interests (
  id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_interests_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_interests (
  user_id     BIGINT UNSIGNED NOT NULL,
  interest_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, interest_id),
  KEY idx_ui_interest (interest_id),
  CONSTRAINT fk_ui_user     FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE CASCADE,
  CONSTRAINT fk_ui_interest FOREIGN KEY (interest_id) REFERENCES interests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------ discovery preferences
CREATE TABLE discovery_preferences (
  user_id    BIGINT UNSIGNED NOT NULL,
  broad_area VARCHAR(100) NULL,               -- NULL = any area
  min_age    TINYINT UNSIGNED NOT NULL DEFAULT 18,
  max_age    TINYINT UNSIGNED NOT NULL DEFAULT 99,
  is_paused  TINYINT(1) NOT NULL DEFAULT 0,   -- "Pause discovery" / hide my profile
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT chk_pref_age CHECK (min_age >= 18 AND max_age >= min_age),
  CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- likes
-- One decision per ordered pair. A "like" in both directions creates a connection.
CREATE TABLE likes (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  from_user_id BIGINT UNSIGNED NOT NULL,
  to_user_id   BIGINT UNSIGNED NOT NULL,
  action       ENUM('like','pass') NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_likes_pair (from_user_id, to_user_id),
  KEY idx_likes_to (to_user_id, action),
  CONSTRAINT chk_likes_self CHECK (from_user_id <> to_user_id),
  CONSTRAINT fk_likes_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_likes_to   FOREIGN KEY (to_user_id)   REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------- connections
-- user_one_id is always the smaller id, so a pair can only exist once.
CREATE TABLE connections (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_one_id    BIGINT UNSIGNED NOT NULL,
  user_two_id    BIGINT UNSIGNED NOT NULL,
  intention      ENUM('friendship','dating') NOT NULL,
  shared_summary VARCHAR(255) NULL,
  status         ENUM('active','unmatched','blocked') NOT NULL DEFAULT 'active',
  ended_by       BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_connections_pair (user_one_id, user_two_id),
  KEY idx_connections_two (user_two_id),
  CONSTRAINT chk_conn_order CHECK (user_one_id < user_two_id),
  CONSTRAINT fk_conn_one FOREIGN KEY (user_one_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conn_two FOREIGN KEY (user_two_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------- messages
CREATE TABLE messages (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  connection_id BIGINT UNSIGNED NOT NULL,
  sender_id     BIGINT UNSIGNED NOT NULL,
  body          VARCHAR(2000) NOT NULL,
  read_at       DATETIME NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_messages_conn (connection_id, id),
  CONSTRAINT fk_msg_conn   FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id)     REFERENCES users(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------- trusted contacts
CREATE TABLE trusted_contacts (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  name       VARCHAR(100) NOT NULL,
  phone      VARCHAR(30)  NULL,
  email      VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tc_user (user_id),
  CONSTRAINT chk_tc_contact CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT fk_tc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------- venues
-- Public venues only. A user's exact location is never stored.
CREATE TABLE venues (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name      VARCHAR(120) NOT NULL,
  area      VARCHAR(100) NOT NULL,
  category  ENUM('cafe','park','library','market','other') NOT NULL DEFAULT 'cafe',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_venues_name_area (name, area)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------- meetup plans
CREATE TABLE meetup_plans (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  connection_id BIGINT UNSIGNED NOT NULL,
  proposed_by   BIGINT UNSIGNED NOT NULL,
  venue_id      INT UNSIGNED NOT NULL,
  scheduled_at  DATETIME NOT NULL,
  status        ENUM('proposed','accepted','declined','cancelled') NOT NULL DEFAULT 'proposed',
  shared_with_trusted_contact TINYINT(1) NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_meetup_conn (connection_id),
  CONSTRAINT fk_meetup_conn  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
  CONSTRAINT fk_meetup_user  FOREIGN KEY (proposed_by)   REFERENCES users(id)       ON DELETE CASCADE,
  CONSTRAINT fk_meetup_venue FOREIGN KEY (venue_id)      REFERENCES venues(id)      ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------- blocks
CREATE TABLE blocks (
  blocker_id BIGINT UNSIGNED NOT NULL,
  blocked_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  KEY idx_blocks_blocked (blocked_id),
  CONSTRAINT chk_block_self CHECK (blocker_id <> blocked_id),
  CONSTRAINT fk_block_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_block_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------- reports
-- Kept (IDs become NULL) if an account is deleted, so a review is not lost.
CREATE TABLE reports (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporter_id   BIGINT UNSIGNED NULL,
  reported_id   BIGINT UNSIGNED NULL,
  connection_id BIGINT UNSIGNED NULL,
  reason        ENUM('harassment','fake_profile','unsafe_behaviour','spam','other') NOT NULL,
  details       VARCHAR(1000) NULL,
  status        ENUM('open','reviewing','resolved','dismissed') NOT NULL DEFAULT 'open',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reports_status (status, created_at),
  KEY idx_reports_reported (reported_id),
  CONSTRAINT fk_report_reporter FOREIGN KEY (reporter_id)   REFERENCES users(id)       ON DELETE SET NULL,
  CONSTRAINT fk_report_reported FOREIGN KEY (reported_id)   REFERENCES users(id)       ON DELETE SET NULL,
  CONSTRAINT fk_report_conn     FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
