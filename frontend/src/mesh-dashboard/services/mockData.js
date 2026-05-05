export const MOCK_REPEATERS = [
  {
    id: '1',
    name: 'BE-ZOD-MOSKEE-DIS',
    pubkey_prefix: '14036f',
    last_heard: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: '2',
    name: 'BE-ZOD-TERRIL',
    pubkey_prefix: 'fc1c4b',
    last_heard: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(),
  },
  {
    id: '3',
    name: 'BE-HSS-DinX-EDG-JZH.H39',
    pubkey_prefix: '8b2c1a',
    last_heard: new Date().toISOString(),
  },
];

const MOCK_OBSERVERS = [
  'BE-KRN',
  'NL-RHOON RWS',
  'Schelle-2',
  'Heusden-Zolder',
];

const MOCK_NODES = [
  'BE-ZOD-MOSKEE-DIS',
  'BE-ZOD-TERRIL',
  'BE-HSS-DinX-EDG-JZH.H39',
];

export function generateMockDetection() {
  const node = MOCK_NODES[Math.floor(Math.random() * MOCK_NODES.length)];
  const observer = MOCK_OBSERVERS[Math.floor(Math.random() * MOCK_OBSERVERS.length)];
  const rssi = -95 + Math.floor(Math.random() * 30);
  const hops = Math.floor(Math.random() * 5) + 1;
  const path = Array.from({ length: hops }, (_, i) => `hop${i}`);

  return {
    node_name: node,
    observer,
    rssi,
    timestamp: new Date().toISOString(),
    path,
    h3_cell: `8b2c1a${Math.random().toString(16).slice(2, 8)}`,
  };
}

export function useMockDetectionSimulator(onDetection, interval = 8000) {
  setInterval(() => {
    onDetection(generateMockDetection());
  }, interval);
}
