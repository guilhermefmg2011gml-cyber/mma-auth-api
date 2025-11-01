export default function requirePermission(perm) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    if (perms.includes("*") || perms.includes(perm)) return next();
    return res.status(403).json({ error: "FORBIDDEN" });
  };
}