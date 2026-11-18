ALTER TABLE `myBeans`
  ADD COLUMN `is_finished` TINYINT(1) NOT NULL DEFAULT 0,
  ADD CONSTRAINT `myBeans_chk_finished` CHECK (`is_finished` IN (0, 1));
