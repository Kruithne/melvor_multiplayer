-- [1] table creation
CREATE TABLE `client_sessions` (
	`session_token` VARCHAR(36) PRIMARY KEY,
	`client_id` BIGINT UNSIGNED NOT NULL,
	INDEX `idx_client_id` (`client_id`)
);