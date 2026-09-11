ALTER TABLE `brews`
  ADD COLUMN `source_brew_id` INT DEFAULT NULL,
  ADD KEY `idx_brews_source` (`source_brew_id`),
  ADD CONSTRAINT `fk_brews_source` FOREIGN KEY (`source_brew_id`)
    REFERENCES `brews` (`id`) ON DELETE SET NULL;
