/**
 * charts-manager.js
 * uPlot 기반 초당 60fps 캔버스 가속 실시간 시계열 롤링 차트 관리자
 */

class ChartsManager {
  constructor() {
    this.maxPoints = 100;
    this.sensorChart = null;
    this.errorChart = null;
    
    this.sensorData = [
      [], // x: 타임 인덱스 또는 초 (0, 1, 2, ...)
      [], // 드라이펌프 (A)
      [], // 부스터1 (A)
      [], // 부스터2 (A)
      [], // 진공 (Torr)
      []  // 온도 (℃)
    ];

    this.errorData = [
      [], // x
      [], // 실시간 MSE 복원 오차
      []  // 이상 임계치선 (T_h)
    ];

    this.pointCounter = 0;
  }

  initSensorChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const width = Math.max(280, (container.clientWidth || 500) - 16);
    const height = 210;

    const opts = {
      width: width,
      height: height,
      legend: {
        show: true
      },
      scales: {
        x: { time: false },
        y: { auto: true }
      },
      axes: [
        {
          stroke: "#94a3b8",
          font: "11px monospace",
          grid: { stroke: "rgba(255,255,255,0.06)" },
          ticks: { stroke: "#94a3b8" },
          values: (self, ticks) => ticks.map(v => v + "s")
        },
        {
          stroke: "#94a3b8",
          font: "11px monospace",
          grid: { stroke: "rgba(255,255,255,0.06)" },
          ticks: { stroke: "#94a3b8" }
        }
      ],
      series: [
        {},
        {
          label: "드라이(A)",
          stroke: "#06b6d4",
          width: 2,
          points: { show: false }
        },
        {
          label: "부스터1(A)",
          stroke: "#3b82f6",
          width: 2,
          points: { show: false }
        },
        {
          label: "부스터2(A)",
          stroke: "#a855f7",
          width: 2,
          points: { show: false }
        },
        {
          label: "진공(Torr)",
          stroke: "#10b981",
          width: 1.5,
          dash: [4, 4],
          points: { show: false }
        },
        {
          label: "온도(℃)",
          stroke: "#f59e0b",
          width: 1.5,
          points: { show: false }
        }
      ]
    };

    container.innerHTML = "";
    this.sensorChart = new uPlot(opts, this.sensorData, container);
  }

  initErrorChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const width = Math.max(280, (container.clientWidth || 500) - 16);
    const height = 210;

    const opts = {
      width: width,
      height: height,
      legend: {
        show: true
      },
      scales: {
        x: { time: false },
        y: { auto: true, range: [0, 0.25] }
      },
      axes: [
        {
          stroke: "#94a3b8",
          font: "11px monospace",
          grid: { stroke: "rgba(255,255,255,0.06)" },
          ticks: { stroke: "#94a3b8" },
          values: (self, ticks) => ticks.map(v => v + "s")
        },
        {
          stroke: "#94a3b8",
          font: "11px monospace",
          grid: { stroke: "rgba(255,255,255,0.06)" },
        }
      ],
      series: [
        {},
        {
          label: "복원 오차(MSE)",
          stroke: "#f43f5e",
          fill: "rgba(244, 63, 94, 0.15)",
          width: 2,
          points: { show: false }
        },
        {
          label: "이상 임계치(T_h)",
          stroke: "#eab308",
          width: 2,
          dash: [6, 4],
          points: { show: false }
        }
      ]
    };

    container.innerHTML = "";
    this.errorChart = new uPlot(opts, this.errorData, container);
  }

  pushData(point5D, mse, threshold) {
    this.pointCounter++;

    // 1. 센서 데이터 푸시
    this.sensorData[0].push(this.pointCounter);
    this.sensorData[1].push(point5D.dry_pump);
    this.sensorData[2].push(point5D.booster1);
    this.sensorData[3].push(point5D.booster2);
    this.sensorData[4].push(point5D.vacuum);
    this.sensorData[5].push(point5D.temp);

    // 2. 오차 데이터 푸시
    this.errorData[0].push(this.pointCounter);
    this.errorData[1].push(mse);
    this.errorData[2].push(threshold);

    // 3. FIFO 100포인트 롤링 버퍼 슬라이스
    if (this.sensorData[0].length > this.maxPoints) {
      for (let s = 0; s < this.sensorData.length; s++) {
        this.sensorData[s].shift();
      }
      for (let s = 0; s < this.errorData.length; s++) {
        this.errorData[s].shift();
      }
    }

    // 4. 초당 60fps 캔버스 갱신
    if (this.sensorChart) {
      this.sensorChart.setData(this.sensorData);
    }
    if (this.errorChart) {
      this.errorChart.setData(this.errorData);
    }
  }

  reset() {
    this.pointCounter = 0;
    this.sensorData = [[], [], [], [], [], []];
    this.errorData = [[], [], []];
    if (this.sensorChart) this.sensorChart.setData(this.sensorData);
    if (this.errorChart) this.errorChart.setData(this.errorData);
  }

  resize() {
    const sc = document.getElementById('sensor-chart-box');
    const ec = document.getElementById('error-chart-box');
    if (sc && this.sensorChart) {
      this.sensorChart.setSize({ width: Math.max(280, sc.clientWidth - 16), height: 210 });
    }
    if (ec && this.errorChart) {
      this.errorChart.setSize({ width: Math.max(280, ec.clientWidth - 16), height: 210 });
    }
  }
}

window.chartsManager = new ChartsManager();
window.addEventListener('resize', () => {
  if (window.chartsManager) window.chartsManager.resize();
});
