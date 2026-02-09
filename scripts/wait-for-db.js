/**
 * wait-for-db.js
 * Checks TCP connectivity to the database.
 * Used by docker-entrypoint.sh before running Prisma migrations.
 * Exit 0 = DB reachable, Exit 1 = DB not reachable.
 */
const net = require("net");

const host = process.env.DB_HOST || "db";
const port = parseInt(process.env.DB_PORT || "5432", 10);

const socket = new net.Socket();
socket.setTimeout(2000);

socket.connect(port, host, () => {
  socket.destroy();
  process.exit(0);
});

socket.on("error", () => {
  socket.destroy();
  process.exit(1);
});

socket.on("timeout", () => {
  socket.destroy();
  process.exit(1);
});
