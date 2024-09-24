-- [1] table creation
CREATE TABLE `campaign_state` (
	`id` SERIAL,
	`campaign_id` VARCHAR(20) NOT NULL,
	`item_id` VARCHAR(255) NOT NULL,
	`item_amount` UNSIGNED INT NOT NULL,
	`item_current` UNSIGNED INT NOT NULL DEFAULT 0,
	`complete` UNSIGNED TINYINT NOT NULL DEFAULT 0,
	`campaign_next` UNSIGNED BIGINT NOT NULL DEFAULT 0
);