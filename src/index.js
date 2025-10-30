/* eslint-env node */
/* global process */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import './db.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

const app = express();
app.use(express.json());

app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) || '*',
  credentials: false,
}));

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Auth API rodando na porta ${port}`));