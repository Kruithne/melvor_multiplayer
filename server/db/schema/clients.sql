-- [1] table creation
CREATE TABLE `clients` (
	`id` SERIAL,
	`client_identifier` VARCHAR(36) NOT NULL,
	`client_key` VARCHAR(36) NOT NULL,
	INDEX `idx_client_identifier` (`client_identifier`)
);

-- [2] add friend code column
ALTER TABLE `clients` ADD COLUMN `friend_code` VARCHAR(11) NOT NULL;
CREATE INDEX `idx_friend_code` ON `clients` (`friend_code`);

-- [3] add display_name column
ALTER TABLE `clients` ADD COLUMN `display_name` VARCHAR(20) NOT NULL;

-- [4] add icon_id column
ALTER TABLE `clients` ADD COLUMN `icon_id` VARCHAR(60) NOT NULL;

-- [5] add last_charity column
ALTER TABLE `clients` ADD COLUMN `last_charity` BIGINT NOT NULL DEFAULT 0;