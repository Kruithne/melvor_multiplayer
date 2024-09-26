-- [1] table creation
CREATE TABLE `campaign_contributions` (
	`campaign_id` BIGINT UNSIGNED NOT NULL,
	`client_id` BIGINT UNSIGNED NOT NULL,
	`item_amount` BIGINT UNSIGNED NOT NULL DEFAULT 0,
	`taken` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`campaign_id`, `client_id`)
);

-- [2] change taken to BIGINT UNSIGNED
ALTER TABLE `campaign_contributions` MODIFY COLUMN `taken` BIGINT UNSIGNED NOT NULL DEFAULT 0;