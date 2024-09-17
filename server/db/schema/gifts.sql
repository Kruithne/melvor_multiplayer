-- [1] table creation
CREATE TABLE `gifts` (
	`gift_id` SERIAL,
	`client_id` BIGINT UNSIGNED NOT NULL,
	`sender_id` BIGINT UNSIGNED NOT NULL,
	`flags` INT UNSIGNED NOT NULL DEFAULT 0,
	INDEX `idx_client_id` (`client_id`)
);