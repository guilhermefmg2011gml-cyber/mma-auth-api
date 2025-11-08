/* eslint-env node */
import bcrypt from "bcryptjs";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import type { StringValue } from "ms";

const JWT_SECRET: Secret = process.env.JWT_SECRET ?? "secret";
const TOKEN_EXPIRES_IN: StringValue | number = (process.env.JWT_EXPIRES ?? "2h") as StringValue;
const SIGN_OPTIONS: SignOptions = {
  expiresIn: TOKEN_EXPIRES_IN,
};

export const hashPassword = (plain: string): Promise<string> =>
  new Promise((resolve, reject) => {
    bcrypt.hash(plain, 10, (err, hash) => {
      if (err) return reject(err);
      resolve(hash);
    });
  });

export const comparePassword = (plain: string, hash: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    bcrypt.compare(plain, hash, (err, same) => {
      if (err) return reject(err);
      resolve(same);
    });
  });

export const signToken = <T extends object>(payload: T): string =>
  jwt.sign(payload, JWT_SECRET, SIGN_OPTIONS);