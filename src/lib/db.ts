// ponytail: dotenv/config here (not just relying on Next's auto-loading) so
// standalone scripts (e.g. the Task 5 scraper run via `tsx script.ts`) get
// DATABASE_URL without remembering to load it themselves. No-op under Next,
// which injects env vars before this module loads.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 requires an explicit driver adapter — `new PrismaClient()` with no
// options throws at runtime. See https://pris.ly/d/driver-adapters
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
