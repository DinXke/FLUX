# MeshAlert — Mesh Network Detection Dashboard

Standalone real-time detection dashboard for mesh network monitoring. Separate from FLUX (SCH-756 Phase 2).

## Architecture

- **Frontend**: React 18 + Vite + SSE live streaming
- **Backend**: FastAPI + SQLite (SCH-2326)
- **Features**: Live feed + historical timeline with filters

## Structure

```
meshalert/
├── frontend/          # React Vite app
│   ├── src/
│   │   ├── components/
│   │   │   ├── LiveFeed.jsx
│   │   │   └── Timeline.jsx
│   │   ├── styles/
│   │   └── App.jsx
│   ├── vite.config.js
│   ├── package.json
│   └── Dockerfile
├── backend/           # FastAPI server
│   ├── app.py         # Main application
│   ├── requirements.txt
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Development

### Frontend

```bash
cd frontend
npm install
npm run dev  # http://localhost:5173
```

### Backend

```bash
cd backend
pip install -r requirements.txt
python app.py  # http://localhost:5001
```

## Docker

```bash
docker-compose up -d
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:5001

## API Endpoints

### Live Stream
- `GET /api/detections/stream` — SSE real-time detections

### History
- `GET /api/detections/history` — Paginated historical data
  - Query params: `limit`, `offset`, `repeater`, `timeRange`
- `GET /api/detections/repeaters` — List of unique repeaters
- `POST /api/detections/ingest` — Ingest new detection (internal)

### Health
- `GET /api/health` — Service status

## Related Issues

- [SCH-2326](/SCH/issues/SCH-2326) — Backend persistence layer (SQLite)
- [SCH-2327](/SCH/issues/SCH-2327) — Frontend dashboard
- [SCH-756](/SCH/issues/SCH-756) — FLUX master epic

## Notes

- Persistent storage (SQLite) to be implemented in SCH-2326
- Currently uses in-memory buffer for testing
- Frontend expects `/api/detections/history` to support historical filtering
