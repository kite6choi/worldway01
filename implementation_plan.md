# 월드웨이 동결건조기 예지보전 하이브리드 AI PWA 구현 계획서

`spec.md`, `plan.md`, `tasks.md`의 명세에 따라, 150,000건의 제조 시계열 데이터를 브라우저 단독(Client-side)으로 전처리하고, **[1단계: TensorFlow.js 오토인코더 비지도 이상 탐지] ➡ [특징 융합: 10차원 피처] ➡ [2단계: 다중 분류기 고장 진단]** 하이브리드 AI 파이프라인을 구축하며, 1초 주기 시뮬레이션 및 실시간 60fps 시각화, Confusion Matrix 및 **F1-Score 0.80 이상** 실시간 검증 패널을 갖춘 고품질 PWA 웹 애플리케이션을 개발합니다.

---

## User Review Required

> [!IMPORTANT]
> **대용량 데이터(15만 건) 브라우저 처리 및 내장 로딩 편의성**
> 사용자가 `챔버1_정상_12만건.csv` 및 `챔버1_고장전1주일데이터_3만건.csv`를 직접 드래그앤드롭하여 로드할 수도 있고, 로컬 환경에서 원클릭으로 즉시 탑재할 수 있도록 **"기본 실측 데이터셋 원클릭 로드"** 기능도 함께 탑재합니다.

> [!NOTE]
> **2단계 다중 분류기 (Random Forest / Decision Ensemble Classifier)**
> JavaScript 환경에서 10차원 융합 피처를 고속 학습 및 확률 추론(`predictProba`)할 수 있도록 자체 최적화된 Random Forest / Multi-class Ensemble 모듈을 순수 JS로 탑재하여 외부 의존성 문제 없이 100% 브라우저 내에서 훈련 및 4대 클래스 확률 추론이 가능하게 구현합니다.

---

## 개발 태스크 및 구현 단계 (Roadmap)

### 1단계: 프론트엔드 인프라 및 핵심 데이터베이스 (Task 1 & Task 2)
1. **PWA 웹 앱 뼈대 및 스타일링 (`index.html`, `styles.css`, `manifest.json`, `sw.js`)**
   - Tailwind CSS v3 + DaisyUI v4 기반 프리미엄 산업용 다크 테마 대시보드 레이아웃.
   - PWA 설치 지원(`manifest.json`, 192/512px 아이콘) 및 오프라인 캐싱 서비스 워커(`sw.js`).
2. **IndexedDB (Dexie.js) 데이터 스토리지 및 전처리/층화 분할 엔진**
   - `WorldwayPredictiveDB` (`measurements` 테이블: `timestamp, dry_pump, booster1, booster2, temp, vacuum, label_class, split_type`).
   - PapaParse 스트림 파싱 및 가동 영역 필터링 (진공도 > 10 Torr 비가동 영역 차단), 결측치 선형 보간.
   - **정확한 층화 분할 (8:2:5)**:
     - **Train (80,000건)**: 정상 64,000건, 건식고장 5,333건, 부스터1고장 5,333건, 부스터2고장 5,334건
     - **Val (20,000건)**: 정상 16,000건, 건식고장 1,333건, 부스터1고장 1,333건, 부스터2고장 1,334건
     - **Test (50,000건)**: 정상 40,000건, 건식고장 3,334건, 부스터1고장 3,334건, 부스터2고장 3,332건

### 2단계: TensorFlow.js 기반 AI 모델링 및 특징 융합 (Task 3 & Task 4)
1. **1단계 TensorFlow.js 오토인코더 이상 탐지 모델**
   - 네트워크 구조: `5D ➡ Dense(3, ReLU) ➡ Latent(2, ReLU) ➡ Dense(3, ReLU) ➡ 5D (Linear)`
   - Train 정상 64,000건으로 학습, Val 정상 16,000건 손실률 모니터링 및 조기 종료 (Early Stopping, patience=3).
   - Val 정상 16,000건의 MSE 복원 오차 분포에서 **상위 99% 백분위수(Percentile 99)**를 계산하여 이상 임계치 $T_h$로 잠금(Lock).
2. **10차원 특징 융합 (Feature Fusion) 엔진**
   - $X_{\text{fusion}} = [x_{\text{dry}}, x_{\text{b1}}, x_{\text{b2}}, x_{\text{temp}}, x_{\text{vac}}, |x_{\text{dry}}-\hat{x}_{\text{dry}}|, |x_{\text{b1}}-\hat{x}_{\text{b1}}|, |x_{\text{b2}}-\hat{x}_{\text{b2}}|, |x_{\text{temp}}-\hat{x}_{\text{temp}}|, |x_{\text{vac}}-\hat{x}_{\text{vac}}|]$
3. **2단계 Random Forest / XGBoost 스타일 다중 분류기**
   - 10차원 융합 훈련 데이터(80,000건)로 학습.
   - `predictProba()`를 통해 4대 클래스(정상, 드라이펌프, 부스터1, 부스터2) 확률 분포 산출.

### 3단계: 시뮬레이션 콘솔 & 실시간 60fps 모니터링 UI (Task 5 & Task 6)
1. **실시간 1초 주기 플레이백 시뮬레이터**
   - 시험 데이터(50,000건) 기반 1초 1건 전진 큐.
   - 재생/일시정지/배속(x1, x5, x10) 조절.
   - **10% 고장 강제 인젝션 (Fault Injection)**: 난수 < 0.10 시 고장 데이터(Class 1, 2, 3)를 무작위 주입.
2. **uPlot 캔버스 60fps 실시간 롤링 차트**
   - 5대 센서 트렌드 실시간 시계열 그래프 (FIFO 100포인트 링버퍼 최적화).
   - 오토인코더 복원 오차 추이 및 이상 임계치선($T_h$) 동적 가로 오버레이.
   - 4대 클래스 실시간 진단 확률(%) 게이지/바 차트.
3. **동적 3색 스마트 사이렌 & 현장 정비 가이드**
   - **녹색 (Green)**: 복원 오차 $\le T_h$ (안정 가동)
   - **황색 (Yellow)**: 복원 오차 $> T_h$이나 최대 고장 확률 $< 70\%$ (일시적 주의)
   - **적색 (Red)**: 복원 오차 $> T_h$이고 고장 확률 $\ge 70\%$ (긴급 점검 사이렌 & 부품별 한글 정비 가이드)

### 4단계: TDD 정량 성능 검증 패널 및 PWA 배포 최적화 (Task 7 & Task 8)
1. **실시간 4x4 Confusion Matrix 및 매크로 F1-Score 계산기**
   - 정답 라벨 vs 예측 라벨 실시간 대조 누적.
   - 클래스별 TP, FP, FN, Precision, Recall, F1 및 **Macro F1-Score** 실시간 산출.
   - **F1-Score $\ge 0.80$ 달성 시 골드 인증 스탬프 뱃지 점등**.
2. **TDD 자가 진단 테스트 스위트 내장 (`tdd_test.js`)**
   - 수학 연산 정합성, 임계치 판정, 10D 피처 차원성, F1-Score 수식 및 뱃지 상태 반응 자동 검증.
   - 웹 화면 내 'TDD 자가 검증 실행' 버튼으로 즉시 테스트 실행 및 결과 모달/로그 표시.
3. **PWA 캐싱 및 프로덕션 번들링**
   - `sw.js` 오프라인 캐싱, Netlify 정적 배포 준비.

---

## Proposed Changes

### 웹 애플리케이션 소스코드 구성

#### [NEW] [index.html](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/index.html)
- 대시보드 메인 마크업 (반응형 12컬럼 그리드, 4대 핵심 영역: 데이터 셋업 센터, AI 훈련 콘솔, 실시간 시뮬레이션 & 3색 알람, TDD 정량 검증 패널).
- CDN 라이브러리 (Tailwind CSS, DaisyUI, Dexie, PapaParse, TensorFlow.js, uPlot).

#### [NEW] [styles.css](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/styles.css)
- 사이버펑크/인더스트리얼 다크 테마 커스텀 스타일, 골드 인증 배지 글로우, 3색 사이렌 펄스 애니메이션, uPlot 차트 테마.

#### [NEW] [app.js](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/app.js)
- UI 이벤트 바인딩, 워크플로우 오케스트레이션, 시뮬레이터 타이머, 3색 알람 상태머신, 데이터 인제스천 트리거.

#### [NEW] [ai-engine.js](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/ai-engine.js)
- 오토인코더 모델 구축, MinMax 스케일러, 훈련 루프, 99% 백분위 임계치 계산, 10차원 융합 피처 생성, 다중 클래스 앙상블 분류기 학습 및 `predictProba()` 추론 엔진.

#### [NEW] [data-store.js](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/data-store.js)
- Dexie.js IndexedDB 인스턴스, PapaParse 스트림 파싱, 진공도 10 Torr 필터링, 선형 보간 전처리, 8:2:5 층화 분할 및 벌크 인서트.

#### [NEW] [charts-manager.js](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/charts-manager.js)
- uPlot 실시간 센서 트렌드 캔버스 차트 및 복원 오차/임계치선 차트 인스턴스 관리, 100포인트 FIFO 링버퍼.

#### [NEW] [metrics-calculator.js](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/metrics-calculator.js)
- 4x4 Confusion Matrix 실시간 계산, Precision, Recall, Macro F1-Score 통계 연산 및 0.80 달성 배지 이벤트.

#### [NEW] [tdd_analyzer_test.js](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/tdd_analyzer_test.js)
- tasks.md에 명시된 TDD 테스트 케이스 1.1~7.2 자동 검증 스위트.

#### [NEW] [manifest.json](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/manifest.json) & [sw.js](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/sw.js) & [icons/](file:///c:/000/7000.Coding/NCC%20%EC%9B%94%EB%93%9C%EC%9B%A8%EC%96%B4%20%EC%83%81%ED%92%88%EA%B0%80%EA%B3%B5/icons)
- PWA 설정 및 오프라인 캐싱, 앱 아이콘 리소스.

---

## Verification Plan

### Automated Tests
- `node tdd_analyzer_test.js` 실행을 통한 수학 연산, 임계치 판정, F1 공식 정합성 단위 테스트 검증.
- Node.js 기반 데이터 분할 시뮬레이션 스크립트로 150,000건 데이터셋의 8:2:5 분할 정확성 및 무결성 사전 검증.

### Manual / Browser Verification
1. **PWA & UI 로딩 검증**: 로컬 정적 웹 서버 구동 후 브라우저(또는 브라우저 서브에이전트)로 접속하여 다크 테마 대시보드 및 12컬럼 그리드 렌더링 확인.
2. **데이터 인제스천 검증**: 12만건 정상 + 3만건 고장 CSV 로드 후 IndexedDB에 15만건(Train 8만, Val 2만, Test 5만) 정확히 적재되는지 확인.
3. **오토인코더 및 분류기 학습 검증**: 1단계 AE 학습 진행(Epoch 손실 감소, 조기종료), 99% 임계치 도출 확인, 2단계 10D 특징 융합 및 다중 분류기 학습 완료 확인.
4. **실시간 시뮬레이션 및 차트 검증**: 1초 주기 스트림 재생, 10% 고장 인젝션 시 복원 오차 상승 및 3색 신호등 알람(녹색 ➡ 황색 ➡ 적색 사이렌)과 한글 정비 가이드 정상 출력 확인.
5. **F1-Score 및 골드 뱃지 검증**: 4x4 Confusion Matrix 실시간 업데이트 및 F1-Score 0.80 이상 달성 시 골드 인증 스탬프 점등 확인.
