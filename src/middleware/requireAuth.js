import jwt from "jsonwebtoken";

export default function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "NO_TOKEN" });

  try {
    const data = jwt.verify(token, process.env.JWT_SECRET || "secret");
    req.auth = { id: data.id };
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}