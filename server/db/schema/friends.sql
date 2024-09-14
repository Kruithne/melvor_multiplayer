-- [1] table creation
CREATE TABLE `friends` (
	`client_id_a` BIGINT UNSIGNED NOT NULL,
	`client_id_b` BIGINT UNSIGNED NOT NULL,
	PRIMARY KEY (`client_id_a`, `client_id_b`)
);

CREATE INDEX `idx_client_id_a` ON `friends` (`client_id_a`);
CREATE INDEX `idx_client_id_b` ON `friends` (`client_id_b`);