CREATE TABLE `eval_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`eval_set_id` text NOT NULL,
	`query` text NOT NULL,
	`expected_answer` text,
	`context` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`eval_set_id`) REFERENCES `eval_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `eval_criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`rubric` text NOT NULL,
	`score_type` text NOT NULL,
	`scale_config` text,
	`weight` real DEFAULT 1 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eval_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`case_id` text NOT NULL,
	`agent_response` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`total_tokens` integer,
	`tool_calls` text,
	`overall_score` real NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `eval_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `eval_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `eval_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`eval_set_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`status` text NOT NULL,
	`config` text,
	FOREIGN KEY (`eval_set_id`) REFERENCES `eval_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `eval_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`result_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`score_value` real,
	`score_category` text,
	`reasoning` text NOT NULL,
	`judge_model` text,
	`ensemble_run_id` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`result_id`) REFERENCES `eval_results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criterion_id`) REFERENCES `eval_criteria`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `eval_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`agent_id` text NOT NULL,
	`created_at` integer NOT NULL
);
