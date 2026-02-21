CREATE TABLE `node_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`source_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `node_edges_source_idx` ON `node_edges` (`source_node_id`);--> statement-breakpoint
CREATE INDEX `node_edges_target_idx` ON `node_edges` (`target_node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `node_edges_source_target_idx` ON `node_edges` (`source_node_id`,`target_node_id`);