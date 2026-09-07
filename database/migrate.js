const { spawnSync } = require('node:child_process');
const path = require('node:path');

const result = spawnSync('dotnet', ['run', '--project', path.join(__dirname, 'CoffeeMigrator')], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
