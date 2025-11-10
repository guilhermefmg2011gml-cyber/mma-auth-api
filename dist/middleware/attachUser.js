import { db } from "../db.js";
const PERMS = {
    admin: [
        "*",
        "users:read",
        "users:create",
        "users:update",
        "users:delete",
        "roles:assign",
        "logs:read",
        "audit:read",
    ],
    gestor: [
        "users:read",
        "users:create",
        "users:update",
        "logs:read",
        "audit:read",
        "cases:write",
        "cases:sync",
    ],
    colab: [],
};
export default function attachUser(req, res, next) {
    try {
        if (!req.auth?.id) {
            return res.status(401).json({ error: "USER_NOT_FOUND" });
        }
        const u = db.prepare("SELECT id, email, role FROM users WHERE id=?").get(req.auth.id);
        if (!u)
            return res.status(401).json({ error: "USER_NOT_FOUND" });
        req.user = { ...u, permissions: PERMS[u.role] || [] };
        return next();
    }
    catch (error) {
        if (error instanceof Error) {
            console.error("attachUser error:", error.message);
        }
        else {
            console.error("attachUser error:", error);
        }
        return res.status(500).json({ error: "USER_LOOKUP_FAILED" });
    }
}
