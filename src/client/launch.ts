import { requestExpandedMode } from '@devvit/web/client';
import { STRINGS } from '../shared/strings';

const root = document.getElementById('root');
if (root) {
  const title = document.createElement('h1');
  title.textContent = STRINGS.gameName;
  const play = document.createElement('button');
  play.type = 'button';
  play.textContent = STRINGS.play;
  play.addEventListener('click', (event) => requestExpandedMode(event, 'game'));
  root.replaceChildren(title, play);
}
