import { Client } from "pg";
import { createClient } from "redis";
import { DbMessage } from "./types";
import { dbUrl, redisEngineDownstreamUrl } from "./config";
import * as cron from "node-cron";
import express from "express";
const app = express();
const port = process.env.PORT || 3004;

// Health check endpoint
app.get("/health", (_req, res) => {
  console.log("Health check - server is alive from the HTTP");
  res.status(200).json({ status: "healthy" });
});

// Cron job to keep the server alive
cron.schedule("*/12 * * * *", () => {
  console.log("Health check - server is alive");
});

app.listen(port, () => {
  console.log(`Health check server running on port ${port}`);
});

const pgClient = new Client({
  connectionString: dbUrl, // Railway's full connection URL
});

pgClient
  .connect()
  .then(() => console.log("🚀 Connected to Railway PostgreSQL!"))
  .catch((err) => console.error("❌ Connection error", err));

async function main() {
  const redisClient = createClient({
    url: redisEngineDownstreamUrl,
  });
  await redisClient.connect();
  console.log("Connected to Redis");

  while (true) {
    // Use a blocking pop to wait for a message
    const res = await redisClient.blPop("db_processor", 0);
    if (res && res.element) {
      const response = res.element;
      const data: DbMessage = JSON.parse(response);
      if (data.type === "TRADE_ADDED") {
        try {
          console.log("Adding trade data...");
          const { price, timestamp } = data.data;
          const formattedTimestamp = new Date(timestamp);

          const query = "INSERT INTO tata_prices (time, price) VALUES ($1, $2)";
          const values = [formattedTimestamp, price];

          await pgClient.query(query, values);
          console.log("Trade data added successfully");
        } catch (error) {
          console.error("Error in trade processing:", {
            error,
            data: data.data,
            timestamp: new Date(data.data.timestamp),
            price: data.data.price,
          });
          // You might want to add error handling logic here
          // For example, storing failed records or retrying
        }
      }
    }
  }
}

main();
