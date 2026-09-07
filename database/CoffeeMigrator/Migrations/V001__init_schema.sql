-- V001: 初始化 coffee 資料庫 schema

CREATE TABLE IF NOT EXISTS `myBeans` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `beans_name`  VARCHAR(100) DEFAULT NULL,
  `process`     VARCHAR(50)  DEFAULT NULL,
  `roast_level` VARCHAR(50)  DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `brews` (
  `id`          INT      NOT NULL AUTO_INCREMENT,
  `brewed_at`   DATETIME DEFAULT CURRENT_TIMESTAMP,
  `beans_name`  VARCHAR(100) DEFAULT NULL,
  `bean_id`     INT          DEFAULT NULL,
  `process`     VARCHAR(50)  DEFAULT NULL,
  `roast_level` VARCHAR(50)  DEFAULT NULL,
  `bean_weight` FLOAT        DEFAULT NULL,
  `grind`       FLOAT        DEFAULT NULL,
  `H_I`         ENUM('H','I') NOT NULL,
  `water_vol`   INT          DEFAULT NULL,
  `water_temp`  INT          DEFAULT NULL,
  `ice_vol`     INT          DEFAULT NULL,
  `sour`        TINYINT      DEFAULT NULL,
  `sweet`       TINYINT      DEFAULT NULL,
  `bitter`      TINYINT      DEFAULT NULL,
  `richness`    TINYINT      DEFAULT NULL,
  `aroma`       TINYINT      DEFAULT NULL,
  `notes`       TEXT,
  `starred`     TINYINT(1)   NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `fk_bean` (`bean_id`),
  CONSTRAINT `fk_bean`    FOREIGN KEY (`bean_id`) REFERENCES `myBeans` (`id`) ON DELETE SET NULL,
  CONSTRAINT `brews_chk_1` CHECK (`sour`     BETWEEN 1 AND 5),
  CONSTRAINT `brews_chk_2` CHECK (`sweet`    BETWEEN 1 AND 5),
  CONSTRAINT `brews_chk_3` CHECK (`bitter`   BETWEEN 1 AND 5),
  CONSTRAINT `brews_chk_4` CHECK (`richness` BETWEEN 1 AND 5),
  CONSTRAINT `brews_chk_5` CHECK (`aroma`    BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `pours` (
  `id`         INT     NOT NULL AUTO_INCREMENT,
  `brew_id`    INT     NOT NULL,
  `pour_order` TINYINT NOT NULL,
  `volume_ml`  INT     DEFAULT NULL,
  `duration_s` INT     DEFAULT NULL,
  `wait_s`     INT     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `brew_id` (`brew_id`),
  CONSTRAINT `pours_ibfk_1` FOREIGN KEY (`brew_id`) REFERENCES `brews` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
