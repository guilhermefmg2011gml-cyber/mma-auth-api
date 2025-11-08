/* eslint-env node */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET ?? "secret";
const TOKEN_EXPIRES_IN = (process.env.JWT_EXPIRES ?? "2h");
const SIGN_OPTIONS = {
    expiresIn: TOKEN_EXPIRES_IN,
};
export const hashPassword = (plain) => new Promise((resolve, reject) => {
    bcrypt.hash(plain, 10, (err, hash) => {
        if (err)
            return reject(err);
        resolve(hash);
    });
});
export const comparePassword = (plain, hash) => new Promise((resolve, reject) => {
    bcrypt.compare(plain, hash, (err, same) => {
        if (err)
            return reject(err);
        resolve(same);
    });
});
export const signToken = (payload) => jwt.sign(payload, JWT_SECRET, SIGN_OPTIONS);
