export type AnchorTarget = {
  line: number;
  column: number;
  endColumn?: number;
};

export type AnchorCandidate = {
  anchor: unknown;
  target: AnchorTarget;
};

export function scoreAnchorCandidate(
  candidate: AnchorCandidate,
  line: number,
  column: number,
  isCurrentSelected: boolean
): number {
  const lineDelta = Math.abs(candidate.target.line - line);
  const startCol = Number(candidate.target.column);
  const endCol = Number(candidate.target.endColumn ?? candidate.target.column);
  const span = Math.max(0, endCol - startCol);
  const inRange = lineDelta === 0 && column >= startCol && column <= endCol;

  let colDelta = 0;
  if (column < startCol) {
    colDelta = startCol - column;
  } else if (column > endCol) {
    colDelta = column - endCol;
  }

  const center = (startCol + endCol) / 2;
  const centerDelta = Math.abs(column - center);
  const selectionPenalty = isCurrentSelected ? -0.25 : 0;

  return lineDelta * 100000 + (inRange ? 0 : 1500) + colDelta * 10 + centerDelta + span * 0.05 + selectionPenalty;
}

export function chooseBestAnchor(
  candidates: AnchorCandidate[],
  line: number,
  column: number,
  currentSelectedAnchor: unknown,
  hysteresisScore: number
): AnchorCandidate | null {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  let best: AnchorCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let current: AnchorCandidate | null = null;
  let currentScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const isCurrent = candidate.anchor === currentSelectedAnchor;
    const score = scoreAnchorCandidate(candidate, line, column, isCurrent);

    if (isCurrent) {
      current = candidate;
      currentScore = score;
    }

    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (current && best && current !== best) {
    const improvement = currentScore - bestScore;
    if (improvement <= hysteresisScore) {
      return current;
    }
  }

  return best;
}
