require('dotenv').config();

export const redisUrl = process.env.REDIS_IO;
export const redisEngineDownstreamUrl = process.env.REDIS_ENGINE_DOWNSTREAM_URL;
export const dbUrl = process.env.DATABASE_URL;