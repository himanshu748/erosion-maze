import { context, requestExpandedMode } from '@devvit/web/client';
import { isDailyPost } from '../shared/daily-run';
import { puzzleDayFromMs } from '../shared/date';
import { LEFT, UP, WORN, OVERGROWN, adjacent, hasWall } from '../shared/maze';
import { parsePostData, type ParsedPostData } from '../shared/postdata';
import { STRINGS } from '../shared/strings';

function shape(name: string, attrs: Record<string, string | number>): SVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

function preview({ maze, heat, finalHeat, route }: ParsedPostData): SVGElement {
  const { side } = maze;
  const activity = finalHeat ?? heat;
  const previewLabel = activity.levels.some((level) => level > 0)
    ? finalHeat ? STRINGS.daily.finalTrails : STRINGS.daily.priorTrails
    : STRINGS.practice.board;
  const board = shape('svg', { viewBox: `0 0 ${side} ${side}`, role: 'img',
    'aria-label': previewLabel, class: 'preview' });
  const row = (cell: number) => Math.floor(cell / side);
  const col = (cell: number) => cell % side;
  const walls = [`M${side} 0v${side}H0`];
  maze.states.forEach((state, cell) => {
    const x = col(cell);
    const y = row(cell);
    const level = activity.levels[cell] ?? 0;
    if (state === OVERGROWN) board.append(shape('rect', { x, y, width: 1, height: 1, class: 'hedge' }));
    if (state === WORN) board.append(shape('rect', { x, y, width: 1, height: 1, class: 'worn' }));
    if (level > 0) board.append(shape('rect', { x, y, width: 1, height: 1,
      class: 'heat', opacity: 0.15 + 0.12 * level }));
    if (hasWall(maze, cell, UP)) walls.push(`M${x} ${y}h1`);
    if (hasWall(maze, cell, LEFT)) walls.push(`M${x} ${y}v1`);
  });
  board.append(shape('path', { d: walls.join(' '), class: 'walls' }));
  if (route && !finalHeat) {
    let cell = maze.start;
    const points = [`${col(cell) + 0.5},${row(cell) + 0.5}`];
    for (const move of route) {
      const next = adjacent(side, cell, move);
      if (next === null) break;
      cell = next;
      points.push(`${col(cell) + 0.5},${row(cell) + 0.5}`);
    }
    board.append(shape('polyline', { points: points.join(' '), class: 'route' }));
  }
  board.append(shape('circle', { cx: col(maze.start) + 0.5, cy: row(maze.start) + 0.5,
    r: 0.28, class: 'start' }));
  board.append(shape('rect', { x: col(maze.exit) + 0.25, y: row(maze.exit) + 0.25,
    width: 0.5, height: 0.5, class: 'exit' }));
  return board;
}

const root = document.getElementById('root');
if (root) {
  const title = document.createElement('h1');
  const postData = context?.postData;
  const daily = parsePostData(postData);
  const practice = !isDailyPost(postData);
  if (daily.ok) root.classList.add('daily');
  title.textContent = daily.ok
    ? `${STRINGS.gameName} · ${STRINGS.daily.number(daily.value.data.n)}`
    : STRINGS.gameName;
  const description = document.createElement('p');
  description.textContent = daily.ok
    ? daily.value.data.status === 'closed' ||
      (daily.value.data.status === 'live' && daily.value.data.day < puzzleDayFromMs(Date.now()))
      ? STRINGS.daily.closed :
      daily.value.data.status === 'skipped' ? STRINGS.daily.skipped : STRINGS.practice.directions
    : practice ? STRINGS.practice.note : STRINGS.daily.unavailable;
  const play = document.createElement('button');
  play.type = 'button';
  play.textContent = STRINGS.play;
  play.addEventListener('click', (event) => requestExpandedMode(event, 'game'));
  root.replaceChildren(title, description);
  if (daily.ok) root.append(preview(daily.value));
  if (practice || daily.ok) root.append(play);
}
