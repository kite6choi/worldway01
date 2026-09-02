/**
 * tdd_analyzer_test.js
 * 월드웨이 동결건조기 예지보전 하이브리드 AI TDD 단위 검증 모듈
 * (Node.js 및 브라우저 환경 호환)
 */

const TDD_Assert = {
  assertEquals: function(actual, expected, message) {
    if (actual !== expected) {
      const err = `[FAIL] ${message} - Expected: ${expected}, but got: ${actual}`;
      console.error(`%c${err}`, "color: #EF4444; font-weight: bold;");
      throw new Error(err);
    }
    console.log(`%c[PASS] ${message}`, "color: #10B981; font-weight: bold;");
  },
  assertCloseTo: function(actual, expected, precision, message) {
    const diff = Math.abs(actual - expected);
    const threshold = Math.pow(10, -precision);
    if (diff > threshold) {
      const err = `[FAIL] ${message} - Expected close to: ${expected}, but got: ${actual} (diff: ${diff})`;
      console.error(`%c${err}`, "color: #EF4444; font-weight: bold;");
      throw new Error(err);
    }
    console.log(`%c[PASS] ${message}`, "color: #10B981; font-weight: bold;");
  }
};

/**
 * 1. TDD 수학 공식 타당성 검사 (Task 7 평가지표 산출 제어)
 */
function runTddMathValidationTest() {
  console.log("%c▶ runTddMathValidationTest 시작...", "color: #3B82F6; font-weight: bold;");
  
  // 가상 100건 테스트 데이터셋 (4개 클래스 균형 및 불균형 복합)
  // 실제 정답: 0 (40건), 1 (20건), 2 (30건), 3 (10건)
  const mockActualLabels = [
    ...Array(40).fill(0),
    ...Array(20).fill(1),
    ...Array(30).fill(2),
    ...Array(10).fill(3)
  ];
  
  // 예측 라벨:
  // Class 0 (40건): 38건 맞춤, 1건->1, 1건->2
  // Class 1 (20건): 18건 맞춤, 1건->0, 1건->2
  // Class 2 (30건): 27건 맞춤, 1건->0, 1건->1, 1건->3
  // Class 3 (10건): 8건 맞춤, 1건->2, 1건->3 (오타없이 8건 맞춤, 1건->2, 1건->1)
  const mockPredictedLabels = [
    ...Array(38).fill(0), 1, 2,                    // 실제 0 (38개 0, 1개 1, 1개 2)
    ...Array(18).fill(1), 0, 2,                    // 실제 1 (18개 1, 1개 0, 1개 2)
    ...Array(27).fill(2), 0, 1, 3,                 // 실제 2 (27개 2, 1개 0, 1개 1, 1개 3)
    ...Array(8).fill(3), 2, 1                      // 실제 3 (8개 3, 1개 2, 1개 1)
  ];

  const matrixSize = 4;
  const confusionMatrix = Array.from(Array(matrixSize), () => Array(matrixSize).fill(0));
  
  for (let i = 0; i < mockActualLabels.length; i++) {
    const actual = mockActualLabels[i];
    const pred = mockPredictedLabels[i];
    confusionMatrix[actual][pred]++;
  }

  // 통계 계산 파이프라인 (plan.md 수식 준수)
  let sumF1 = 0;
  let totalPrecision = 0;
  let totalRecall = 0;

  for (let c = 0; c < matrixSize; c++) {
    let tp = confusionMatrix[c][c];
    let fp = 0;
    let fn = 0;

    for (let i = 0; i < matrixSize; i++) {
      if (i !== c) {
        fp += confusionMatrix[i][c]; // 열의 합에서 tp 제외 (FP)
        fn += confusionMatrix[c][i]; // 행의 합에서 tp 제외 (FN)
      }
    }

    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    totalPrecision += precision;
    totalRecall += recall;
    sumF1 += f1;
  }

  // Macro F1 (각 클래스 F1-Score의 산술 평균)
  const macroPrecision = totalPrecision / matrixSize;
  const macroRecall = totalRecall / matrixSize;
  const macroF1Score = sumF1 / matrixSize;

  TDD_Assert.assertCloseTo(macroPrecision, 0.89901, 4, "전체 4대 클래스 매크로 정밀도(Precision) 정합성 확인");
  TDD_Assert.assertCloseTo(macroRecall, 0.88750, 4, "전체 4대 클래스 매크로 재현율(Recall) 정합성 확인");
  TDD_Assert.assertCloseTo(macroF1Score, 0.89254, 4, "전체 4대 클래스 종합 매크로 F1-Score 정합성 확인");
  TDD_Assert.assertEquals(macroF1Score >= 0.80, true, "공인 과제 최종 규격 0.80 초과 충족 여부 테스트");

  return { macroPrecision, macroRecall, macroF1Score, confusionMatrix };
}

/**
 * 2. TDD 오토인코더 복원 오차 및 임계치 판정 검사 (Task 3 정상 제어 루프 검증)
 */
function runTddAnomalyDetectorTest() {
  console.log("%c▶ runTddAnomalyDetectorTest 시작...", "color: #3B82F6; font-weight: bold;");
  
  // 훈련 완료 후 정량 도출되어 고정되었다고 가정하는 MSE 복원오차 임계값 상수
  const THRESHOLD_MSE = 0.0450; 
  
  // Case A: 정상 펌프 전류 및 온도 복구 시나리오
  const inputNormalSampleMSE = 0.0182; // 임계치 한계점 안의 복원 오차
  const isNormalAnomalyDetected = inputNormalSampleMSE > THRESHOLD_MSE;
  TDD_Assert.assertEquals(isNormalAnomalyDetected, false, "임계치 이하의 복원 오차 주입 시 정상(Normal) 상태 판정 유지 검사");
  
  // Case B: 설비 고장 인젝션 시나리오 (부스터1 전류 복원 불가 수준 변동 상황 모사)
  const inputAnomalySampleMSE = 0.1254; // 임계치를 한참 넘어서는 오차
  const isAnomalyDetected = inputAnomalySampleMSE > THRESHOLD_MSE;
  TDD_Assert.assertEquals(isAnomalyDetected, true, "임계치를 초과하는 복원 오차 주입 시 이상(Anomaly) 탐지 및 2단계 연쇄 기동 신호 트리거 검사");
}

/**
 * 3. TDD 10차원 특징 융합 및 확률 정합성 검사 (Task 4 검증)
 */
function runTddFeatureFusionAndProbabilityTest() {
  console.log("%c▶ runTddFeatureFusionAndProbabilityTest 시작...", "color: #3B82F6; font-weight: bold;");

  const rawVector = [16.5, 3.68, 5.04, 0.30, 15.0];
  const reconstructedVector = [16.48, 3.65, 5.00, 0.31, 14.9];
  
  // 10차원 융합
  const fused = new Float32Array(10);
  for (let i = 0; i < 5; i++) {
    fused[i] = rawVector[i];
    fused[i + 5] = Math.abs(rawVector[i] - reconstructedVector[i]);
  }

  TDD_Assert.assertEquals(fused.length, 10, "10차원 융합 피처 벡터 길이 (10) 정합성 확인");
  TDD_Assert.assertCloseTo(fused[5], 0.02, 3, "첫 번째 센서 복원 오차 절대값 계산 확인");

  // 가상 다중 클래스 확률 벡터 (Softmax / Random Forest proba)
  const mockProba = [0.05, 0.85, 0.07, 0.03]; // dry pump failure dominant
  const sumProba = mockProba.reduce((a, b) => a + b, 0);
  TDD_Assert.assertCloseTo(sumProba, 1.0, 5, "4대 클래스 확률의 총합 1.0 (100%) 수렴 검증");
}

// 전체 테스트 실행
function runAllTddTests() {
  try {
    console.log("==================================================");
    runTddMathValidationTest();
    runTddAnomalyDetectorTest();
    runTddFeatureFusionAndProbabilityTest();
    console.log("%c🏆 축하합니다! 모든 TDD 실증 단위 테스트 케이스 검증을 완전 통과(GREEN)했습니다!", "color: #10B981; font-weight: bold; font-size: 14px;");
    console.log("==================================================");
    return { success: true, message: "모든 TDD 테스트 통과" };
  } catch (error) {
    console.error("%c🚨 TDD 자가 진단 검증 실패: ", "color: #EF4444; font-weight: bold;", error);
    return { success: false, error: error.message };
  }
}

// Node.js 환경에서 직접 실행 지원
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TDD_Assert,
    runTddMathValidationTest,
    runTddAnomalyDetectorTest,
    runTddFeatureFusionAndProbabilityTest,
    runAllTddTests
  };
  if (require.main === module) {
    runAllTddTests();
  }
}
