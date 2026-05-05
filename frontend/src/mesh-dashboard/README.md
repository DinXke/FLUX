# 🗺️ Mesh Detectie Dashboard

React 18 + Vite real-time mesh detection dashboard met SSE (Server-Sent Events) live feed.

## Features

### ✅ Verplicht (Implemented)
- **Live detectie feed** — Max 10 meest recente detecties in real-time
- **Detectie details:**
  - Node naam
  - RSSI (dBm) met kleurcodering
  - Timestamp (lokale tijd)
  - Observer
  - Pad (hops)
  - H3 cel locatie
- **Repeater manager** — Add/remove repeaters, status (online/offline)
- **Browser notificaties** — Web Notifications API

### 🎯 Optioneel (Future)
- PWA manifest + service worker
- Leaflet kaartje met H3-cel visualisatie
- Data persistentie/localStorage
- Detectie filtering/search

## Architecture

```
mesh-dashboard/
├── MeshDashboard.jsx         # Main component (state, SSE handler)
├── components/               # UI components
│   ├── DetectionFeed.jsx     # Live detection list
│   ├── RepeaterManager.jsx   # Add/remove repeaters
│   └── NotificationSetup.jsx # Notification toggle
├── hooks/
│   └── useSSE.js             # EventSource hook
├── services/
│   └── mockData.js           # Mock detection generator
└── styles/
    ├── MeshDashboard.css
    ├── DetectionFeed.css
    ├── RepeaterManager.css
    └── NotificationSetup.css
```

## Backend API Contract

Verwacht volgende endpoints op `http://localhost:7842/api`:

```javascript
// Haal laatste 10 detecties op
GET /api/detections
→ [{ node_name, rssi, timestamp, observer, path, h3_cell }, ...]

// Haal repeaters op
GET /api/repeaters
→ [{ id, name, pubkey_prefix, last_heard }, ...]

// Voeg repeater toe
POST /api/repeaters
{ name, pubkey_prefix }

// Verwijder repeater
DELETE /api/repeaters/{id}

// SSE live stream
GET /api/stream
→ event: "detection"
→ data: { node_name, rssi, timestamp, observer, path, h3_cell }
```

## Development

```bash
cd frontend

# Start Vite dev server (hot reload)
npm run dev

# Build voor production
npm run build

# Preview production build
npm run preview
```

## Mock Data

Bij backend disconnect, genereert `mockData.js` dummy detecties voor testing:

```javascript
import { generateMockDetection, useMockDetectionSimulator } from './services/mockData';

useMockDetectionSimulator(onDetection, 8000); // Elke 8s mock detectie
```

## Configuration

Environment variables (`frontend/.env`):

```
REACT_APP_API_URL=http://localhost:7842
```

## Styling

Gebruikt custom CSS met:
- Gradient backgrounds (slate/cyan/pink)
- Dark theme (0f172a, 1e293b, 64748b)
- Smooth transitions & animations
- Responsive grid layout
- Mobile-first design

## Integration Checklist

- [ ] Backend [SCH-2326](/SCH/issues/SCH-2326) API endpoints live
- [ ] SSE stream testen
- [ ] Repeater CRUD testen
- [ ] Notificaties testen op mobiel
- [ ] Docker Compose service configureren
- [ ] Port mapping 7842:7842

## Status

🔄 **In Progress**
- Blocking on: [SCH-2326](/SCH/issues/SCH-2326) (backend service)
- Ready for SSE integration when backend API is live
- Mock data fully functional for dev/preview
