-- [1] table creation
CREATE TABLE `gift_items` (
	`id` SERIAL,
	`gift_id` BIGINT UNSIGNED NOT NULL,
	`item_id` VARCHAR(255) NOT NULL,
	`qty` BIGINT UNSIGNED NOT NULL,
	INDEX `idx_gift_id` (`gift_id`)
);