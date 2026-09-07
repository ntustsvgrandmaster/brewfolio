using System.Reflection;
using System.Text.RegularExpressions;
using MySqlConnector;

namespace CoffeeMigrator;

public record DbConfig
{
    public required string Host     { get; init; }
    public required int    Port     { get; init; }
    public required string User     { get; init; }
    public required string Password { get; init; }
    public required string Database { get; init; }

    public string ConnectionString => new MySqlConnectionStringBuilder
    {
        Server = Host,
        Port = checked((uint)Port),
        UserID = User,
        Password = Password,
        Database = Database,
        AllowUserVariables = true,
    }.ConnectionString;
}

// 從檔名解析出來的 migration 資訊
// 檔名格式：V001__init_schema.sql
record MigrationFile(string Version, string Description, string Sql);

public class Migrator(DbConfig config)
{
    // ── 公開入口 ──────────────────────────────────────────
    public async Task RunAsync()
    {
        Console.WriteLine("☕ Coffee DB Migrator");
        Console.WriteLine($"   Host: {config.Host}:{config.Port}  DB: {config.Database}");
        Console.WriteLine(new string('─', 50));

        await using var conn = new MySqlConnection(config.ConnectionString);
        await conn.OpenAsync();

        await EnsureMigrationsTableAsync(conn);

        var pending = await GetPendingMigrationsAsync(conn);

        if (pending.Count == 0)
        {
            Console.WriteLine("✅ 已是最新版本，無需執行任何 migration。");
            return;
        }

        int applied = 0;
        foreach (var m in pending)
        {
            Console.Write($"🚀 套用 {m.Version} {m.Description} ... ");
            await ApplyMigrationAsync(conn, m);
            Console.WriteLine("OK");
            applied++;
        }

        Console.WriteLine(new string('─', 50));
        Console.WriteLine($"✅ 完成，共套用 {applied} 個 migration。");
    }

    // ── 建立 schema_migrations table（若不存在）────────────
    private static async Task EnsureMigrationsTableAsync(MySqlConnection conn)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version     VARCHAR(10)  NOT NULL,
                description VARCHAR(200) NOT NULL,
                applied_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (version)
            );
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    // ── 讀取已套用的版本 ──────────────────────────────────
    private static async Task<HashSet<string>> GetAppliedVersionsAsync(MySqlConnection conn)
    {
        var applied = new HashSet<string>();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT version FROM schema_migrations";
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            applied.Add(reader.GetString(0));
        return applied;
    }

    // ── 比對 embedded SQL 檔，回傳尚未套用的清單 ──────────
    private static async Task<List<MigrationFile>> GetPendingMigrationsAsync(MySqlConnection conn)
    {
        var applied  = await GetAppliedVersionsAsync(conn);
        var assembly = Assembly.GetExecutingAssembly();

        // 撈出所有 embedded .sql 資源
        var resources = assembly.GetManifestResourceNames()
            .Where(n => n.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
            .OrderBy(n => n)   // 依資源名稱排序 = 依檔名排序
            .ToList();

        var pending = new List<MigrationFile>();

        foreach (var resource in resources)
        {
            // 資源名稱範例：CoffeeMigrator.Migrations.V001__init_schema.sql
            var fileName = resource.Split('.')[^2] + ".sql";  // V001__init_schema.sql
            var match    = Regex.Match(fileName, @"^(V\d+)__(.+)\.sql$", RegexOptions.IgnoreCase);
            if (!match.Success)
            {
                Console.WriteLine($"⚠  跳過不符合命名格式的檔案：{fileName}");
                continue;
            }

            var version     = match.Groups[1].Value.ToUpper();  // V001
            var description = match.Groups[2].Value.Replace('_', ' ');

            if (applied.Contains(version)) 
            {
                Console.WriteLine($"✅ 已套用：{version} {description}");
                continue;
            }

            using var stream = assembly.GetManifestResourceStream(resource)!;
            using var reader = new StreamReader(stream);
            var sql = await reader.ReadToEndAsync();

            pending.Add(new MigrationFile(version, description, sql));
        }

        return pending;
    }

    // ── 套用單一 migration（transaction）────────────────────
    private static async Task ApplyMigrationAsync(MySqlConnection conn, MigrationFile m)
    {
        await using var transaction = await conn.BeginTransactionAsync();
        try
        {
            // 依分號切割，逐段執行（避免 multi-statement 問題）
            var statements = SplitStatements(m.Sql);
            foreach (var sql in statements)
            {
                await using var cmd = conn.CreateCommand();
                cmd.Transaction  = transaction;
                cmd.CommandText  = sql;
                await cmd.ExecuteNonQueryAsync();
            }

            // 記錄已套用
            await using var record = conn.CreateCommand();
            record.Transaction = transaction;
            record.CommandText = "INSERT INTO schema_migrations (version, description) VALUES (@v, @d)";
            record.Parameters.AddWithValue("@v", m.Version);
            record.Parameters.AddWithValue("@d", m.Description);
            await record.ExecuteNonQueryAsync();

            await transaction.CommitAsync();
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }

    // ── 切割 SQL 語句（依分號，忽略空白段）────────────────
    private static IEnumerable<string> SplitStatements(string sql) =>
        sql.Split(';')
           .Select(s => s.Trim())
           .Where(s => s.Length > 0);
}
