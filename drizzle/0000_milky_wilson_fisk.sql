CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`question_id` text NOT NULL,
	`answer_text` text,
	`selected_option` text,
	`is_correct` integer,
	`score` real,
	`feedback` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `answers_user_assessment_idx` ON `answers` (`user_id`,`assessment_id`);--> statement-breakpoint
CREATE INDEX `answers_question_id_idx` ON `answers` (`question_id`);--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`type` text DEFAULT 'diagnostic' NOT NULL,
	`title` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assessments_user_node_type_idx` ON `assessments` (`user_id`,`target_node_id`,`type`);--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `branches_user_id_idx` ON `branches` (`user_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`kind` text DEFAULT 'learning' NOT NULL,
	`content` text NOT NULL,
	`was_successful` integer,
	`success_signal` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_messages_session_created_idx` ON `chat_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_messages_user_successful_idx` ON `chat_messages` (`user_id`,`was_successful`);--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`node_id` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_sessions_user_started_idx` ON `chat_sessions` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `chat_sessions_node_started_idx` ON `chat_sessions` (`node_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `hint_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`node_id` text NOT NULL,
	`session_id` text,
	`request_message_id` text,
	`response_message_id` text,
	`referenced_success_message_ids` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`response_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hint_events_user_node_created_idx` ON `hint_events` (`user_id`,`node_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `node_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`explanation_md` text NOT NULL,
	`visualization_kind` text,
	`visualization_payload` text,
	`generated_by_model` text,
	`generation_prompt_hash` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `node_contents_node_status_idx` ON `node_contents` (`node_id`,`status`);--> statement-breakpoint
CREATE TABLE `node_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`trigger` text NOT NULL,
	`model` text,
	`prompt` text,
	`response_meta` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `node_generations_node_created_idx` ON `node_generations` (`node_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`branch_id` text,
	`parent_id` text,
	`title` text NOT NULL,
	`desc` text,
	`accuracy_score` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `nodes_user_type_idx` ON `nodes` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `nodes_branch_id_idx` ON `nodes` (`branch_id`);--> statement-breakpoint
CREATE INDEX `nodes_parent_id_idx` ON `nodes` (`parent_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`assessment_id` text NOT NULL,
	`node_id` text,
	`format` text NOT NULL,
	`prompt` text NOT NULL,
	`options` text,
	`correct_answer` text,
	`grading_rubric` text,
	`difficulty` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `questions_assessment_id_idx` ON `questions` (`assessment_id`);--> statement-breakpoint
CREATE INDEX `questions_node_id_idx` ON `questions` (`node_id`);--> statement-breakpoint
CREATE TABLE `user_node_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`node_id` text NOT NULL,
	`first_entered_at` text,
	`last_entered_at` text,
	`completed_at` text,
	`mastery_score` real DEFAULT 0 NOT NULL,
	`attempts_count` integer DEFAULT 0 NOT NULL,
	`has_generated_subnodes` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_node_progress_user_node_idx` ON `user_node_progress` (`user_id`,`node_id`);--> statement-breakpoint
CREATE INDEX `user_node_progress_node_mastery_idx` ON `user_node_progress` (`node_id`,`mastery_score`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`title` text,
	`desc` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);