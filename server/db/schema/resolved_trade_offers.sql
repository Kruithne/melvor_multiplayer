-- [1] table creation
CREATE TABLE `resolved_trade_offers` (
	`trade_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY,
	`client_id` BIGINT UNSIGNED NOT NULL,
	`sender_id` BIGINT UNSIGNED NOT NULL,
	INDEX `idx_client_id` (`client_id`)
);

-- [2] add `declined` field
ALTER TABLE `resolved_trade_offers` ADD COLUMN `declined` TINYINT(1) NOT NULL DEFAULT 0;