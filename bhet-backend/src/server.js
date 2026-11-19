const app = require("./app");
const config = require("./config");
const { pool } = require("./db");

async function start() {
  try {
    await pool.query("SELECT 1");
    console.log(
      `MySQL connected (${config.db.host}:${config.db.port}/${config.db.database})`,
    );
  } catch (err) {
    console.error("Could not connect to MySQL:", err.message);
    console.error(
      'Check your .env settings and run "npm run db:migrate" first.',
    );
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`BHET API listening on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
