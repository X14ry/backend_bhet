// Creates the database (if needed) and all tables.
//   npm run db:migrate           -> create database + tables (fails if tables already exist)
//   node scripts/migrate.js --drop -> drop the database first, then rebuild
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const config = require("../src/config");

async function main() {
  const drop = process.argv.includes("--drop");
  const db = config.db.database; // validated: letters, numbers, underscores only

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });

  try {
    if (drop) {
      console.log(`Dropping database ${db} ...`);
      await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
    }
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await conn.query(`USE \`${db}\``);

    const [existing] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = 'users'`,
      [db],
    );
    if (existing[0].n > 0) {
      console.log(
        'Tables already exist - nothing to do. (Use "npm run db:reset" to rebuild.)',
      );
    } else {
      const sql = fs.readFileSync(
        path.join(__dirname, "../database/schema.sql"),
        "utf8",
      );
      await conn.query(sql);
      console.log("Schema created.");
    }
    const ref = fs.readFileSync(
      path.join(__dirname, "../database/seed_reference.sql"),
      "utf8",
    );
    await conn.query(ref);
    console.log("Reference data (interests, public venues) loaded.");
  } finally {
    await conn.end();
  }
}

main()
  .then(() => console.log("Migration complete."))
  .catch((err) => {
    console.error("Migration failed:", err.message);
    process.exit(1);
  });
