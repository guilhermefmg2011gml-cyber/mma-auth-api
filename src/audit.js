import { db } from "./db.js";

export function audit({ byUserId, action, entity, entityId, diff, ip, ua }) {
  db.prepare(
    "INSERT INTO audit_logs (user_id, action, entity, entity_id, diff_json, ip, ua) VALUES (?,?,?,?,?,?,?)"
  ).run(
    byUserId || null,
    action,
    entity || null,
    entityId || null,
    JSON.stringify(diff || {}),
    ip || "",
    ua || ""
  );
}