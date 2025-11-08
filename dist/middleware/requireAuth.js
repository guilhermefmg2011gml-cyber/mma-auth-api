import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET ?? "secret";
export default function requireAuth(req, res, next) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token)
        return res.status(401).json({ error: "NO_TOKEN" });
    try {
        const data = jwt.verify(token, JWT_SECRET);
        if (typeof data !== "object" || data === null || typeof data.id !== "number") {
            return res.status(401).json({ error: "INVALID_TOKEN" });
        }
        req.auth = { id: data.id };
        next();
    }
    catch {
        return res.status(401).json({ error: "INVALID_TOKEN" });
    }
}
