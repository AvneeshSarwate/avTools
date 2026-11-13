/**
 * Jonker-Volgenant algorithm for the Linear Assignment Problem.
 *
 * Ported from lap.js by Philippe Rivière (https://github.com/Fil/lap-jv),
 * which was ported from lap.cpp by Roy Jonker @ MagicLogic Optimization Inc.
 *
 * "A Shortest Augmenting Path Algorithm for Dense and Sparse Linear
 *  Assignment Problems," Computing 38, 325-340, 1987
 *  by R. Jonker and A. Volgenant, University of Amsterdam.
 */

export interface LapResult {
  cost: number;
  row: Int32Array; // row[i] = column assigned to row i
  col: Int32Array; // col[j] = row assigned to column j
}

export function lap(
  dim: number,
  cost: (i: number, j: number) => number,
): LapResult {
  let sum = 0;
  for (let i1 = 0; i1 < dim; i1++) {
    for (let j1 = 0; j1 < dim; j1++) sum += cost(i1, j1);
  }
  const BIG = 10000 * (sum / dim);
  const epsilon = sum / dim / 10000;
  const rowsol = new Int32Array(dim);
  const colsol = new Int32Array(dim);
  const u = new Float64Array(dim);
  const v = new Float64Array(dim);

  let unassignedfound: boolean;
  let i: number,
    imin: number,
    numfree = 0,
    prvnumfree: number,
    f: number,
    i0: number,
    k: number,
    freerow: number;
  let j: number,
    j1: number,
    j2 = 0,
    endofpath = 0,
    last = 0,
    low: number,
    up: number;
  let min = 0, h: number, umin: number, usubmin: number, v2: number;

  const free = new Int32Array(dim);
  const collist = new Int32Array(dim);
  const matches = new Int32Array(dim);
  const d = new Float64Array(dim);
  const pred = new Int32Array(dim);

  for (i = 0; i < dim; i++) matches[i] = 0;

  // COLUMN REDUCTION
  for (j = dim; j--; ) {
    min = cost(0, j);
    imin = 0;
    for (i = 1; i < dim; i++)
      if (cost(i, j) < min) {
        min = cost(i, j);
        imin = i;
      }
    v[j] = min;
    if (++matches[imin] == 1) {
      rowsol[imin] = j;
      colsol[j] = imin;
    } else if (v[j] < v[rowsol[imin]]) {
      j1 = rowsol[imin];
      rowsol[imin] = j;
      colsol[j] = imin;
      colsol[j1] = -1;
    } else colsol[j] = -1;
  }

  // REDUCTION TRANSFER
  for (i = 0; i < dim; i++) {
    if (matches[i] == 0) free[numfree++] = i;
    else if (matches[i] == 1) {
      j1 = rowsol[i];
      min = BIG;
      for (j = 0; j < dim; j++)
        if (j != j1) if (cost(i, j) - v[j] < min + epsilon) min = cost(i, j) - v[j];
      v[j1] = v[j1] - min;
    }
  }

  // AUGMENTING ROW REDUCTION
  let loopcnt = 0;
  do {
    loopcnt++;
    k = 0;
    prvnumfree = numfree;
    numfree = 0;
    while (k < prvnumfree) {
      i = free[k];
      k++;
      umin = cost(i, 0) - v[0];
      j1 = 0;
      usubmin = BIG;
      for (j = 1; j < dim; j++) {
        h = cost(i, j) - v[j];
        if (h < usubmin)
          if (h >= umin) {
            usubmin = h;
            j2 = j;
          } else {
            usubmin = umin;
            umin = h;
            j2 = j1;
            j1 = j;
          }
      }
      i0 = colsol[j1];
      if (umin < usubmin + epsilon) v[j1] = v[j1] - (usubmin + epsilon - umin);
      else if (i0 > -1) {
        j1 = j2;
        i0 = colsol[j2];
      }
      rowsol[i] = j1;
      colsol[j1] = i;
      if (i0 > -1)
        if (umin < usubmin) free[--k] = i0;
        else free[numfree++] = i0;
    }
  } while (loopcnt < 2);

  // AUGMENT SOLUTION
  for (f = 0; f < numfree; f++) {
    freerow = free[f];
    for (j = dim; j--; ) {
      d[j] = cost(freerow, j) - v[j];
      pred[j] = freerow;
      collist[j] = j;
    }
    low = 0;
    up = 0;
    unassignedfound = false;
    do {
      if (up == low) {
        last = low - 1;
        min = d[collist[up++]];
        for (k = up; k < dim; k++) {
          j = collist[k];
          h = d[j];
          if (h <= min) {
            if (h < min) {
              up = low;
              min = h;
            }
            collist[k] = collist[up];
            collist[up++] = j;
          }
        }
        for (k = low; k < up; k++)
          if (colsol[collist[k]] < 0) {
            endofpath = collist[k];
            unassignedfound = true;
            break;
          }
      }
      if (!unassignedfound) {
        j1 = collist[low];
        low++;
        i = colsol[j1];
        h = cost(i, j1) - v[j1] - min;
        for (k = up; k < dim; k++) {
          j = collist[k];
          v2 = cost(i, j) - v[j] - h;
          if (v2 < d[j]) {
            pred[j] = i;
            if (v2 == min)
              if (colsol[j] < 0) {
                endofpath = j;
                unassignedfound = true;
                break;
              } else {
                collist[k] = collist[up];
                collist[up++] = j;
              }
            d[j] = v2;
          }
        }
      }
    } while (!unassignedfound);

    for (k = last + 1; k--; ) {
      j1 = collist[k];
      v[j1] = v[j1] + d[j1] - min;
    }
    do {
      i = pred[endofpath];
      colsol[endofpath] = i;
      j1 = endofpath;
      endofpath = rowsol[i];
      rowsol[i] = j1;
    } while (i != freerow);
  }

  let lapcost = 0;
  for (i = dim; i--; ) {
    j = rowsol[i];
    u[i] = cost(i, j) - v[j];
    lapcost = lapcost + cost(i, j);
  }

  return { cost: lapcost, row: rowsol, col: colsol };
}
