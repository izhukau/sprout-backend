# Hand Tracking — Setup & Run Guide

## Exact Dependency Versions

| Package | Version |
|---|---|
| `mediapipe` | `0.10.14` |
| `opencv-python` | `4.13.0.92` |
| `websockets` | `12.0` |
| `numpy` | `2.4.2` (auto-installed by mediapipe) |

---

## 1. Create an Isolated Conda Environment

```bash
conda create -n aircanvas python=3.10 -y
conda activate aircanvas
```

> Use Python 3.10. mediapipe 0.10.14 does NOT support Python 3.12+.

---

## 2. Install Dependencies

Install each package with `--no-cache-dir` and `--default-timeout=100` to avoid stale/corrupt caches and network timeout issues.

```bash
pip install mediapipe==0.10.14 --no-cache-dir --default-timeout=100
pip install opencv-python==4.13.0.92 --no-cache-dir --default-timeout=100
pip install websockets==12.0 --no-cache-dir --default-timeout=100
```

Or install from `requirements.txt` (same flags still apply):

```bash
pip install -r requirements.txt --no-cache-dir --default-timeout=100
```

---

## 3. Run the WebSocket Server

```bash
conda activate aircanvas
python backend.py
```

Expected output:
```
WebSocket Server started on ws://localhost:8765
```

---

## Key Notes

- **Port**: `8765` — avoids conflict with the Node.js backend on `8000`
- **MediaPipe init must be at module level** — `mp.solutions.hands` fails if accessed inside an async handler. It is initialized at the top of `backend.py`, outside any function.
- **Webcam**: `cv2.VideoCapture(0)` — uses the default webcam (index 0). Change to `1` if you have multiple cameras.
- The server streams index finger tip coordinates `{ x, y, z }` as JSON at ~100fps to any connected WebSocket client.
- The frontend connects to this server from the hand tracking toggle button (bottom-right of the graph view).
