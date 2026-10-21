import { Experiment } from './pages/Experiment';
import { Login } from './pages/Login';
import { useSessionStore } from './stores/session';

export function App() {
  const token = useSessionStore((state) => state.token);
  return token ? <Experiment /> : <Login />;
}
