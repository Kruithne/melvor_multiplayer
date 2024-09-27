-- [1] table creation
CREATE TABLE `market_items` (
	`id` SERIAL,
	`client_id` BIGINT UNSIGNED NOT NULL,
	`item_id` VARCHAR(255) NOT NULL,
	`qty` BIGINT UNSIGNED NOT NULL,
	`sold` BIGINT UNSIGNED NOT NULL DEFAULT 0,
	`price` BIGINT UNSIGNED NOT NULL
);

-- [2] create indexes
CREATE INDEX `idx_item_id` ON `market_items` (`item_id`);
CREATE INDEX `idx_price` ON `market_items` (`price`);
CREATE INDEX `idx_client_id` ON `market_items` (`client_id`);
CREATE INDEX `idx_item_id_price` ON `market_items` (`item_id`, `price`);