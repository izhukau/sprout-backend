CREATE TABLE `topic_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`original_filename` text NOT NULL,
	`s3_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`extracted_text` text,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`extraction_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `topic_documents_node_id_idx` ON `topic_documents` (`node_id`);