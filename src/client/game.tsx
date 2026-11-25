import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { STRINGS } from '../shared/strings';

export const App = () => (
  <main>
    <h1>{STRINGS.gameName}</h1>
    <p>{STRINGS.comingSoon}</p>
  </main>
);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
