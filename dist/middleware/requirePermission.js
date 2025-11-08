export default function requirePermission(perm) {
    return (req, res, next) => {
        try {
            const role = req.user?.role;
            const perms = req.user?.permissions || [];
            if (role === "admin" || perms.includes("*") || perms.includes(perm)) {
                return next();
            }
            return res.status(403).json({ message: "Permissão insuficiente" });
        }
        catch {
            return res.status(500).json({ message: "Erro interno" });
        }
    };
}
