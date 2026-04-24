# Exchange DB — Railway

A high-performance database processor microservice for a cryptocurrency exchange. Consumes trade events from a Redis queue, persists them to a TimescaleDB-backed PostgreSQL database, and maintains pre-computed OHLC candlestick views for fast charting queries.

---

## Overview

This service sits between the exchange matching engine and any downstream analytics or API consumers. It handles one core responsibility: reliably moving trade data from an event queue into a queryable time-series store.

```
Exchange Engine
    │
    │  TRADE_ADDED events
    ▼
Redis Queue (db_processor)
    │
    │  consumed continuously
    ▼
PostgreSQL / TimescaleDB
    │  tata_prices hypertable
    │
    │  refreshed every 5 min
    ▼
Materialized Views
    klines_1m  ·  klines_1h  ·  klines_1w
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.7 |
| Runtime | Node.js |
| Web Framework | Express.js |
| Database | PostgreSQL (Railway) + TimescaleDB extension |
| Message Queue | Redis |
| Task Scheduling | node-cron |
| Deployment | Railway.app |

---

## Project Structure

```
src/
├── index.ts        # Express server + Redis consumer loop
├── config.ts       # Environment variable loader
├── types.ts        # TypeScript interfaces for queue messages
├── cron.ts         # Materialized view refresh scheduler (every 5 min)
├── seed-db.ts      # One-time schema setup and hypertable creation
└── some.ts         # Database diagnostic/connectivity testing utility
```

---

## Database Schema

### `tata_prices` (TimescaleDB Hypertable)

```sql
CREATE TABLE tata_prices (
    time          TIMESTAMPTZ    NOT NULL,
    price         DOUBLE PRECISION,
    volume        DOUBLE PRECISION,
    currency_code VARCHAR(10)
);
```

Partitioned automatically by time using TimescaleDB's `create_hypertable`.

### Materialized Views (OHLC Candlesticks)

Three views are created and refreshed on a 5-minute cron cycle:

| View | Bucket | Columns |
|---|---|---|
| `klines_1m` | 1 minute | bucket, open, high, low, close, volume, currency_code |
| `klines_1h` | 1 hour | bucket, open, high, low, close, volume, currency_code |
| `klines_1w` | 1 week | bucket, open, high, low, close, volume, currency_code |

`open` and `close` are derived using TimescaleDB's `first()` / `last()` aggregate functions.

---

## Message Format

The service reads from the `db_processor` Redis list. Supported message types (defined in `types.ts`):

### `TRADE_ADDED`
```json
{
    "type": "TRADE_ADDED",
    "data": {
        "id": "string",
        "isBuyerMaker": true,
        "price": "string",
        "quantity": "string",
        "quoteQuantity": "string",
        "timestamp": 1234567890,
        "market": "TATA_INR"
    }
}
```

### `ORDER_UPDATE` *(type defined, processing not yet implemented)*
```json
{
    "type": "ORDER_UPDATE",
    "data": {
        "orderId": "string",
        "executedQty": 0,
        "market": "string",
        "price": "string",
        "quantity": "string",
        "side": "buy"
    }
}
```

---

## Environment Variables

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (TimescaleDB-enabled) |
| `REDIS_IO` | Redis connection URL for the `db_processor` queue |
| `REDIS_ENGINE_DOWNSTREAM_URL` | Secondary Redis used for engine-to-DB pub/sub |
| `PORT` | HTTP server port (default: `3004`) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A PostgreSQL instance with the TimescaleDB extension enabled
- Two Redis instances (one for the main queue, one for engine downstream)

### Install

```bash
npm install
```

### Initialize the Database

Run once to create the `tata_prices` hypertable and materialized views:

```bash
npm run seed:db
```

> This drops and recreates the table — do not run on a live database with existing data.

### Run

**Production** — seeds DB, then starts server and view refresher concurrently:
```bash
npm start
```

**Development** — builds, starts server, then runs view refresher:
```bash
npm run dev
```

**Standalone view refresh** (for debugging):
```bash
npm run refresh:views
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{"status": "healthy"}` — used by Railway health checks |

---

## Deployment

Configured for [Railway.app](https://railway.app) via `railway.json`:

- Builder: Nixpacks
- Restart policy: `ON_FAILURE` (max 10 retries)
- Region: `us-west2`
- Sleep disabled to keep the consumer loop running at all times

---

## Roadmap

- [ ] Process `ORDER_UPDATE` events — persist order state transitions as orders leave the order book
- [ ] `ticker` table — store the current best price per market for fast lookup
- [ ] Recent trades table — store a rolling window of the latest executed trades per market

---

## Architecture Notes

**Why TimescaleDB?** Trade data is append-only and queried almost exclusively by time range. TimescaleDB's hypertable partitioning keeps individual chunks small, making range scans fast without manual table management.

**Why materialized views instead of real-time aggregation?** Candlestick queries that scan millions of rows on every chart request would be expensive. Pre-computing OHLC at 3 granularities and refreshing every 5 minutes gives a good freshness/cost tradeoff for charting use cases.

**Why two Redis instances?** The exchange engine publishes to one Redis stream; a second instance is used for internal engine-to-DB downstream coordination, isolating traffic between the two subsystems.
