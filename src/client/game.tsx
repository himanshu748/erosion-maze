import { context } from '@devvit/web/client';
import { StrictMode, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { isDailyPost, restoreDailyRun, restoreSignedOutDaily, shouldSaveProgress, type DailyRun } from '../shared/daily-run';
import type { FinishResponse, ProgressResponse, StateResponse } from '../shared/api';
import { rankedSaveRequest, type RankedRequestKind } from './ranked-save';
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

function useMazeKeyboard(playing: boolean, move: (direction: Move) => void) {
  const playArea = useRef<HTMLElement>(null);

  useEffect(() => {
    if (document.activeElement === document.body) {
      playArea.current?.focus({ preventScroll: true });
    }
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

  return { playArea, onKeyDown };
}

function PracticeGame() {
  const [practice] = useState(preparePractice);
  const [attempt, setAttempt] = useState(practice?.initial ?? null);
  const [preview, setPreview] = useState<RolloverPreview | null>(null);
  const copy = STRINGS.practice;
  const move = useCallback((direction: Move) => {
    setAttempt((previous) => previous && applyMove(previous, direction).state);
  }, []);
  const { playArea, onKeyDown } = useMazeKeyboard(attempt?.outcome === null, move);

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

type DailyStatus = 'loading' | 'ready' | 'saving' | 'retry' | 'reload';

function DailyGame() {
  const [run, setRun] = useState<DailyRun | null>(null);
  const [status, setStatus] = useState<DailyStatus>('loading');
  const current = useRef<DailyRun | null>(null);
  const pending = useRef<{ readonly kind: RankedRequestKind } | null>(null);
  const flushOnHide = useRef(false);
  const needsAttention = useRef(false);
  const copy = STRINGS.daily;

  const replaceRun = useCallback((next: DailyRun | null) => {
    current.current = next;
    setRun(next);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (pending.current) return;
    pending.current = { kind: 'load' };
    setStatus('loading');
    const fromPost = () => restoreSignedOutDaily(context?.postData, puzzleDayFromMs(Date.now()));
    try {
      let restored: DailyRun | null;
      if (context?.userId) {
        const response = await fetch('/api/state?first=1', { signal: signal ?? null });
        if (!response.ok) throw new Error('State request failed');
        restored = restoreDailyRun(await response.json() as StateResponse);
      } else {
        restored = fromPost();
      }
      if (signal?.aborted) return;
      if (!restored) throw new Error('State could not be restored');
      replaceRun(restored);
      needsAttention.current = false;
      setStatus('ready');
    } catch {
      if (!signal?.aborted) {
        const archived = fromPost();
        if (archived && archived.puzzle.dayStatus !== 'live') {
          replaceRun(archived);
          needsAttention.current = false;
          setStatus('ready');
        } else {
          needsAttention.current = true;
          setStatus('reload');
        }
      }
    } finally {
      pending.current = null;
    }
  }, [replaceRun]);

  useEffect(() => {
    const controller = new AbortController();
    // Let StrictMode discard its first test mount before sending a request.
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  const sync = useCallback(async (onHide = false) => {
    const initial = current.current;
    if (!initial) return;
    let request = rankedSaveRequest(initial, pending.current?.kind);
    if (!request) {
      if (onHide && pending.current?.kind === 'progress') flushOnHide.current = true;
      return;
    }
    let snapshot: DailyRun = initial;
    const operation = { kind: request.kind };
    pending.current = operation;
    setStatus('saving');
    try {
      while (request) {
        const finished = request.kind === 'finish';
        flushOnHide.current = false;
        const response = await fetch(request.url, request.options);
        if (!response.ok) throw new Error('Save request failed');
        const result = await response.json() as FinishResponse | ProgressResponse;
        if (pending.current !== operation) return;
        if (result.status === 'error' || result.status === 'rate_limited') {
          throw new Error('Save is temporarily unavailable');
        }
        if (result.status !== 'ok' ||
            (finished && (!('result' in result) || result.result.cost !== snapshot.attempt.cost ||
              result.result.outcome !== snapshot.attempt.outcome)) ||
            (!finished && (!('finished' in result) || result.finished !== null))) {
          needsAttention.current = true;
          setStatus('reload');
          return;
        }
        const latest = current.current ?? snapshot;
        const saved = snapshot.attempt.accepted.length;
        const accepted = latest.attempt.accepted.length;
        snapshot = { ...latest, savedMoves: saved, confirmed: finished };
        replaceRun(snapshot);
        if (accepted <= saved ||
            (snapshot.attempt.outcome === null && !flushOnHide.current &&
              !shouldSaveProgress(saved, accepted))) break;
        request = rankedSaveRequest(snapshot);
      }
      needsAttention.current = false;
      setStatus('ready');
    } catch {
      if (pending.current === operation) {
        needsAttention.current = true;
        setStatus('retry');
      }
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        flushOnHide.current = false;
      }
    }
  }, [replaceRun]);

  useEffect(() => {
    const saveOnHide = () => {
      if (document.visibilityState === 'hidden' && !needsAttention.current) void sync(true);
    };
    document.addEventListener('visibilitychange', saveOnHide);
    return () => document.removeEventListener('visibilitychange', saveOnHide);
  }, [sync]);

  const move = useCallback((direction: Move) => {
    const previous = current.current;
    if (!previous || needsAttention.current || previous.puzzle.dayStatus !== 'live') return;
    const next = applyMove(previous.attempt, direction);
    if (next.result !== 'accepted') return;
    replaceRun({ ...previous, attempt: next.state });
    if (next.state.outcome !== null || shouldSaveProgress(previous.savedMoves, next.state.accepted.length)) void sync();
  }, [replaceRun, sync]);

  const playing = Boolean(run && (status === 'ready' || status === 'saving') &&
    run.puzzle.dayStatus === 'live' && run.attempt.outcome === null);
  const { playArea, onKeyDown } = useMazeKeyboard(playing, move);

  return (
    <main ref={playArea} aria-label={STRINGS.gameName} tabIndex={0} onKeyDown={onKeyDown}>
      <h1>{STRINGS.gameName}</h1>
      {run && (
        <>
          <h2 className="practice-title">{copy.number(run.puzzle.dayNumber)}</h2>
          <p className="instructions">{run.puzzle.dayStatus === 'closed' ? copy.closed :
            run.puzzle.dayStatus === 'skipped' ? copy.skipped :
              STRINGS.practice.directions}</p>
          {run.puzzle.dayStatus === 'live' && !run.puzzle.loggedIn && <p>{copy.signedOut}</p>}
          <Board attempt={run.attempt} />
          <p className="move-cost">{STRINGS.practice.cost(run.attempt.cost, run.attempt.budget)}</p>
          {run.attempt.outcome !== null && (run.confirmed || !run.puzzle.loggedIn) && (
            <section className="result-card" aria-labelledby="daily-result">
              <h3 id="daily-result">{run.attempt.outcome === 'solved' ? STRINGS.practice.solved : STRINGS.practice.exhausted}</h3>
              <p>{STRINGS.practice.result(run.attempt.cost, run.puzzle.par)}</p>
              {run.confirmed && <p>{copy.saved}</p>}
            </section>
          )}
          <div className="controls">
            {MOVES.map((direction) => (
              <button type="button" key={direction} disabled={!playing} onClick={() => move(direction)}>
                {STRINGS.practice.moves[direction]}
              </button>
            ))}
          </div>
        </>
      )}
      <p role="status">{status === 'loading' ? copy.loading : status === 'saving' ? copy.saving :
        status === 'retry' ? copy.saveError : status === 'reload' ? run ? copy.stale : copy.unavailable : null}</p>
      {status === 'retry' && <button type="button" onClick={() => void sync()}>{copy.retry}</button>}
      {status === 'reload' && <button type="button" onClick={() => void load()}>{run ? copy.refresh : copy.retry}</button>}
    </main>
  );
}

export function App() {
  return isDailyPost(context?.postData) ? <DailyGame /> : <PracticeGame />;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
