-- [1] table creation
CREATE TABLE `clients` (
	`id` SERIAL,
	`client_identifier` VARCHAR(36) NOT NULL,
	`client_key` VARCHAR(36) NOT NULL,
	INDEX `idx_client_identifier` (`client_identifier`)
);