import { useEffect, useState } from 'react';

export default function useSSE(streamUrl, onData) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!streamUrl) return;

    let eventSource;
    let reconnectTimeout;

    const connect = () => {
      try {
        eventSource = new EventSource(streamUrl);

        eventSource.addEventListener('detection', (event) => {
          try {
            const detection = JSON.parse(event.data);
            onData(detection);
          } catch (err) {
            console.error('Error parsing detection:', err);
          }
        });

        eventSource.onopen = () => {
          setIsConnected(true);
          setError(null);
        };

        eventSource.onerror = () => {
          setIsConnected(false);
          setError('Verbinding verbroken, opnieuw verbinden...');
          eventSource.close();
          reconnectTimeout = setTimeout(connect, 5000);
        };
      } catch (err) {
        setError(`Verbindingsfout: ${err.message}`);
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [streamUrl, onData]);

  return { isConnected, error };
}
