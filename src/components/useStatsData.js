import { useEffect, useState } from "react";

// Loads `action` for the Stats date range and test-chat switch.
export const useStatsData = (api, action, request) => {
  const [result, setResult] = useState({ key: null, data: null });
  const key = JSON.stringify(request);
  useEffect(() => {
    let cancelled = false;
    const { refreshKey: refreshed, ...body } = JSON.parse(key);
    api({ action, ...body, fresh: refreshed > 0 }).then((data) => {
      if (!cancelled) setResult({ key, data });
    });
    return () => {
      cancelled = true;
    };
  }, [api, action, key]);
  return result.key === key ? { loading: false, data: result.data } : { loading: true, data: null };
};
