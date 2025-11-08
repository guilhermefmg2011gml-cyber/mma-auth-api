import { db } from "./db.js";
export function audit({ byUserId, byUserEmail, action, entity, entityId, diff, ip, ua }) {
    try {
        const stmt = db.prepare(`INSERT INTO audit_logs (
        user_id,
        user_email,
        action,
        entity,
        entity_id,
        diff_json,
        ip,
        ua
      ) VALUES (@userId, @userEmail, @action, @entity, @entityId, @diff, @ip, @ua)`);
        stmt.run({
            userId: byUserId ?? null,
            userEmail: byUserEmail ?? null,
            action,
            entity: entity ?? null,
            entityId: entityId ?? null,
            diff: JSON.stringify(diff ?? {}),
            ip: ip ?? "",
            ua: ua ?? "",
        });
    }
    catch (error) {
        console.error("audit insert error:", error.message);
    }
}
