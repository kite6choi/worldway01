/**
 * metrics-calculator.js
 * 실시간 4x4 Confusion Matrix 및 Macro F1-Score 정량 성능 계산기
 */

class MetricsCalculator {
  constructor() {
    this.matrixSize = 4;
    this.confusionMatrix = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ];
    this.totalEvaluated = 0;
    this.macroPrecision = 0;
    this.macroRecall = 0;
    this.macroF1 = 0;
  }

  reset() {
    this.confusionMatrix = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ];
    this.totalEvaluated = 0;
    this.macroPrecision = 0;
    this.macroRecall = 0;
    this.macroF1 = 0;
    this.updateDom();
  }

  recordPrediction(actualClass, predictedClass) {
    if (actualClass < 0 || actualClass >= 4 || predictedClass < 0 || predictedClass >= 4) return;
    
    this.confusionMatrix[actualClass][predictedClass]++;
    this.totalEvaluated++;

    this.calculateMetrics();
    this.updateDom();
  }

  calculateMetrics() {
    let sumP = 0;
    let sumR = 0;
    let sumF1 = 0;

    for (let c = 0; c < this.matrixSize; c++) {
      const tp = this.confusionMatrix[c][c];
      let fp = 0;
      let fn = 0;

      for (let i = 0; i < this.matrixSize; i++) {
        if (i !== c) {
          fp += this.confusionMatrix[i][c]; // 열의 합 (오탐)
          fn += this.confusionMatrix[c][i]; // 행의 합 (미탐)
        }
      }

      const precision = (tp + fp) > 0 ? tp / (tp + fp) : (tp === 0 && fn === 0 ? 1 : 0);
      const recall = (tp + fn) > 0 ? tp / (tp + fn) : (tp === 0 && fp === 0 ? 1 : 0);
      const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

      sumP += precision;
      sumR += recall;
      sumF1 += f1;
    }

    this.macroPrecision = sumP / this.matrixSize;
    this.macroRecall = sumR / this.matrixSize;
    this.macroF1 = sumF1 / this.matrixSize;

    return {
      precision: this.macroPrecision,
      recall: this.macroRecall,
      f1Score: this.macroF1,
      total: this.totalEvaluated
    };
  }

  updateDom() {
    // 1. 매트릭스 셀 갱신
    for (let actual = 0; actual < 4; actual++) {
      let rowTotal = 0;
      for (let pred = 0; pred < 4; pred++) {
        const val = this.confusionMatrix[actual][pred];
        rowTotal += val;
        const cell = document.getElementById(`cm-${actual}-${pred}`);
        if (cell) {
          cell.innerText = val.toLocaleString();
        }
      }
      const rowTotalCell = document.getElementById(`cm-total-${actual}`);
      if (rowTotalCell) rowTotalCell.innerText = rowTotal.toLocaleString();
    }

    // 2. 상단/하단 메트릭 디스플레이 갱신
    const f1Elem = document.getElementById('macro-f1-display');
    const pElem = document.getElementById('macro-precision-display');
    const rElem = document.getElementById('macro-recall-display');
    const countElem = document.getElementById('evaluated-count-display');

    if (f1Elem) f1Elem.innerText = this.macroF1.toFixed(4);
    if (pElem) pElem.innerText = (this.macroPrecision * 100).toFixed(2) + '%';
    if (rElem) rElem.innerText = (this.macroRecall * 100).toFixed(2) + '%';
    if (countElem) countElem.innerText = `${this.totalEvaluated.toLocaleString()} / 50,000`;

    // 3. 골드 품질 인증 배지 (F1-Score >= 0.80)
    const badge = document.getElementById('gold-quality-badge');
    if (badge) {
      if (this.totalEvaluated >= 50 && this.macroF1 >= 0.80) {
        badge.className = "flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400 text-amber-950 font-black glow-gold transition-all duration-300 transform scale-105";
        badge.innerHTML = `
          <svg class="w-5 h-5 text-amber-900 animate-bounce" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path>
          </svg>
          <span>⭐ 품질 규격 0.80 초과 달성 (Certified)</span>
        `;
      } else {
        badge.className = "flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-slate-400 font-bold border border-slate-700";
        badge.innerHTML = `
          <svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
          </svg>
          <span>품질 규격 검증 대기 (목표 F1: 0.80)</span>
        `;
      }
    }
  }
}

window.metricsCalculator = new MetricsCalculator();
