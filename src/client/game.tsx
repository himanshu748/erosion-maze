import { StrictMode, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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

type Practice = { readonly day: PuzzleDay; readonly initial: AttemptState; readonly par: number };
type RolloverPreview = { readonly changes: EvolveReport; readonly par: number };

function preparePractice(): Practice | null {
  const day = mondayOf(puzzleDayFromMs(Date.now()));
  const generated = generateDetailed(day, 0);
  if (!generated.ok) return null;
  const { maze, par } = generated.value;
  return { day, initial: initAttempt(maze, moveBudget(par, weekday(day))), par };
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
  const [preview, setPreview] = useState<RolloverPreview | null>(null);
  const playArea = useRef<HTMLElement>(null);
  const copy = STRINGS.practice;
  const playing = attempt?.outcome === null;

  useEffect(() => {
    if (document.activeElement === document.body) {
      playArea.current?.focus({ preventScroll: true });
    }
  }, []);

  const move = useCallback((direction: Move) => {
    setAttempt((previous) => previous && applyMove(previous, direction).state);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) => {
    if (!playing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!Object.hasOwn(keyMove, event.key)) return;
    const direction = keyMove[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    move(direction);
  }, [move, playing]);

  useEffect(() => {
    if (!playing) return;
    function onPageKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target === document.body || target === document.documentElement || target === document) {
        onKeyDown(event);
      }
    }
    document.addEventListener('keydown', onPageKeyDown);
    return () => document.removeEventListener('keydown', onPageKeyDown);
  }, [onKeyDown, playing]);

  function showErosion() {
    if (!practice || attempt?.outcome !== 'solved' || preview) return;
    const day = addDays(practice.day, 1);
    const snapshot = Array<number>(attempt.maze.states.length).fill(0);
    for (const cell of visitedSet(attempt.route)) snapshot[cell] = 1;
    const next = evolve(attempt.maze, snapshot, day, 0);
    if (!next.ok) return;
    const { maze, report: changes } = next.value;
    const route = solve(maze);
    if (route.kind !== 'solved') return;
    setAttempt(initAttempt(maze, moveBudget(route.par, weekday(day))));
    setPreview({ changes, par: route.par });
    playArea.current?.focus({ preventScroll: true });
  }

  function reset() {
    setAttempt(practice?.initial ?? null);
    setPreview(null);
  }

  return (
    <main ref={playArea} aria-label={copy.title} tabIndex={0} onKeyDown={onKeyDown}>
      <h1>{STRINGS.gameName}</h1>
      <h2 className="practice-title">{copy.title}</h2>
      <p>{copy.note}</p>
      {attempt && practice ? (
        <>
          <p className="instructions">
            {preview ? copy.erosion(preview.changes.worn.length, preview.changes.wallsRemoved.length, preview.changes.newlyOvergrown.length) : copy.directions}
          </p>
          <Board attempt={attempt} />
          <p className="move-cost" role="status">{copy.cost(attempt.cost, attempt.budget)}</p>
          {attempt.outcome !== null && (
            <section className="result-card" aria-labelledby="practice-result">
              <h3 id="practice-result">{attempt.outcome === 'solved' ? copy.solved : copy.exhausted}</h3>
              <p>{copy.result(attempt.cost, preview?.par ?? practice.par)}</p>
              {attempt.outcome === 'solved' && !preview && <button className="primary" type="button" onClick={showErosion}>{copy.nextBoard}</button>}
            </section>
          )}
          <div className="controls">
            {MOVES.map((direction) => (
              <button key={direction} type="button" disabled={attempt.outcome !== null} onClick={() => move(direction)}>
                {copy.moves[direction]}
              </button>
            ))}
          </div>
          <div className="controls">
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
