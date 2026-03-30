# Catalyst OS — Backend

Self-feeding marketing flywheel. Upload one master asset, get platform-native variants, monitor audience response, close the content loop.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and configure
cp .env.example .env

# 3. Run migrations
npm run db:migrate

# 4. Seed demo data
npm run db:seed

# 5. Start development server
npm run dev
```

Server starts at `http://localhost:4000`. Demo login: `jordan@catalystos.io` / `catalyst2026`

## Architecture

```
src/
├── server.js              # Express app, middleware stack, graceful shutdown
├── config/index.js        # Env validation, typed config object
├── models/
│   ├── database.js        # SQLite init, migrations, WAL mode
│   ├── BaseModel.js       # Generic CRUD (findById, create, update, delete)
│   └── index.js           # Domain models (User, Campaign, Variant, Signal, Brief, Pattern)
├── middleware/
│   ├── auth.js            # JWT verification, token generation
│   └── handlers.js        # Zod validation, error handler, 404, slow request logging
├── routes/index.js        # All API endpoints
├── services/
│   ├── eventBus.js        # Pub/sub for decoupled service communication
│   ├── forgeService.js    # Content analysis, Voice DNA, variant generation
│   ├── radarService.js    # Sentiment analysis, signal detection, crisis mode
│   ├── cortexService.js   # Pattern learning, content mix, weekly digest
│   └── platformService.js # Unified connector for TikTok/IG/LinkedIn/X/YouTube
├── jobs/scheduler.js      # Cron: engagement polling, rate reset, cortex analysis
└── utils/
    ├── errors.js          # Typed error classes (NotFound, Validation, Auth, RateLimit)
    ├── logger.js          # Winston structured logging
    └── validators.js      # Zod schemas for every API input
```

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/register` | Register new account |
| POST | `/api/v1/auth/login` | Login, get JWT |
| GET | `/api/v1/auth/me` | Get current user |

### Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/dashboard` | Aggregated stats |

### Voice DNA
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/voice-dna` | Get voice config |
| PUT | `/api/v1/voice-dna` | Update voice config |

### Campaigns (Forge + Launchpad)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/campaigns` | List all campaigns |
| GET | `/api/v1/campaigns/:id` | Campaign detail + variants + engagement |
| POST | `/api/v1/campaigns` | Create campaign + auto-generate variants |
| PATCH | `/api/v1/campaigns/:id` | Update campaign |
| DELETE | `/api/v1/campaigns/:id` | Delete campaign |
| GET | `/api/v1/campaigns/:id/variants` | List variants |
| PATCH | `/api/v1/variants/:id` | Edit variant caption/hook |
| POST | `/api/v1/variants/:id/approve` | Approve single variant |
| POST | `/api/v1/campaigns/:id/approve-all` | Approve all variants |
| POST | `/api/v1/campaigns/:id/launch` | Publish to platforms |

### Radar (Signals + Briefs)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/signals` | Active signals |
| PATCH | `/api/v1/signals/:id` | Dismiss signal |
| GET | `/api/v1/briefs` | Content brief queue |
| POST | `/api/v1/briefs` | Create manual brief |
| PATCH | `/api/v1/briefs/:id` | Edit brief |
| POST | `/api/v1/briefs/:id/approve` | Approve brief |
| POST | `/api/v1/crisis/trigger` | Enter crisis mode |
| POST | `/api/v1/crisis/resolve` | Exit crisis mode |

### Cortex (Intelligence)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/cortex` | Full intelligence data |
| GET | `/api/v1/cortex/patterns` | Learned patterns |
| POST | `/api/v1/cortex/analyze` | Trigger manual analysis |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health/platforms` | API health per platform |
| GET | `/api/v1/settings` | User settings |
| PUT | `/api/v1/settings` | Update settings |
| GET | `/api/v1/audit` | Audit log |
| GET | `/healthz` | Liveness probe |
| GET | `/readyz` | Readiness probe |

## Security

- JWT auth on all protected routes
- Bcrypt password hashing (12 rounds)
- Helmet security headers
- CORS whitelist in production
- Rate limiting (100 req/15min general, 20 req/15min auth)
- Zod input validation on every endpoint
- SQL injection prevention via prepared statements
- Audit log for all mutations

## Testing

```bash
npm test                # Run all tests
npm run test:unit       # Unit tests only
```

## Deployment

```bash
# Docker
docker build -t catalyst-os .
docker run -p 4000:4000 -v $(pwd)/data:/app/data catalyst-os

# Docker Compose
docker-compose up -d
```

## Extending Platform Connectors

Each platform connector in `src/services/platformService.js` implements:

```javascript
class MyPlatformConnector extends BasePlatformConnector {
  async _publish(variant)              { /* POST to platform API */ }
  async _fetchEngagement(externalId)   { /* GET metrics from API */ }
}
```

Rate limiting, error handling, and audit logging are handled by the base class automatically.

## Background Jobs

| Schedule | Job | Description |
|----------|-----|-------------|
| Every 15m | Engagement poll | Fetch metrics from all platforms |
| Midnight | Rate reset | Reset daily API call counters |
| Monday 6am | Cortex analysis | Learn patterns, generate digest |
| Every hour | Health check | Monitor rate limit thresholds |

## License

Proprietary — Catalyst OS
