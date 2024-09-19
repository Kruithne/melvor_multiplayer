-- [1] table creation
CREATE TABLE `trade_offers` (
	`trade_id` SERIAL,
	`sender_id` BIGINT UNSIGNED NOT NULL,
	`recipient_id` BIGINT UNSIGNED NOT NULL,
	`attending_id` BIGINT UNSIGNED NOT NULL,
	`state` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	INDEX `idx_sender_id` (`sender_id`),
	INDEX `idx_recipient_id` (`recipient_id`)
);