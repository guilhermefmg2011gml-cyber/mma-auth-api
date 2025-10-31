import Database from "better-sqlite3";
import "dotenv/config";

export const db = new Database(process.env.DATABASE_PATH || "./mma_auth.db", { fileMustExist: false });