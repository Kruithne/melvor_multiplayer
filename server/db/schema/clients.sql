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