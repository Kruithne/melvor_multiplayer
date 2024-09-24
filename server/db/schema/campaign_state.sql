-- [1] table creation
CREATE TABLE `campaign_state` (
	`id` SERIAL,
	`campaign_id` VARCHAR(20) NOT NULL,
	`item_id` VARCHAR(255) NOT NULL,
	`item_amount` INT UNSIGNED NOT NULL,
	`item_current` INT UNSIGNED NOT NULL DEFAULT 0,
	`complete` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`campaign_next` BIGINT UNSIGNED NOT NULL DEFAULT 0
);