-- Reminders get no priority (shared/CONTRACT.md): recommendations lose the priority column.

ALTER TABLE recommendations DROP COLUMN priority;
