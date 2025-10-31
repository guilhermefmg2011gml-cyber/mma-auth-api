import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "defaultsecret";

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token ausente" });

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido/expirado" });
  }
}

export function requireAuth(req, res, next) {
  return authenticate(req, res, next);
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Acesso negado" });
  next();
}

export default function requireAuthWithRole(requiredRole) {
  if (!requiredRole) return authenticate;

  return (req, res, next) => {
    authenticate(req, res, () => {
      if (req.user?.role !== requiredRole) {
        return res.status(403).json({ error: "Acesso negado" });
      }
      next();
    });
  };
}