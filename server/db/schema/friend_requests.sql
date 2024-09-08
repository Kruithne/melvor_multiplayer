-- [1] table creation
CREATE TABLE `friend_requests` (
	`request_id` SERIAL,
	`client_id` BIGINT UNSIGNED NOT NULL,
	`friend_id` BIGINT UNSIGNED NOT NULL,
	INDEX `idx_friend_id` (`friend_id`),
	INDEX `idx_client_id` (`client_id`)
);