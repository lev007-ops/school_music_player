import { navigate, usePath } from "./lib/router";
import { adminSession, deviceSession } from "./lib/storage";
import { Home } from "./pages/Home";
import { AdminPage } from "./pages/AdminPage";
import { PlayerPage } from "./pages/PlayerPage";
import { useEffect } from "react";

export default function App() {
  const path = usePath();
  const admin = path === "/admin" ? adminSession.get() : null;
  const device = path === "/player" ? deviceSession.get() : null;
  const redirect = (path === "/admin" && !admin) || (path === "/player" && !device);

  useEffect(() => {
    if (redirect) navigate("/");
  }, [redirect]);

  if (admin) return <AdminPage key={admin.token} token={admin.token} />;
  if (device) return <PlayerPage key={device.token} token={device.token} />;
  return <Home />;
}
