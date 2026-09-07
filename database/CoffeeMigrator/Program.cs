using CoffeeMigrator;

// ── 設定 ──────────────────────────────────────────────────
var config = new DbConfig
{
    Host     = Environment.GetEnvironmentVariable("DB_HOST") ?? "localhost",
    Port     = int.Parse(Environment.GetEnvironmentVariable("DB_PORT") ?? "3306"),
    User     = Environment.GetEnvironmentVariable("DB_USER") ?? "root",
    Password = Environment.GetEnvironmentVariable("DB_PASSWORD") ?? "",
    Database = Environment.GetEnvironmentVariable("DB_NAME") ?? "coffee",
};

// ── 執行 ──────────────────────────────────────────────────
var migrator = new Migrator(config);
await migrator.RunAsync();
