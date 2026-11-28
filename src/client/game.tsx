import { StrictMode, useState, type KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { moveBudget } from '../shared/budget';
import { addDays, mondayOf, puzzleDayFromMs, weekday, type PuzzleDay } from '../shared/date';
import { applyMove, initAttempt, visitedSet, type AttemptState } from '../shared/engine';
import { evolve, type EvolveReport } from '../shared/erosion';
import { generateDetailed } from '../shared/generator';
import { DOWN, LEFT, MOVES, NORMAL, RIGHT, UP, WORN, hasWall, type Move } from '../shared/maze';
import { solve } from '../shared/solver';
import { STRINGS } from '../shared/strings';

const keyMove: Readonly<Record<string, Move>> = {
  ArrowUp: UP,
  ArrowRight: RIGHT,
  ArrowDown: DOWN,
  ArrowLeft: LEFT,
};

type Practice = { readonly day: PuzzleDay; readonly initial: AttemptState };

function preparePractice(): Practice | null {
  const day = mondayOf(puzzleDayFromMs(Date.now()));
  const generated = generateDetailed(day, 0);
  if (!generated.ok) return null;
  const { maze, par } = generated.value;
  return { day, initial: initAttempt(maze, moveBudget(par, weekday(day))) };
}

function Board({ attempt }: { readonly attempt: AttemptState }) {
  const { maze, cell } = attempt;
  const row = (index: number) => Math.floor(index / maze.side);
  const col = (index: number) => index % maze.side;
  return (
    <svg viewBox={`0 0 ${maze.side} ${maze.side}`} role="img" aria-label={STRINGS.practice.board}>
      {Array.from(maze.states, (state, index) => {
        const x = col(index);
        const y = row(index);
        return (
          <g key={index}>
            {state !== NORMAL && <rect x={x} y={y} width="1" height="1" className={state === WORN ? 'worn' : 'hedge'} />}
            {hasWall(maze, index, UP) && <path d={`M${x} ${y}h1`} />}
            {hasWall(maze, index, LEFT) && <path d={`M${x} ${y}v1`} />}
          </g>
        );
      })}
      <path d={`M${maze.side} 0v${maze.side}H0`} />
      <circle cx={col(maze.start) + 0.5} cy={row(maze.start) + 0.5} r="0.35" className="start" />
      <rect x={col(maze.exit) + 0.22} y={row(maze.exit) + 0.22} width="0.56" height="0.56" rx="0.1" className="exit" />
      <circle cx={col(cell) + 0.5} cy={row(cell) + 0.5} r="0.25" className="player" />
    </svg>
  );
}

export function App() {
  const [practice] = useState(preparePractice);
  const [attempt, setAttempt] = useState(practice?.initial ?? null);
  const [report, setReport] = useState<EvolveReport | null>(null);
  const copy = STRINGS.practice;

  function move(direction: Move) {
    setAttempt((previous) => previous && applyMove(previous, direction).state);
  }

  function showErosion() {
    if (!practice || attempt?.outcome !== 'solved' || report) return;
    const day = addDays(practice.day, 1);
    const snapshot = Array<number>(attempt.maze.states.length).fill(0);
    for (const cell of visitedSet(attempt.route)) snapshot[cell] = 1;
    const next = evolve(attempt.maze, snapshot, day, 0);
    if (!next.ok) return;
    const { maze, report: changes } = next.value;
    const route = solve(maze);
    if (route.kind !== 'solved') return;
    setAttempt(initAttempt(maze, moveBudget(route.par, weekday(day))));
    setReport(changes);
  }

  function reset() {
    setAttempt(practice?.initial ?? null);
    setReport(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!Object.hasOwn(keyMove, event.key)) return;
    const direction = keyMove[event.key];
    if (direction === undefined || attempt?.outcome !== null) return;
    event.preventDefault();
    move(direction);
  }

  return (
    <main aria-label={copy.title} tabIndex={0} onKeyDown={onKeyDown}>
      <h1>{STRINGS.gameName}</h1>
      <h2>{copy.title}</h2>
      <p>{copy.note}</p>
      {attempt ? (
        <>
          <p>{report ? copy.erosion(report.worn.length, report.wallsRemoved.length, report.newlyOvergrown.length) : copy.directions}</p>
          <Board attempt={attempt} />
          <p role="status">
            {copy.cost(attempt.cost, attempt.budget)}
            {attempt.outcome === 'solved' && ` · ${copy.solved}`}
            {attempt.outcome === 'out-of-moves' && ` · ${copy.exhausted}`}
          </p>
          <div className="controls">
            {MOVES.map((direction) => (
              <button key={direction} type="button" disabled={attempt.outcome !== null} onClick={() => move(direction)}>
                {copy.moves[direction]}
              </button>
            ))}
          </div>
          <div className="controls">
            {attempt.outcome === 'solved' && !report && <button type="button" onClick={showErosion}>{copy.nextBoard}</button>}
            <button type="button" onClick={reset}>{copy.reset}</button>
          </div>
        </>
      ) : <p>{STRINGS.comingSoon}</p>}
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
