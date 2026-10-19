import { useEffect, useState } from "react";
import { player, type PlayerSnapshot } from "./player";

export function usePlayerSnapshot(): PlayerSnapshot {
  const [snap, setSnap] = useState(player.snapshot);
  useEffect(() => player.subscribe(setSnap), []);
  return snap;
}
