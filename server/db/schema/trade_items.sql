-- [1] table creation
CREATE TABLE `trade_items` (
	`id` SERIAL,
	`trade_id` BIGINT UNSIGNED NOT NULL,
	`item_id` VARCHAR(255) NOT NULL,
	`qty` BIGINT UNSIGNED NOT NULL,
	`counter` TINYINT UNSIGNED NOT NULL,
	INDEX `idx_trade_id` (`trade_id`)
);