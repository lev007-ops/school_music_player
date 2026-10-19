import { useEffect, useState } from "react";

export function navigate(path: string) {
  if (location.pathname !== path) history.pushState(null, "", path);
  window.dispatchEvent(new Event("app:navigate"));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener("app:navigate", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("app:navigate", update);
    };
  }, []);
  return path;
}
